import { isDefined } from '@rnw-community/shared';
import { person, personAlias } from '@rondo/db/schema/identity.schema';
import { lineupEntry } from '@rondo/db/schema/play.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq, isNotNull, isNull, ne } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { alignGuests } from '../roster/align-guests';
import { syncSessionRoster } from '../roster/sync-session-roster';

import { refreshNames } from './refresh-names';

import type { Alias } from '../interface/directory.interface';

interface AliasAssignment {
    readonly alias: Alias;
    readonly personId: string | null;
    readonly resolution: Alias['resolution'];
    readonly resolvedBy: 'alias' | 'vote' | 'guest';
}

export const assignAlias = Effect.fn('IngestTelegram.assignAlias')(function* ({
    alias,
    personId,
    resolution,
    resolvedBy
}: AliasAssignment) {
    const db = yield* Db;
    const placed = [
        ...(alias.kind === 'placeholder' ? [] : [isNotNull(lineupEntry.personId)]),
        ...(resolvedBy === 'vote' ? [ne(lineupEntry.resolvedBy, 'alias'), isNull(lineupEntry.chatId)] : [])
    ];

    const former = yield* db.selectDistinct({ personId: lineupEntry.personId }).from(lineupEntry).where(eq(lineupEntry.aliasId, alias.id));
    const formerPersonIds = [alias.personId, ...former.map(entry => entry.personId)];

    yield* db.update(personAlias).set({ personId, resolution }).where(eq(personAlias.id, alias.id));
    const entries = yield* db
        .update(lineupEntry)
        .set({ personId, resolvedBy })
        .where(and(eq(lineupEntry.aliasId, alias.id), eq(lineupEntry.isGuest, false), ne(lineupEntry.resolvedBy, 'manual'), ...placed))
        .returning({ sessionId: lineupEntry.sessionId });
    yield* alignGuests(alias.communityId);
    yield* syncSessionRoster([...new Set(entries.map(entry => entry.sessionId))]);
    yield* refreshNames([...formerPersonIds, personId].filter(id => isDefined(id)));
});

export const guestPersonOf = Effect.fn('IngestTelegram.guestPersonOf')(function* (alias: Alias) {
    const db = yield* Db;

    if (isDefined(alias.guestPersonId)) {
        return alias.guestPersonId;
    }

    const [created] = yield* db.insert(person).values({ displayName: alias.alias, source: 'import' }).returning({ id: person.id });
    const guestPersonId = created?.id ?? '';
    yield* db.update(personAlias).set({ guestPersonId }).where(eq(personAlias.id, alias.id));

    return guestPersonId;
});
