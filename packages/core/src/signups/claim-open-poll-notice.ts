import { isNotEmptyArray } from '@rnw-community/shared';
import { auditLog } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { withCommunityLock } from '@rondo/db/service/with-community-lock';
import { and, eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { recordAudit } from '../audit/record-audit';

const action = 'poll.left_open';

export const claimOpenPollNotice = Effect.fn('Core.claimOpenPollNotice')((communityId: string, sessionId: string) =>
    withCommunityLock(
        { id: communityId },
        Effect.gen(function* () {
            const db = yield* Db;
            const told = yield* db
                .select({ id: auditLog.id })
                .from(auditLog)
                .where(and(eq(auditLog.entityType, 'session'), eq(auditLog.entityId, sessionId), eq(auditLog.action, action)));

            if (isNotEmptyArray(told)) {
                return false;
            }

            yield* recordAudit({ communityId, actorPersonId: null, action, entityType: 'session', entityId: sessionId });

            return true;
        })
    )
);
