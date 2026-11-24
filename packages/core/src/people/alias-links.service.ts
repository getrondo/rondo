import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { personAlias } from '@rondo/db/schema/identity.schema';
import { lineupEntry } from '@rondo/db/schema/play.schema';
import { session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { assignAlias, guestPersonOf } from '@rondo/ingest-telegram/identity/assign-alias';
import { refreshNames } from '@rondo/ingest-telegram/identity/refresh-names';
import { aliasResolution } from '@rondo/ingest-telegram/identity/resolve-member';
import { rankedLinks } from '@rondo/ingest-telegram/identity/vote-links';
import { alignGuests } from '@rondo/ingest-telegram/roster/align-guests';
import { syncSessionRoster } from '@rondo/ingest-telegram/roster/sync-session-roster';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { recordAudit } from '../audit/record-audit';
import { ActionFailedError } from '../error/action-failed.error';
import { latestVotes } from '../signups/latest-votes';

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

const minSuggestionScore = 0.5;

export const requireAlias = Effect.fn('Core.requireAlias')(function* (communityId: string, aliasId: string) {
    const db = yield* Db;
    const [alias] = yield* db
        .select()
        .from(personAlias)
        .where(and(eq(personAlias.communityId, communityId), sql`${personAlias.id}::text = ${aliasId}`));

    return isDefined(alias) ? alias : yield* ActionFailedError.make({ reason: 'nickname not found in this community' });
});

export const linkAlias = Effect.fn('Core.linkAlias')(function* (input: AliasTarget & { readonly personId: string }) {
    const db = yield* Db;
    const alias = yield* requireAlias(input.communityId, input.aliasId);

    if (alias.kind === 'placeholder') {
        return yield* ActionFailedError.make({ reason: 'several players share this nickname, link it per game' });
    }

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
        return yield* ActionFailedError.make({ reason: 'this player and this nickname are in the same line-up' });
    }

    yield* db.transaction(() =>
        Effect.gen(function* () {
            yield* guestPersonOf(alias);
            yield* assignAlias({ alias, personId: input.personId, resolution: 'confirmed', resolvedBy: 'alias' });
            yield* recordAudit({
                ...input,
                action: 'alias.link',
                entityType: 'alias',
                entityId: alias.id,
                diff: { from: alias.personId, to: input.personId }
            });
        })
    );

    return input.personId;
});

export const unlinkAlias = Effect.fn('Core.unlinkAlias')(function* (input: AliasTarget) {
    const db = yield* Db;
    const alias = yield* requireAlias(input.communityId, input.aliasId);

    yield* db.transaction(() =>
        Effect.gen(function* () {
            const personId = alias.kind === 'placeholder' ? null : yield* guestPersonOf(alias);
            yield* assignAlias({ alias, personId, resolution: 'guest', resolvedBy: 'guest' });
            yield* recordAudit({
                ...input,
                action: 'alias.unlink',
                entityType: 'alias',
                entityId: alias.id,
                diff: { from: alias.personId, to: personId }
            });
        })
    );

    return alias.id;
});

const requireEntry = Effect.fn('Core.requireEntry')(function* ({ communityId, entryId }: EntryTarget) {
    const db = yield* Db;
    const [found] = yield* db
        .select({ entry: lineupEntry, alias: personAlias })
        .from(lineupEntry)
        .innerJoin(session, eq(session.id, lineupEntry.sessionId))
        .leftJoin(personAlias, eq(personAlias.id, lineupEntry.aliasId))
        .where(and(eq(session.communityId, communityId), eq(lineupEntry.isGuest, false), sql`${lineupEntry.id}::text = ${entryId}`));

    return isDefined(found) ? found : yield* ActionFailedError.make({ reason: 'line-up entry not found' });
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

    yield* db.transaction(() =>
        Effect.gen(function* () {
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
        })
    );

    return entry.id;
});

export const linkEntry = Effect.fn('Core.linkEntry')(function* (input: EntryTarget & { readonly personId: string }) {
    const { entry } = yield* requireEntry(input);

    if (!(yield* arePeopleOf(input.communityId, [input.personId]))) {
        return yield* ActionFailedError.make({ reason: 'player not found in this community' });
    }

    if (yield* isInLineup(entry, input.personId)) {
        return yield* ActionFailedError.make({ reason: 'this player is already in the same line-up' });
    }

    return yield* assignEntry(input, entry, { personId: input.personId, resolvedBy: 'manual', action: 'entry.link' });
});

export const unlinkEntry = Effect.fn('Core.unlinkEntry')(function* (input: EntryTarget) {
    const { entry, alias } = yield* requireEntry(input);

    if (entry.resolvedBy !== 'manual' && entry.resolvedBy !== 'vote') {
        return yield* ActionFailedError.make({ reason: 'this line-up entry is not linked' });
    }

    const automatic = entry.resolvedBy === 'vote' ? alias?.guestPersonId : alias?.personId;
    const personId = alias?.kind === 'placeholder' ? null : (automatic ?? null);
    const isTaken = isDefined(personId) && (yield* isInLineup(entry, personId));
    const automaticResolution = isDefined(alias) ? aliasResolution(alias) : 'guest';

    return yield* assignEntry(input, entry, {
        personId: isTaken ? null : personId,
        resolvedBy: entry.resolvedBy === 'vote' ? 'manual' : automaticResolution,
        action: 'entry.unlink'
    });
});

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

    return ranked
        .filter(({ conflict, score }) => !conflict && score >= minSuggestionScore)
        .slice(0, limit)
        .map(({ alias, personId, games, shared, score }) => ({ aliasId: alias.id, alias: alias.alias, personId, games, shared, score }));
});
