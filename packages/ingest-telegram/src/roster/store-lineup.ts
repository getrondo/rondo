import { lineupEntry } from '@rondo/db/schema/play.schema';
import { Db } from '@rondo/db/service/db.service';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { aliasesIn } from '../identity/aliases-in';
import { countOccurrences } from '../identity/count-occurrences';
import { ensureAliases } from '../identity/ensure-aliases';
import { loadDirectory } from '../identity/load-directory';
import { markShared } from '../identity/mark-shared';

import { alignGuests } from './align-guests';
import { entriesOf } from './entries-of';
import { syncSessionRoster } from './sync-session-roster';

import type { LineupFact } from '../extract/fact.model';

interface LiveLineup {
    readonly communityId: string;
    readonly sessionId: string;
    readonly lineup: LineupFact;
    readonly senderName: string;
}

export const storeLineup = Effect.fn('IngestTelegram.storeLineup')(function* ({ communityId, sessionId, lineup, senderName }: LiveLineup) {
    const db = yield* Db;
    const known = yield* loadDirectory(communityId);

    yield* ensureAliases({ communityId, source: 'bot', aliases: aliasesIn([lineup], known, senderName) });
    const directory = yield* loadDirectory(communityId);
    const previous = yield* db.delete(lineupEntry).where(eq(lineupEntry.sessionId, sessionId)).returning();
    const manual = previous.filter(entry => entry.resolvedBy === 'manual');

    yield* db.insert(lineupEntry).values(entriesOf(sessionId, lineup, directory, manual));
    yield* countOccurrences(communityId);
    yield* markShared(communityId);
    yield* alignGuests(communityId);
    yield* syncSessionRoster([sessionId]);
});
