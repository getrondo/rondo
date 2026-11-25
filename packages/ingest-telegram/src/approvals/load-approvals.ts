import { isDefined } from '@rnw-community/shared';
import { aliasLink, person, personAlias, telegramAccount } from '@rondo/db/schema/identity.schema';
import { community } from '@rondo/db/schema/org.schema';
import { lineupEntry } from '@rondo/db/schema/play.schema';
import { session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import * as Effect from 'effect/Effect';

import { applyApproved } from '../identity/apply-approved';
import { withCommunityLock } from '../load/with-community-lock';
import { alignGuests } from '../roster/align-guests';
import { markUndecidedTeams } from '../roster/mark-undecided-teams';

import type { ApprovalRow } from './parse-approvals';

interface Approvals {
    readonly slug: string;
    readonly rows: readonly ApprovalRow[];
    readonly decidedAt: Date;
}

const ensurePerson = Effect.fn('Approvals.ensurePerson')(function* (tgUserId: bigint, nickname: string) {
    const db = yield* Db;
    const [account] = yield* db
        .insert(telegramAccount)
        .values({ tgUserId, firstName: '' })
        .onConflictDoUpdate({ target: telegramAccount.tgUserId, set: { tgUserId } })
        .returning({ personId: telegramAccount.personId });

    if (isDefined(account?.personId)) {
        return account.personId;
    }

    const [created] = yield* db.insert(person).values({ displayName: nickname, source: 'import' }).returning({ id: person.id });
    const personId = created?.id ?? '';
    yield* db.update(telegramAccount).set({ personId }).where(eq(telegramAccount.tgUserId, tgUserId));

    return personId;
});

const ensureAlias = Effect.fn('Approvals.ensureAlias')(function* (communityId: string, { aliasNorm, nickname }: ApprovalRow) {
    const db = yield* Db;
    const [stored] = yield* db
        .insert(personAlias)
        .values({ communityId, alias: nickname, aliasNorm })
        .onConflictDoUpdate({ target: [personAlias.communityId, personAlias.aliasNorm], set: { aliasNorm } })
        .returning({ id: personAlias.id });

    return stored?.id ?? '';
});

const groupApprovals = (rows: readonly ApprovalRow[]): Map<string, ApprovalRow[]> => {
    const groups = new Map<string, ApprovalRow[]>();

    for (const row of rows) {
        const key = `${row.aliasNorm}|${row.tgUserId}`;
        groups.set(key, [...(groups.get(key) ?? []), row]);
    }

    return groups;
};

const storeDays = Effect.fn('Approvals.storeDays')(function* (
    link: Pick<typeof aliasLink.$inferInsert, 'communityId' | 'aliasId' | 'personId'>,
    dates: readonly string[],
    decidedAt: Date
) {
    const db = yield* Db;

    yield* db.execute(sql`
        with days as (select range_agg(daterange(day, day, '[]')) as approved from unnest(${sql.param(dates)}::date[]) day),
        rejected as (
            delete from identity.alias_link link using days
            where link.alias_id = ${link.aliasId}::uuid and link.person_id = ${link.personId}::uuid
                and link.status = 'rejected' and link.during && days.approved
            returning link.*
        )
        insert into identity.alias_link (id, community_id, alias_id, person_id, during, method, status, decided_by, decided_at)
        select gen_random_uuid(), community_id, alias_id, person_id, unnest(datemultirange(during) - approved), method, status, decided_by, decided_at
        from rejected, days
    `);
    const stored = yield* db
        .insert(aliasLink)
        .values(
            dates.map(date => ({
                communityId: link.communityId,
                aliasId: link.aliasId,
                personId: link.personId,
                during: `[${date},${date}]`,
                method: 'owner_list' as const,
                status: 'approved' as const,
                decidedAt
            }))
        )
        .onConflictDoNothing()
        .returning({ id: aliasLink.id });

    return stored.length;
});

const overlapDates = Effect.fn('Approvals.overlapDates')(function* (communityId: string, rows: readonly ApprovalRow[]) {
    const db = yield* Db;
    const other = alias(aliasLink, 'other');
    const overlaps = yield* db
        .selectDistinct({ date: sql<string>`lower(${aliasLink.during})::text` })
        .from(aliasLink)
        .innerJoin(
            other,
            and(
                eq(other.aliasId, aliasLink.aliasId),
                ne(other.personId, aliasLink.personId),
                eq(other.status, 'approved'),
                sql`${other.during} && ${aliasLink.during}`
            )
        )
        .where(and(eq(aliasLink.communityId, communityId), eq(aliasLink.status, 'approved'), eq(aliasLink.method, 'owner_list')));
    const listed = new Set(rows.map(({ date }) => date));

    return overlaps
        .map(({ date }) => date)
        .filter(date => listed.has(date))
        .toSorted();
});

export const loadApprovals = Effect.fn('Approvals.loadApprovals')(({ slug, rows, decidedAt }: Approvals) =>
    withCommunityLock(
        { slug },
        Effect.gen(function* () {
            const db = yield* Db;
            const [home] = yield* db.select({ id: community.id }).from(community).where(eq(community.slug, slug));
            const communityId = home?.id ?? '';
            let stored = 0;

            for (const group of groupApprovals(rows).values()) {
                for (const first of group.slice(0, 1)) {
                    const personId = yield* ensurePerson(first.tgUserId, first.nickname);
                    const aliasId = yield* ensureAlias(communityId, first);
                    const dates = [...new Set(group.map(({ date }) => date))];
                    stored += yield* storeDays({ communityId, aliasId, personId }, dates, decidedAt);
                }
            }

            const pinned = yield* applyApproved(communityId);
            yield* markUndecidedTeams(communityId);
            yield* alignGuests(communityId);

            return { rows: rows.length, stored, pinned, overlapDates: yield* overlapDates(communityId, rows) };
        })
    )
);

export const compareApprovals = Effect.fn('Approvals.compareApprovals')(function* (slug: string, rows: readonly ApprovalRow[]) {
    const db = yield* Db;
    const stored = yield* db
        .select({
            aliasNorm: personAlias.aliasNorm,
            date: session.localDate,
            messageId: lineupEntry.messageId,
            chatId: lineupEntry.chatId,
            tgUserId: telegramAccount.tgUserId
        })
        .from(lineupEntry)
        .innerJoin(session, eq(session.id, lineupEntry.sessionId))
        .innerJoin(community, eq(community.id, session.communityId))
        .innerJoin(personAlias, eq(personAlias.id, lineupEntry.aliasId))
        .leftJoin(telegramAccount, eq(telegramAccount.personId, lineupEntry.personId))
        .where(and(eq(community.slug, slug), eq(lineupEntry.isGuest, false), ne(lineupEntry.teamOrdinal, 0)));
    const dayOf = ({ date, chatId }: { readonly date: string; readonly chatId?: number | null }): string => `${date}|${chatId ?? 'main'}`;
    const linked = new Set(stored.map(row => `${row.aliasNorm}|${dayOf(row)}|${row.tgUserId}`));
    const named = new Set(stored.map(row => `${row.aliasNorm}|${dayOf(row)}`));
    const messages = new Set(stored.map(row => `${dayOf(row)}|${row.messageId}`));
    const changed = rows.filter(row => !linked.has(`${row.aliasNorm}|${dayOf(row)}|${row.tgUserId}`));

    return {
        rows: rows.length,
        kept: rows.length - changed.length,
        linkedToOther: changed.filter(row => named.has(`${row.aliasNorm}|${dayOf(row)}`)).length,
        nicknameGone: changed.filter(row => !named.has(`${row.aliasNorm}|${dayOf(row)}`)).length,
        otherMessage: rows.filter(row => !messages.has(`${dayOf(row)}|${row.messageId}`)).length,
        changedMessageIds: [...new Set(changed.map(({ messageId }) => messageId))]
    };
});
