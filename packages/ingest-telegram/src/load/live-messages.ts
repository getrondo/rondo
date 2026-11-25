import { isDefined } from '@rnw-community/shared';
import { community, telegramChat } from '@rondo/db/schema/org.schema';
import { messageRef, telegramPoll } from '@rondo/db/schema/platform.schema';
import { lineupEntry, teamMember } from '@rondo/db/schema/play.schema';
import { session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq, exists, gt, or, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { postIdIn } from '../extract/post-id';

import type { CommunityConfig } from '../config/community-config';
import type { ChatContent } from '../extract/plan-other-chats';

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

const storedBotPolls = Effect.fn('IngestTelegram.storedBotPolls')(function* (communitySlug: string) {
    const db = yield* Db;
    const rows = yield* db
        .select({ pollId: telegramPoll.pollId })
        .from(telegramPoll)
        .innerJoin(session, eq(session.id, telegramPoll.sessionId))
        .innerJoin(community, eq(community.id, session.communityId))
        .where(eq(community.slug, communitySlug));

    return rows.map(({ pollId }) => pollId);
});

const pollIdOf = (snapshot: ChatContent['snapshot'], messageId: number): string =>
    snapshot.pipe(
        Option.flatMapNullishOr(({ pollIdByMessage }) => pollIdByMessage.get(messageId)),
        Option.getOrElse(() => `message ${messageId}`)
    );

// A bot is the author or the origin of its poll in some chat, also when the game and its stored poll are gone
const botPollsIn = (chats: readonly ChatContent[]): string[] => {
    const bots = new Set(
        chats.flatMap(({ snapshot }) =>
            Option.match(snapshot, {
                onNone: () => [],
                onSome: ({ users }) => [...users.values()].filter(({ bot }) => bot).map(({ id }) => id)
            })
        )
    );

    return chats.flatMap(({ messages, snapshot }) =>
        messages
            .filter(({ poll, authorId, forwardedFromId }) => isDefined(poll) && (bots.has(authorId ?? 0) || bots.has(forwardedFromId ?? 0)))
            .map(({ id }) => pollIdOf(snapshot, id))
    );
};

// Leaves out posts the bot handled live and every copy of a bot's poll
export const withoutBotPosts = Effect.fn('IngestTelegram.withoutBotPosts')(function* (
    config: CommunityConfig,
    chats: readonly ChatContent[]
) {
    const live = yield* liveMessages(config);
    const botPolls = new Set([...(yield* storedBotPolls(config.slug)), ...botPollsIn(chats)]);
    const handled = new Set(live.filter(({ isLineup, isStored }) => !isLineup || isStored).map(({ messageId }) => messageId));

    return chats.map(({ messages, snapshot }): ChatContent => ({
        messages: messages.filter(({ id }) => !handled.has(id) && !botPolls.has(pollIdOf(snapshot, id))),
        snapshot
    }));
});
