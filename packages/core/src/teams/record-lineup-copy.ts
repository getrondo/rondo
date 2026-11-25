import { isDefined, isNotEmptyString } from '@rnw-community/shared';
import { messageRef } from '@rondo/db/schema/platform.schema';
import { lineupDelivery } from '@rondo/db/schema/play.schema';
import { session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq, isNotNull } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { plainText } from '../utils/plain-text.util';

export const recordLineupCopy = Effect.fn('Core.recordLineupCopy')(function* (input: {
    readonly communityId: string;
    readonly chatId: bigint;
    readonly messageId: number;
    readonly text: string;
}) {
    const db = yield* Db;
    const delivered = yield* db
        .select({ sessionId: lineupDelivery.sessionId, text: lineupDelivery.text })
        .from(lineupDelivery)
        .innerJoin(session, eq(session.id, lineupDelivery.sessionId))
        .where(and(eq(session.communityId, input.communityId), isNotNull(lineupDelivery.text)));
    const origin = delivered.find(row => {
        const posted = plainText(row.text ?? '');

        return isNotEmptyString(posted) && input.text.trim().endsWith(posted);
    });

    if (isDefined(origin)) {
        yield* db
            .insert(messageRef)
            .values({
                chatId: input.chatId,
                messageId: input.messageId,
                purpose: 'lineup',
                entityType: 'session',
                entityId: origin.sessionId
            })
            .onConflictDoNothing();
    }
});
