import { isDefined } from '@rnw-community/shared';
import { personAlias } from '@rondo/db/schema/identity.schema';
import { lineupEntry } from '@rondo/db/schema/play.schema';
import { session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { assignAlias, guestPersonOf } from '@rondo/ingest-telegram/identity/assign-alias';
import { rankedLinks } from '@rondo/ingest-telegram/identity/vote-links';
import { syncSessionRoster } from '@rondo/ingest-telegram/roster/sync-session-roster';
import { and, eq, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { recordAudit } from '../audit/record-audit';
import { ActionFailedError } from '../error/action-failed.error';

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
                sql`exists (select 1 from play.lineup_entry named where named.session_id = ${lineupEntry.sessionId} and named.alias_id = ${alias.id}::uuid and named.person_id is not null)`
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

    if (alias.resolution !== 'confirmed' && alias.resolution !== 'vote') {
        return yield* ActionFailedError.make({ reason: 'this nickname is not linked' });
    }

    yield* db.transaction(() =>
        Effect.gen(function* () {
            const personId = yield* guestPersonOf(alias);
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
        .where(and(eq(session.communityId, communityId), sql`${lineupEntry.id}::text = ${entryId}`));

    return isDefined(found?.entry.personId) ? found : yield* ActionFailedError.make({ reason: 'line-up entry not found' });
});

const assignEntry = Effect.fn('Core.assignEntry')(function* (
    target: EntryTarget,
    entry: typeof lineupEntry.$inferSelect,
    personId: string,
    resolvedBy: 'manual' | 'guest'
) {
    const db = yield* Db;
    const [taken] = yield* db
        .select({ id: lineupEntry.id })
        .from(lineupEntry)
        .where(
            and(eq(lineupEntry.sessionId, entry.sessionId), eq(lineupEntry.personId, personId), sql`${lineupEntry.id} <> ${entry.id}::uuid`)
        )
        .limit(1);

    if (isDefined(taken)) {
        return yield* ActionFailedError.make({ reason: 'this player is already in the same line-up' });
    }

    yield* db.transaction(() =>
        Effect.gen(function* () {
            yield* db.update(lineupEntry).set({ personId, resolvedBy }).where(eq(lineupEntry.id, entry.id));
            yield* syncSessionRoster([entry.sessionId]);
            yield* recordAudit({
                ...target,
                action: resolvedBy === 'manual' ? 'entry.link' : 'entry.unlink',
                entityType: 'lineup_entry',
                entityId: entry.id,
                diff: { from: entry.personId, to: personId }
            });
        })
    );

    return entry.id;
});

export const linkEntry = Effect.fn('Core.linkEntry')(function* (input: EntryTarget & { readonly personId: string }) {
    const { entry } = yield* requireEntry(input);

    return yield* assignEntry(input, entry, input.personId, 'manual');
});

export const unlinkEntry = Effect.fn('Core.unlinkEntry')(function* (input: EntryTarget) {
    const { entry, alias } = yield* requireEntry(input);

    if (entry.resolvedBy !== 'manual' || !isDefined(alias)) {
        return yield* ActionFailedError.make({ reason: 'this line-up entry was not linked by hand' });
    }

    const guestPersonId = yield* guestPersonOf(alias);

    return yield* assignEntry(input, entry, guestPersonId, 'guest');
});

export const suggestAliasLinks = Effect.fn('Core.suggestAliasLinks')(function* (communityId: string, limit: number) {
    const ranked = yield* rankedLinks(communityId);

    return ranked
        .filter(({ conflict, score }) => !conflict && score >= minSuggestionScore)
        .slice(0, limit)
        .map(({ alias, personId, games, shared, score }) => ({ aliasId: alias.id, alias: alias.alias, personId, games, shared, score }));
});
