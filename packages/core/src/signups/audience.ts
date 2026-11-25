import { isNotEmptyArray } from '@rnw-community/shared';
import { telegramChat } from '@rondo/db/schema/org.schema';
import { messageRef } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, asc, eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import type { GroupTarget } from '../interface/group-target.interface';

export const audienceOf = Effect.fn('Core.audienceOf')(function* (sessionId: string) {
    const db = yield* Db;
    const rows = yield* db
        .select({ chatId: messageRef.chatId, topicId: telegramChat.topicId })
        .from(messageRef)
        .leftJoin(telegramChat, eq(telegramChat.chatId, messageRef.chatId))
        .where(and(eq(messageRef.entityId, sessionId), eq(messageRef.purpose, 'poll')))
        .orderBy(asc(messageRef.createdAt), asc(messageRef.messageId));

    return [
        ...new Map(rows.map((row): [bigint, GroupTarget] => [row.chatId, { chatId: row.chatId, topicId: row.topicId ?? null }])).values()
    ];
});

export const noticeTargets = Effect.fn('Core.noticeTargets')(function* (sessionId: string, fallback: Option.Option<GroupTarget>) {
    const audience = yield* audienceOf(sessionId);

    return isNotEmptyArray(audience) ? audience : Option.toArray(fallback);
});
