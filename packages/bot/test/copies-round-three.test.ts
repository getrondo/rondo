import { expect, layer } from '@effect/vitest';
import { bindChat } from '@rondo/core/community/community.repository';
import { telegramChat } from '@rondo/db/schema/org.schema';
import { messageRef, pollForward, telegramPoll } from '@rondo/db/schema/platform.schema';
import { session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { conversation, deliver, groupPoll, lastPollId } from './support/conversation';
import { seedSeason } from './support/season';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();

const forwardedPoll = (chatId: number, fromId: number, pollId: string, question: string) =>
    deliver({
        message: {
            message_id: 700 + fromId,
            date: 1_795_680_000,
            chat: { id: chatId, type: 'supergroup', title: 'Copies' },
            from: { id: fromId, is_bot: false, first_name: `Admin ${fromId}` },
            poll: groupPoll(pollId, question, ['Граю', 'Не граю'])
        }
    });

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('copies of bot polls after the council', it => {
    it.effect('records a copy of a bot poll on its game and never reads it as an organizer poll', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedSeason('r3-copy', { groupChatId: null, adminId: 2601 });
            const admin = conversation(recorder, adminNumbered(2601));
            yield* admin.type('/newgame');
            yield* admin.tap('✅ Надіслати опитування мені');
            const pollId = lastPollId(recorder, 2601);
            const question = String(recorder.calls.findLast(call => call.method === 'sendPoll')?.payload.question);
            yield* bindChat({ communityId, chatId: -26_001n, topicId: null, kind: 'supergroup', title: 'Copies' });
            const foreign = yield* seedSeason('r3-copy-foreign', { groupChatId: -26_002, adminId: 2602 });
            const gamesBefore = yield* db.select().from(session);
            yield* forwardedPoll(-26_001, 2601, pollId, question);
            yield* forwardedPoll(-26_002, 2602, pollId, question);
            const gamesAfter = yield* db.select().from(session);
            const copies = yield* db
                .select()
                .from(messageRef)
                .where(eq(messageRef.messageId, 700 + 2601));
            const foreignCopies = yield* db
                .select()
                .from(messageRef)
                .where(eq(messageRef.messageId, 700 + 2602));
            const foreignGames = gamesAfter.filter(game => game.communityId === foreign.communityId);

            expect(gamesAfter).toHaveLength(gamesBefore.length);
            expect(copies.map(copy => copy.chatId)).toEqual([-26_001n]);
            expect(foreignCopies).toEqual([]);
            expect(foreignGames.filter(game => game.localDate === '2026-11-27')).toEqual([]);
        })
    );

    it.effect('moves the link of a group that became a supergroup and keeps its topic', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedSeason('r3-migrate', { groupChatId: null, adminId: 2603 });
            yield* bindChat({ communityId, chatId: -26_003n, topicId: 7, kind: 'group', title: 'Old group' });
            yield* deliver({
                message: {
                    message_id: 1,
                    date: 1_795_680_000,
                    chat: { id: -26_003, type: 'group', title: 'Old group' },
                    from: { id: 2603, is_bot: false, first_name: 'Admin 2603' },
                    migrate_to_chat_id: -1_000_026_003
                }
            });
            const chats = yield* db.select().from(telegramChat).where(eq(telegramChat.communityId, communityId));

            expect(chats.map(chat => ({ chatId: chat.chatId, topicId: chat.topicId, kind: chat.kind }))).toEqual([
                { chatId: -1_000_026_003n, topicId: 7, kind: 'supergroup' }
            ]);
        })
    );

    it.effect('moves the polls, copies and forward claims of a group that became a supergroup in one go', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            yield* seedSeason('r4-migrate-refs', { groupChatId: -26_004, adminId: 2604 });
            const admin = conversation(recorder, adminNumbered(2604));
            yield* admin.type('/newgame');
            yield* admin.tap('✅ Надіслати');
            const pollId = lastPollId(recorder, -26_004);
            yield* db.insert(pollForward).values({ pollId, chatId: -26_004n, messageId: 9 });
            yield* deliver({
                message: {
                    message_id: 2,
                    date: 1_795_680_000,
                    chat: { id: -26_004, type: 'group', title: 'Games' },
                    from: { id: 2604, is_bot: false, first_name: 'Admin 2604' },
                    migrate_to_chat_id: -1_000_026_004
                }
            });
            const [poll] = yield* db.select().from(telegramPoll).where(eq(telegramPoll.pollId, pollId));
            const refs = yield* db.select().from(messageRef).where(eq(messageRef.chatId, -26_004n));
            const moved = yield* db.select().from(messageRef).where(eq(messageRef.chatId, -1_000_026_004n));
            const [claim] = yield* db.select().from(pollForward).where(eq(pollForward.pollId, pollId));

            expect(poll?.chatId).toBe(-1_000_026_004n);
            expect(refs).toEqual([]);
            expect(moved).toHaveLength(1);
            expect(claim?.chatId).toBe(-1_000_026_004n);
        })
    );

    it.effect('moves a supergroup even when the new chat already holds the same message or an older claim', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedSeason('r5-migrate-conflict', { groupChatId: -26_005, adminId: 2605 });
            const admin = conversation(recorder, adminNumbered(2605));
            yield* admin.type('/newgame');
            yield* admin.tap('✅ Надіслати');
            const pollId = lastPollId(recorder, -26_005);
            const [ref] = yield* db.select().from(messageRef).where(eq(messageRef.chatId, -26_005n));
            const moved = -1_000_026_005n;
            yield* db.insert(messageRef).values({
                chatId: moved,
                messageId: ref?.messageId ?? 0,
                purpose: 'lineup',
                entityType: 'session',
                entityId: ref?.entityId ?? ''
            });
            yield* db.insert(pollForward).values([
                { pollId, chatId: -26_005n, messageId: 11, claimedAt: new Date('2026-11-26T09:05:00Z') },
                { pollId, chatId: moved, messageId: null, claimedAt: new Date('2026-11-26T09:01:00Z') }
            ]);
            yield* deliver({
                message: {
                    message_id: 3,
                    date: 1_795_680_000,
                    chat: { id: -26_005, type: 'group', title: 'Games' },
                    from: { id: 2605, is_bot: false, first_name: 'Admin 2605' },
                    migrate_to_chat_id: Number(moved)
                }
            });
            const [chat] = yield* db.select().from(telegramChat).where(eq(telegramChat.communityId, communityId));
            const refs = yield* db
                .select()
                .from(messageRef)
                .where(eq(messageRef.messageId, ref?.messageId ?? 0));
            const claims = yield* db.select().from(pollForward).where(eq(pollForward.pollId, pollId));

            expect(chat?.chatId).toBe(moved);
            expect(refs.map(row => [row.chatId, row.purpose])).toEqual([[moved, 'lineup']]);
            expect(claims.map(row => [row.chatId, row.messageId])).toEqual([[moved, 11]]);
        })
    );
});
