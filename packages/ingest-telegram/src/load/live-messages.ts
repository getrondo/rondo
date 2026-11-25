import { community, telegramChat } from '@rondo/db/schema/org.schema';
import { messageRef } from '@rondo/db/schema/platform.schema';
import { lineupEntry, teamMember } from '@rondo/db/schema/play.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq, exists, gt, or, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { postIdIn } from '../extract/post-id';

import type { CommunityConfig } from '../config/community-config';
import type { TelegramMessage } from '../model/telegram-message.model';

export const liveMessages = Effect.fn('IngestTelegram.liveMessages')(function* ({ slug, otherChats }: CommunityConfig) {
    const db = yield* Db;
    const rows = yield* db
        .select({
            chatId: sql<number>`${messageRef.chatId}`.mapWith(Number),
            messageId: messageRef.messageId,
            isLineup: sql<boolean>`${messageRef.purpose} = 'lineup'`,
            isStored: sql<boolean>`${or(
                exists(
                    db
                        .select()
                        .from(lineupEntry)
                        .where(and(eq(lineupEntry.sessionId, messageRef.entityId), gt(lineupEntry.teamOrdinal, 0)))
                ),
                exists(
                    db
                        .select()
                        .from(teamMember)
                        .where(and(eq(teamMember.sessionId, messageRef.entityId), eq(teamMember.assignedBy, 'balancer')))
                )
            )}`,
            sessionId: messageRef.entityId
        })
        .from(messageRef)
        .innerJoin(telegramChat, eq(telegramChat.chatId, messageRef.chatId))
        .innerJoin(community, eq(community.id, telegramChat.communityId))
        .where(and(eq(community.slug, slug), eq(messageRef.entityType, 'session')));

    return rows.map(row => Object.assign(row, { messageId: postIdIn(otherChats, row) }));
});

export const withoutLiveMessages = Effect.fn('IngestTelegram.withoutLiveMessages')(function* (
    config: CommunityConfig,
    messages: readonly TelegramMessage[]
) {
    const live = yield* liveMessages(config);
    const handled = new Set(live.filter(({ isLineup, isStored }) => !isLineup || isStored).map(({ messageId }) => messageId));

    return messages.filter(({ id }) => !handled.has(id));
});
