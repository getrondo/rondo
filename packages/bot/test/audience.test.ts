import { expect, layer } from '@effect/vitest';
import { isDefined } from '@rnw-community/shared';
import { telegramChat } from '@rondo/db/schema/org.schema';
import { signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder, refusal } from '@rondo/telegram/testing/recording-telegram.layer';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { conversation, deliver } from './support/conversation';
import { setNow } from './support/fixed-clock';
import { gamesOn, seedSeason, seedSecondGroup } from './support/season';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();
const callsTo = (chatId: number, method: string) =>
    recorder.calls.filter(call => call.method === method && call.payload.chat_id === chatId);
const voter = (id: number) => ({ id, is_bot: false as const, first_name: `Voter ${id}` });

const pollIdIn = (chatId: number) => {
    const sent = callsTo(chatId, 'sendPoll').at(-1)?.result as { poll?: { id?: string } } | undefined;

    return sent?.poll?.id ?? '';
};

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('one poll, several groups', it => {
    it.effect('posts the usual Wednesday to the second group in two taps', () =>
        Effect.gen(function* () {
            const { communityId, park } = yield* seedSeason('aud-wednesday', { groupChatId: -4001, adminId: 701 });
            yield* seedSecondGroup(communityId, { main: -4001, second: -4002, venueId: park });
            yield* setNow(Date.parse('2026-12-01T09:00:00Z'));
            const admin = conversation(recorder, adminNumbered(701));
            yield* admin.type('/newgame');
            const main = admin.screen();
            yield* admin.tap('✅ Надіслати');
            const [game] = yield* gamesOn(communityId, '2026-12-02');

            expect(main.buttons[0]?.map(button => button.text)).toEqual(['✅ Надіслати в «Second»']);
            expect(callsTo(-4002, 'sendPoll')).toHaveLength(1);
            expect(callsTo(-4001, 'sendPoll')).toHaveLength(0);
            expect(game).toMatchObject({ venueId: park, capacityMax: 18 });
        })
    );

    it.effect('posts the Friday to both groups as one poll and one forward, and counts a vote from the copy once', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, park } = yield* seedSeason('aud-both', { groupChatId: -4011, adminId: 702 });
            yield* seedSecondGroup(communityId, { main: -4011, second: -4012, venueId: park });
            const admin = conversation(recorder, adminNumbered(702));
            yield* admin.type('/newgame');
            const main = admin.screen();
            yield* admin.tap('✅ Надіслати');
            const pollId = pollIdIn(-4011);
            const answer = { poll_id: pollId, user: voter(9201), option_ids: [0], option_persistent_ids: [] };
            yield* deliver({ poll_answer: answer });
            yield* deliver({ poll_answer: answer });
            const [game] = yield* gamesOn(communityId, '2026-11-27');
            const signups = yield* db
                .select()
                .from(signup)
                .where(eq(signup.sessionId, game?.id ?? ''));

            expect(main.buttons[0]?.map(button => button.text)).toEqual(['✅ Надіслати в обидві групи']);
            expect(callsTo(-4011, 'sendPoll')).toHaveLength(1);
            expect(callsTo(-4012, 'forwardMessage')[0]?.payload).toMatchObject({ from_chat_id: -4011 });
            expect(callsTo(-4012, 'sendPoll')).toHaveLength(0);
            expect(signups).toHaveLength(1);
        })
    );

    it.effect('opens a full game to the second group later, reports a refused forward and mentions the promoted player in both', () =>
        Effect.gen(function* () {
            const { communityId, park } = yield* seedSeason('aud-later', { groupChatId: -4021, adminId: 703 });
            yield* seedSecondGroup(communityId, { main: -4021, second: -4022, venueId: park });
            const admin = conversation(recorder, adminNumbered(703));
            yield* admin.type('/newgame');
            yield* admin.tap('📤 Куди');
            const choices = admin.labels().flat();
            yield* admin.tap('«Games»');
            yield* admin.tap('👥 22');
            yield* admin.type('2');
            yield* admin.tap('✅ Надіслати');
            const pollId = pollIdIn(-4021);
            const vote = (id: number, optionIds: number[]) =>
                deliver({ poll_answer: { poll_id: pollId, user: voter(id), option_ids: optionIds, option_persistent_ids: [] } });
            yield* vote(9301, [0]);
            yield* vote(9302, [0]);
            yield* vote(9303, [0]);
            yield* admin.type('/games');
            yield* admin.tap('Пт 27.11 19:00');
            const card = admin.screen();
            recorder.failures.set('forwardMessage', refusal('forwardMessage', 'Bad Request: not enough rights'));
            yield* admin.tap('📣 Надіслати ще в «Second»');
            const confirmation = admin.screen().text;
            yield* admin.tap('✅ Надіслати в «Second»');
            recorder.failures.delete('forwardMessage');
            const refused = admin.screen();
            yield* admin.tap('📣 Надіслати ще в «Second»');
            yield* admin.tap('✅ Надіслати в «Second»');
            const opened = admin.screen();
            yield* vote(9301, []);
            const mentions = [-4021, -4022].map(chatId => callsTo(chatId, 'sendMessage').at(-1)?.payload.text);

            expect(card.text).toContain('Записались 2 з 2 · вільно 0');
            expect(choices).toEqual(['👤 Тільки мені', '«Games»', '«Second»', '✓ «Games» і «Second»', '⬅️ Назад']);
            expect(confirmation).toContain('Так буде в «Second»:');
            expect(refused.text).toContain('Telegram не прийняв');
            expect(refused.buttons.flat().map(button => button.text)).toContain('📣 Надіслати ще в «Second»');
            expect(opened.buttons.flat().map(button => button.text)).not.toContain('📣 Надіслати ще в «Second»');
            expect(opened.text.split('\n')[0]).toBe('✅ Опитування тепер і в «Second».');
            expect(callsTo(-4022, 'sendPoll')).toHaveLength(0);
            expect(mentions.every(text => String(text).includes('Voter 9303'))).toBe(true);
        })
    );

    it.effect('adds a group with /link and moves the topic inside one group', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedSeason('aud-link', { groupChatId: null, adminId: 704 });
            const owner = { id: 42, is_bot: false as const, first_name: 'Owner' };
            const link = (chatId: number, topic: number | null) =>
                deliver({
                    message: {
                        message_id: 1,
                        date: 0,
                        chat: { id: chatId, type: 'supergroup', title: `Group ${-chatId}` },
                        from: owner,
                        text: '/link aud-link',
                        ...(isDefined(topic) ? { message_thread_id: topic, is_topic_message: true } : {})
                    }
                });
            yield* link(-4031, null);
            yield* link(-4032, null);
            yield* link(-4031, 5);
            const chats = yield* db
                .select()
                .from(telegramChat)
                .where(eq(telegramChat.communityId, communityId))
                .orderBy(telegramChat.createdAt);

            expect(chats.map(chat => [chat.chatId, chat.topicId])).toEqual([
                [-4031n, 5],
                [-4032n, null]
            ]);
        })
    );
});
