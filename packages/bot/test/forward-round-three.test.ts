import { expect, layer } from '@effect/vitest';
import { linkGroup } from '@rondo/core/testing/link-group';
import { makeRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import * as Effect from 'effect/Effect';

import { conversation, deliver, forwardsTo, labelsOf, lastPollId } from './support/conversation';
import { seedSeason } from './support/season';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();
const unknownForward = (slug: string, chats: { readonly main: number; readonly second: number; readonly admin: number }) =>
    Effect.gen(function* () {
        const { communityId } = yield* seedSeason(slug, { groupChatId: chats.main, adminId: chats.admin });
        const admin = conversation(recorder, adminNumbered(chats.admin));
        yield* admin.type('/newgame');
        yield* admin.tap('✅ Надіслати');
        yield* linkGroup(communityId, { chatId: chats.second, title: 'Second', purpose: 'other' });
        yield* admin.type('/games');
        yield* admin.tap('Пт 27.11 19:00');
        yield* admin.tap('📣 Надіслати ще в «Second»');
        recorder.failures.set('forwardMessage', new Error('socket hang up'));
        yield* admin.tap('✅ Надіслати в «Second»');

        return Object.assign(admin, { communityId });
    });

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('forwards after the council', it => {
    it.effect('keeps one claim per group after an unknown forward and sends again only after the admin says it is not there', () =>
        Effect.gen(function* () {
            const admin = yield* unknownForward('r3-forward', { main: -24_001, second: -24_002, admin: 2401 });
            recorder.failures.delete('forwardMessage');
            const unknown = admin.screen();
            yield* admin.type('/games');
            yield* admin.tap('Пт 27.11 19:00');
            const card = admin.screen();
            const afterUnknown = forwardsTo(recorder, -24_002).length;
            yield* admin.tap('✅ Немає, надіслати в «Second»');
            const resent = admin.screen();

            expect(unknown.text.split('\n')[0]).toBe(
                '⚠️ Не знаю, чи дійшло опитування в «Second». Зазирни туди. Немає — натисни ✅ нижче. Є — нічого не роби: голоси з нього рахуються.'
            );
            expect(labelsOf(unknown)).toContain('✅ Немає, надіслати в «Second»');
            expect(labelsOf(card)).toContain('✅ Немає, надіслати в «Second»');
            expect(labelsOf(card)).not.toContain('📣 Надіслати ще в «Second»');
            expect(afterUnknown).toBe(1);
            expect(forwardsTo(recorder, -24_002)).toHaveLength(2);
            expect(resent.text.split('\n')[0]).toBe('✅ Опитування тепер і в «Second».');
            expect(labelsOf(resent).some(label => label.includes('Second'))).toBe(false);
        })
    );

    it.effect('sends again only once per resend button, even when the old button is tapped after another unknown result', () =>
        Effect.gen(function* () {
            const admin = yield* unknownForward('r4-forward-once', { main: -24_011, second: -24_012, admin: 2411 });
            const card = admin.screen();
            yield* admin.tapOn(card, '✅ Немає, надіслати в «Second»');
            recorder.failures.delete('forwardMessage');
            yield* admin.tapOn(card, '✅ Немає, надіслати в «Second»');
            const latest = admin.screen();
            yield* admin.tap('✅ Немає, надіслати в «Second»');

            expect(forwardsTo(recorder, -24_012)).toHaveLength(3);
            expect(latest.text.split('\n')[0]).toContain('Не знаю, чи дійшло опитування в «Second»');
            expect(admin.screen().text.split('\n')[0]).toBe('✅ Опитування тепер і в «Second».');
        })
    );

    it.effect('drops the unknown-forward warning once the copy is known to be in the group', () =>
        Effect.gen(function* () {
            const admin = yield* unknownForward('r4-forward-arrived', { main: -24_021, second: -24_022, admin: 2421 });
            recorder.failures.delete('forwardMessage');
            yield* deliver({
                message: {
                    message_id: 501,
                    date: 1_795_680_000,
                    chat: { id: -24_022, type: 'supergroup', title: 'Second' },
                    from: { id: 2421, is_bot: false, first_name: 'Admin 2421' },
                    poll: {
                        id: lastPollId(recorder, -24_021),
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
            yield* admin.type('/games');
            yield* admin.tap('Пт 27.11 19:00');
            const card = admin.screen();

            expect(card.text).not.toContain('Не знаю');
            expect(labelsOf(card).some(label => label.includes('Second'))).toBe(false);
        })
    );

    it.effect('retries a forward only to the topic of the first attempt and shows a fresh confirmation after a move', () =>
        Effect.gen(function* () {
            const admin = yield* unknownForward('r5-forward-topic', { main: -24_031, second: -24_032, admin: 2431 });
            recorder.failures.delete('forwardMessage');
            yield* linkGroup(admin.communityId, { chatId: -24_032, title: 'Second', topicId: 5, purpose: 'other' });
            yield* admin.type('/games');
            yield* admin.tap('Пт 27.11 19:00');
            yield* admin.tap('✅ Немає, надіслати в «Second»');
            const fresh = admin.screen();
            const afterMove = forwardsTo(recorder, -24_032).length;
            yield* admin.tap('✅ Надіслати в «Second»');

            expect(afterMove).toBe(1);
            expect(fresh.text.split('\n')[0]).toBe('⚠️ Дані змінилися, нічого не надіслано. Переглянь ще раз і натисни ✅.');
            expect(forwardsTo(recorder, -24_032).map(call => call.payload.message_thread_id)).toEqual([undefined, 5]);
        })
    );
});
