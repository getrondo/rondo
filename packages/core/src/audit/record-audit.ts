import { isDefined } from '@rnw-community/shared';
import { auditLog } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import * as Effect from 'effect/Effect';

export interface AuditEntry {
    readonly communityId: string;
    readonly actorPersonId: string | null;
    readonly action: string;
    readonly entityType: string;
    readonly entityId: string;
    readonly diff?: unknown;
}

export const recordAudit = Effect.fn('Core.recordAudit')(function* (entry: AuditEntry) {
    const db = yield* Db;

    yield* db.insert(auditLog).values({
        communityId: entry.communityId,
        actorPersonId: entry.actorPersonId,
        actorKind: isDefined(entry.actorPersonId) ? 'user' : 'bot',
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        diff: entry.diff ?? null
    });
});
