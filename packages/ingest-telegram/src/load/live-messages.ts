import { community, telegramChat } from '@rondo/db/schema/org.schema';
import { messageRef } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import type { TelegramMessage } from '../model/telegram-message.model';

export const liveMessages = Effect.fn('IngestTelegram.liveMessages')(function* (communitySlug: string) {
    const db = yield* Db;

    return yield* db
        .select({ messageId: messageRef.messageId, purpose: messageRef.purpose, sessionId: messageRef.entityId })
        .from(messageRef)
        .innerJoin(telegramChat, eq(telegramChat.chatId, messageRef.chatId))
        .innerJoin(community, eq(community.id, telegramChat.communityId))
        .where(and(eq(community.slug, communitySlug), eq(messageRef.entityType, 'session')));
});

export const withoutLiveMessages = Effect.fn('IngestTelegram.withoutLiveMessages')(function* (
    communitySlug: string,
    messages: readonly TelegramMessage[]
) {
    const handled = new Set((yield* liveMessages(communitySlug)).map(({ messageId }) => messageId));

    return messages.filter(({ id }) => !handled.has(id));
});
