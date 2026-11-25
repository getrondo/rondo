import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { telegramAccount } from '@rondo/db/schema/identity.schema';
import { roleGrant } from '@rondo/db/schema/org.schema';
import { team, teamDraft } from '@rondo/db/schema/play.schema';
import { session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { withCommunityLock } from '@rondo/db/service/with-community-lock';
import { and, desc, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { Access } from '../access/admin-access';
import { resolveLocale } from '../i18n/locale';
import { addMillis } from '../utils/add-millis.util';

const minute = 60_000;
const longestLeadMs = 6 * 60 * minute;
export const afterStartMs = 15 * minute;
const debounceMs = 5 * minute;
const lastCallMs = 15 * minute;

export const gamesNearStart = Effect.fn('Core.gamesNearStart')(function* (now: Date) {
    const db = yield* Db;

    return yield* db
        .select({ id: session.id, communityId: session.communityId, startsAt: session.startsAt })
        .from(session)
        .where(
            and(
                inArray(session.status, ['open', 'full', 'locked']),
                gt(session.startsAt, addMillis(now, -afterStartMs)),
                lte(session.startsAt, addMillis(now, longestLeadMs))
            )
        )
        .orderBy(session.startsAt)
        .limit(50);
});

export const hasStoredTeams = Effect.fn('Core.hasStoredTeams')(function* (sessionId: string) {
    const db = yield* Db;
    const [row] = yield* db.select({ id: team.id }).from(team).where(eq(team.sessionId, sessionId)).limit(1);

    return isDefined(row);
});

export const claimProposal = Effect.fn('Core.claimProposal')(function* (sessionId: string, now: Date) {
    const db = yield* Db;
    const claimed = yield* db
        .update(teamDraft)
        .set({ proposedAt: now })
        .where(and(eq(teamDraft.sessionId, sessionId), isNull(teamDraft.proposedAt)))
        .returning({ sessionId: teamDraft.sessionId });

    return isNotEmptyArray(claimed);
});

export const releaseProposal = Effect.fn('Core.releaseProposal')(function* (sessionId: string) {
    const db = yield* Db;

    yield* db.update(teamDraft).set({ proposedAt: null }).where(eq(teamDraft.sessionId, sessionId));
});

export const claimFewNotice = Effect.fn('Core.claimFewNotice')(function* (communityId: string, sessionId: string) {
    const db = yield* Db;
    const inserted = yield* withCommunityLock(
        { id: communityId },
        db.execute(sql`
        insert into audit.log (id, actor_kind, community_id, action, entity_type, entity_id)
        select gen_random_uuid(), 'bot', ${communityId}::uuid, 'teams.few', 'session', ${sessionId}
        where not exists (select 1 from audit.log where action = 'teams.few' and entity_id = ${sessionId})
        returning id
    `)
    );

    return isNotEmptyArray(inserted.rows);
});

export const claimNotice = Effect.fn('Core.claimNotice')(function* (sessionId: string, now: Date, startsAt: Date) {
    const db = yield* Db;
    const isLastCall = now.getTime() >= startsAt.getTime() - lastCallMs;
    const claimed = yield* db
        .update(teamDraft)
        .set({ notifiedAt: now })
        .where(
            and(
                eq(teamDraft.sessionId, sessionId),
                or(isNotNull(teamDraft.proposedAt), isNotNull(teamDraft.publishedAt)),
                sql`${teamDraft.changedAt} > coalesce(${teamDraft.notifiedAt}, ${teamDraft.proposedAt}, 'epoch'::timestamptz)`,
                isLastCall
                    ? sql`true`
                    : sql`coalesce(greatest(${teamDraft.proposedAt}, ${teamDraft.notifiedAt}), 'epoch'::timestamptz) <= ${addMillis(now, -debounceMs)}`
            )
        )
        .returning({ sessionId: teamDraft.sessionId });

    return isNotEmptyArray(claimed);
});

export const releaseNotice = Effect.fn('Core.releaseNotice')(function* (sessionId: string, claimedAt: Date, previous: Date | null) {
    const db = yield* Db;

    yield* db
        .update(teamDraft)
        .set({ notifiedAt: previous })
        .where(and(eq(teamDraft.sessionId, sessionId), eq(teamDraft.notifiedAt, claimedAt)));
});

export const pendingNotices = Effect.fn('Core.pendingNotices')(function* (sessionIds: readonly string[]) {
    const db = yield* Db;

    if (!isNotEmptyArray(sessionIds)) {
        return [];
    }

    return yield* db
        .select({ sessionId: teamDraft.sessionId })
        .from(teamDraft)
        .where(
            and(
                inArray(teamDraft.sessionId, [...sessionIds]),
                sql`${teamDraft.changedAt} > coalesce(${teamDraft.notifiedAt}, ${teamDraft.proposedAt}, 'epoch'::timestamptz)`
            )
        );
});

export const communityAdmins = Effect.fn('Core.communityAdmins')(function* (communityId: string) {
    const db = yield* Db;
    const access = yield* Access;
    const granted = yield* db
        .selectDistinctOn([telegramAccount.personId], { tgUserId: telegramAccount.tgUserId, languageCode: telegramAccount.languageCode })
        .from(roleGrant)
        .innerJoin(telegramAccount, eq(telegramAccount.personId, roleGrant.personId))
        .where(
            and(eq(roleGrant.communityId, communityId), inArray(roleGrant.role, ['owner', 'organizer']), sql`${roleGrant.valid} @> now()`)
        )
        .orderBy(telegramAccount.personId, desc(telegramAccount.lastSeenAt));

    const ownerIds = [...access.ownerTgUserIds].filter(tgUserId => !granted.some(row => row.tgUserId === tgUserId));
    const known = isNotEmptyArray(ownerIds)
        ? yield* db
              .select({ tgUserId: telegramAccount.tgUserId, languageCode: telegramAccount.languageCode })
              .from(telegramAccount)
              .where(inArray(telegramAccount.tgUserId, ownerIds))
        : [];
    const owners = ownerIds.map(tgUserId => ({
        tgUserId,
        languageCode: known.find(row => row.tgUserId === tgUserId)?.languageCode ?? null
    }));

    return [...granted, ...owners].map(row => ({ tgUserId: row.tgUserId, locale: resolveLocale(row.languageCode) }));
});

const offerPauseMs = 30 * 24 * 60 * minute;

export const claimLevelsOffer = Effect.fn('Core.claimLevelsOffer')(function* (communityId: string, personId: string | null, now: Date) {
    const db = yield* Db;

    if (!isDefined(personId)) {
        return false;
    }

    const claimed = yield* db.execute(sql`
        insert into audit.log (id, actor_person_id, actor_kind, community_id, action, entity_type, entity_id, at)
        select gen_random_uuid(), ${personId}::uuid, 'user', ${communityId}::uuid, 'teams.levels_offer', 'person', ${personId}, ${now}
        where not exists (
            select 1 from play_private.rating level join org.activity sport on sport.id = level.activity_id where sport.community_id = ${communityId}::uuid
        )
        and (
            select count(distinct game.id) from scheduling.session game join play.team squad on squad.session_id = game.id
            where game.community_id = ${communityId}::uuid and game.starts_at < ${now}
        ) >= 3
        and not exists (
            select 1 from audit.log offered where offered.action = 'teams.levels_offer' and offered.entity_id = ${personId}
                and offered.community_id = ${communityId}::uuid and offered.at > ${addMillis(now, -offerPauseMs)}
        )
        returning id
    `);

    return isNotEmptyArray(claimed.rows);
});
