import { expect, layer } from '@effect/vitest';
import { bindChat } from '@rondo/core/community/community.repository';
import { telegramChat } from '@rondo/db/schema/org.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { conversation, deliver, labelsOf, lastPollId } from './support/conversation';
import { grantOrganizer, seedSeason } from './support/season';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();
const noticesTo = (chatId: number) =>
    recorder.calls.filter(
        call => call.method === 'sendMessage' && call.payload.chat_id === chatId && String(call.payload.text).startsWith('<b>📢')
    );

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('notice audiences', it => {
    it.effect('offers only the quiet change when no chat of the game is linked any more and says nothing was sent', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            yield* seedSeason('r4-notice-empty', { groupChatId: -29_101, adminId: 2911 });
            const admin = conversation(recorder, adminNumbered(2911));
            yield* admin.type('/newgame');
            yield* admin.tap('✅ Надіслати');
            yield* db.delete(telegramChat).where(eq(telegramChat.chatId, -29_101n));
            yield* admin.tap('🕖 Час');
            yield* admin.type('20:15');
            const confirmation = admin.screen();
            yield* admin.tap('Змінити');
            const [receipt] = admin.screen().text.split('\n');

            expect(labelsOf(confirmation).some(label => label.startsWith('✅'))).toBe(false);
            expect(receipt).toBe('✅ Змінено. У групу нічого не надіслано.');
            expect(
                recorder.calls.filter(
                    call => call.method === 'sendMessage' && call.payload.chat_id === 2911 && String(call.payload.text).startsWith('<b>📢')
                )
            ).toEqual([]);
        })
    );

    it.effect('names the group and the private chat a notice goes to and sends it to exactly both', () =>
        Effect.gen(function* () {
            const { communityId } = yield* seedSeason('r4-notice-both', { groupChatId: null, adminId: 2912 });
            const admin = conversation(recorder, adminNumbered(2912));
            yield* admin.type('/newgame');
            yield* admin.tap('✅ Надіслати опитування мені');
            yield* bindChat({ communityId, chatId: -29_102n, topicId: 4, kind: 'supergroup', title: 'Copies' });
            yield* deliver({
                message: {
                    message_id: 77,
                    date: 1_795_680_000,
                    chat: { id: -29_102, type: 'supergroup', title: 'Copies' },
                    from: { id: 2912, is_bot: false, first_name: 'Admin 2912' },
                    poll: {
                        id: lastPollId(recorder, 2912),
                        question: 'game',
                        options: [],
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
            yield* admin.tap('✏️ Змінити');
            yield* admin.tap('🕖 Час');
            yield* admin.type('20:15');
            const confirmation = admin.screen();
            yield* admin.tap('✅ Змінити й написати');
            const [receipt] = admin.screen().text.split('\n');

            expect(confirmation.text.split('\n')[0]).toBe('Так буде в «Copies» і в тебе:');
            expect(receipt).toBe('✅ Змінено, у «Copies» і тобі написано.');
            expect(noticesTo(-29_102).map(call => call.payload.message_thread_id)).toEqual([4]);
            expect(noticesTo(2912)).toHaveLength(1);
        })
    );

    it.effect('names another admin whose private chat gets the notice and keeps «me» for my own chat only', () =>
        Effect.gen(function* () {
            const { communityId } = yield* seedSeason('r5-notice-other', { groupChatId: null, adminId: 2913 });
            yield* grantOrganizer(communityId, 2914);
            const admin = conversation(recorder, adminNumbered(2913));
            const other = conversation(recorder, adminNumbered(2914));
            yield* admin.type('/newgame');
            yield* admin.tap('✅ Надіслати опитування мені');
            yield* other.type('/games');
            yield* other.tap('Пт 27.11 19:00');
            yield* other.tap('✅ Надіслати опитування ще раз');
            yield* admin.type('/games');
            yield* admin.tap('Пт 27.11 19:00');
            yield* admin.tap('🕖 Час');
            yield* admin.type('20:15');
            const confirmation = admin.screen();
            yield* admin.tap('✅ Змінити й написати');
            const [receipt] = admin.screen().text.split('\n');

            expect(confirmation.text.split('\n')[0]).toBe('Так буде у Admin 2914 і в тебе:');
            expect(labelsOf(confirmation)[0]?.startsWith('✅ Змінити й написати у Admin')).toBe(true);
            expect(receipt).toBe('✅ Змінено, у Admin 2914 і тобі написано.');
            expect(noticesTo(2914)).toHaveLength(1);
            expect(noticesTo(2913)).toHaveLength(1);
        })
    );
});
