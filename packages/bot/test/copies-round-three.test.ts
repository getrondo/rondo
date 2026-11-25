import { expect, layer } from '@effect/vitest';
import { bindChat } from '@rondo/core/community/community.repository';
import { messageRef } from '@rondo/db/schema/platform.schema';
import { session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { conversation, deliver, lastPollId } from './support/conversation';
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
            poll: {
                id: pollId,
                question,
                options: ['Граю', 'Не граю'].map(text => ({ text, voter_count: 0, persistent_id: text })),
                total_voter_count: 0,
                is_closed: false,
                is_anonymous: false,
                type: 'regular',
                allows_multiple_answers: false,
                allows_revoting: true,
                members_only: false
            }
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
});
