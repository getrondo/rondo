import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { personAlias } from '@rondo/db/schema/identity.schema';
import { lineupEntry } from '@rondo/db/schema/play.schema';
import { session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { withCommunityLock } from '@rondo/db/service/with-community-lock';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { recordAudit } from '../audit/record-audit';
import { ActionFailedError } from '../error/action-failed.error';
import { assignAlias, guestPersonOf } from '../identity/assign-alias';
import { refreshNames } from '../identity/refresh-names';
import { aliasResolution } from '../identity/resolve-member';
import { rankedLinks } from '../identity/vote-links';
import { alignGuests } from '../roster/align-guests';
import { syncSessionRoster } from '../roster/sync-session-roster';
import { latestVotes } from '../signups/latest-votes';

import { linkedPersonsOf, recordDecision, requireNoOtherPeriod } from './alias-decisions';
import { arePeopleOf } from './people.service';

type LineupEntry = typeof lineupEntry.$inferSelect;

interface AliasTarget {
    readonly communityId: string;
    readonly aliasId: string;
    readonly actorPersonId: string | null;
}

interface EntryTarget {
    readonly communityId: string;
    readonly entryId: string;
    readonly actorPersonId: string | null;
}

export const requireAlias = Effect.fn('Core.requireAlias')(function* (communityId: string, aliasId: string) {
    const db = yield* Db;
    const [alias] = yield* db
        .select()
        .from(personAlias)
        .where(and(eq(personAlias.communityId, communityId), sql`${personAlias.id}::text = ${aliasId}`));

    return isDefined(alias) ? alias : yield* ActionFailedError.make({ failure: { code: 'nickname_not_found' } });
});

const requirePerson = Effect.fn('Core.requirePerson')(function* (communityId: string, personId: string) {
    if (!(yield* arePeopleOf(communityId, [personId]))) {
        return yield* ActionFailedError.make({ failure: { code: 'person_not_found' } });
    }

    return personId;
});

export const linkAlias = Effect.fn('Core.linkAlias')((input: AliasTarget & { readonly personId: string }) =>
    withCommunityLock(
        { id: input.communityId },
        Effect.gen(function* () {
            const db = yield* Db;
            const alias = yield* requireAlias(input.communityId, input.aliasId);

            if (alias.kind === 'placeholder') {
                return yield* ActionFailedError.make({ failure: { code: 'nickname_shared' } });
            }

            yield* requirePerson(input.communityId, input.personId);
            const [conflict] = yield* db
                .select({ id: lineupEntry.id })
                .from(lineupEntry)
                .where(
                    and(
                        eq(lineupEntry.personId, input.personId),
                        sql`${lineupEntry.aliasId} is distinct from ${alias.id}::uuid`,
                        sql`exists (select 1 from play.lineup_entry named where named.session_id = ${lineupEntry.sessionId} and named.alias_id = ${alias.id}::uuid and not named.is_guest)`
                    )
                )
                .limit(1);

            if (isDefined(conflict)) {
                return yield* ActionFailedError.make({ failure: { code: 'same_lineup' } });
            }

            yield* requireNoOtherPeriod(alias, input.personId);
            yield* guestPersonOf(alias);
            yield* recordDecision({ alias, personId: input.personId, status: 'approved', actorPersonId: input.actorPersonId });
            yield* assignAlias({ alias, personId: input.personId, resolution: 'confirmed', resolvedBy: 'alias' });
            yield* recordAudit({
                ...input,
                action: 'alias.link',
                entityType: 'alias',
                entityId: alias.id,
                diff: { from: alias.personId, to: input.personId }
            });

            return input.personId;
        })
    )
);

export const unlinkAlias = Effect.fn('Core.unlinkAlias')((input: AliasTarget) =>
    withCommunityLock(
        { id: input.communityId },
        Effect.gen(function* () {
            const alias = yield* requireAlias(input.communityId, input.aliasId);
            const linked = yield* linkedPersonsOf(alias);
            const [only, ...others] = linked;

            if (isNotEmptyArray(others)) {
                return yield* ActionFailedError.make({ failure: { code: 'nickname_periods' } });
            }

            if (isDefined(only)) {
                yield* recordDecision({ alias, personId: only, status: 'rejected', actorPersonId: input.actorPersonId });
            }

            const personId = alias.kind === 'placeholder' ? null : yield* guestPersonOf(alias);
            yield* assignAlias({ alias, personId, resolution: 'guest', resolvedBy: 'guest' });
            yield* recordAudit({
                ...input,
                action: 'alias.unlink',
                entityType: 'alias',
                entityId: alias.id,
                diff: { from: alias.personId, to: personId }
            });

            return alias.id;
        })
    )
);

const requireEntry = Effect.fn('Core.requireEntry')(function* ({ communityId, entryId }: EntryTarget) {
    const db = yield* Db;
    const [found] = yield* db
        .select({ entry: lineupEntry, alias: personAlias })
        .from(lineupEntry)
        .innerJoin(session, eq(session.id, lineupEntry.sessionId))
        .leftJoin(personAlias, eq(personAlias.id, lineupEntry.aliasId))
        .where(and(sql`${lineupEntry.id}::text = ${entryId}`, eq(session.communityId, communityId), eq(lineupEntry.isGuest, false)));

    return isDefined(found) ? found : yield* ActionFailedError.make({ failure: { code: 'entry_not_found' } });
});

const isInLineup = Effect.fn('Core.isInLineup')(function* (entry: LineupEntry, personId: string) {
    const db = yield* Db;
    const rows = yield* db
        .select({ id: lineupEntry.id })
        .from(lineupEntry)
        .where(and(eq(lineupEntry.sessionId, entry.sessionId), eq(lineupEntry.personId, personId), ne(lineupEntry.id, entry.id)));

    return isNotEmptyArray(rows);
});

const assignEntry = Effect.fn('Core.assignEntry')(function* (
    target: EntryTarget,
    entry: LineupEntry,
    change: {
        readonly personId: string | null;
        readonly resolvedBy: LineupEntry['resolvedBy'];
        readonly action: 'entry.link' | 'entry.unlink';
    }
) {
    const db = yield* Db;
    const { action, ...values } = change;

    yield* db.update(lineupEntry).set(values).where(eq(lineupEntry.id, entry.id));
    yield* alignGuests(target.communityId);
    yield* syncSessionRoster([entry.sessionId]);
    yield* refreshNames([entry.personId, change.personId].filter(personId => isDefined(personId)));
    yield* recordAudit({
        ...target,
        action,
        entityType: 'lineup_entry',
        entityId: entry.id,
        diff: { from: entry.personId, to: change.personId }
    });

    return entry.id;
});

export const linkEntry = Effect.fn('Core.linkEntry')((input: EntryTarget & { readonly personId: string }) =>
    withCommunityLock(
        { id: input.communityId },
        Effect.gen(function* () {
            const { entry } = yield* requireEntry(input);
            yield* requirePerson(input.communityId, input.personId);

            if (yield* isInLineup(entry, input.personId)) {
                return yield* ActionFailedError.make({ failure: { code: 'same_lineup' } });
            }

            return yield* assignEntry(input, entry, { personId: input.personId, resolvedBy: 'manual', action: 'entry.link' });
        })
    )
);

export const unlinkEntry = Effect.fn('Core.unlinkEntry')((input: EntryTarget) =>
    withCommunityLock(
        { id: input.communityId },
        Effect.gen(function* () {
            const { entry, alias } = yield* requireEntry(input);

            const isAutomatic = entry.resolvedBy === 'vote' || entry.resolvedBy === 'alias';

            if (entry.resolvedBy !== 'manual' && !isAutomatic) {
                return yield* ActionFailedError.make({ failure: { code: 'entry_not_linked' } });
            }

            const automatic = isAutomatic ? alias?.guestPersonId : alias?.personId;
            const personId = alias?.kind === 'placeholder' ? null : (automatic ?? null);
            const isTaken = isDefined(personId) && (yield* isInLineup(entry, personId));
            const automaticResolution = isDefined(alias) ? aliasResolution(alias) : 'guest';

            return yield* assignEntry(input, entry, {
                personId: isTaken ? null : personId,
                resolvedBy: isAutomatic ? 'manual' : automaticResolution,
                action: 'entry.unlink'
            });
        })
    )
);

export const reviewEntries = Effect.fn('Core.reviewEntries')(function* (communityId: string, limit: number) {
    const db = yield* Db;
    const vote = latestVotes(db);
    const unlisted = sql`not exists (
        select 1 from play.lineup_entry listed where listed.session_id = ${lineupEntry.sessionId} and listed.person_id = ${vote.personId}
    )`;

    return yield* db
        .select({
            entryId: lineupEntry.id,
            sessionId: lineupEntry.sessionId,
            localDate: session.localDate,
            raw: lineupEntry.raw,
            aliasId: lineupEntry.aliasId,
            resolvedBy: lineupEntry.resolvedBy,
            shared: sql<boolean>`coalesce(${personAlias.kind} = 'placeholder', false)`,
            occurrences: personAlias.occurrences,
            isTeamUndecided: lineupEntry.isTeamUndecided,
            candidatePersonIds: sql<
                string[]
            >`coalesce(array_agg(${vote.personId}::text) filter (where ${vote.personId} is not null and ${unlisted}), '{}')`
        })
        .from(lineupEntry)
        .innerJoin(session, eq(session.id, lineupEntry.sessionId))
        .leftJoin(personAlias, eq(personAlias.id, lineupEntry.aliasId))
        .leftJoin(vote, and(eq(vote.sessionId, lineupEntry.sessionId), eq(vote.choice, 'yes')))
        .where(
            and(eq(session.communityId, communityId), eq(lineupEntry.isGuest, false), inArray(lineupEntry.resolvedBy, ['guest', 'vote']))
        )
        .groupBy(lineupEntry.id, session.localDate, personAlias.id)
        .orderBy(asc(lineupEntry.resolvedBy), desc(personAlias.occurrences), desc(session.localDate))
        .limit(limit);
});

export const suggestAliasLinks = Effect.fn('Core.suggestAliasLinks')(function* (communityId: string, limit: number) {
    const ranked = yield* rankedLinks(communityId);

    return ranked.slice(0, limit).map(({ alias, ...suggestion }) => Object.assign(suggestion, { alias: alias.alias }));
});
