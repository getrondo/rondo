import { expect, it, layer } from '@effect/vitest';
import { describeAction } from '@rondo/core/actions/describe-action';
import { proposeAction } from '@rondo/core/actions/pending-action.service';
import { makeRecorder, refusal } from '@rondo/telegram/testing/recording-telegram.layer';
import * as Effect from 'effect/Effect';

import { handleUpdate } from '../src/handle-update';
import { failureText } from '../src/menu/failure-text';

import { seedSeason } from './support/season';
import { adminNumbered, menuTestLayer } from './support/test-layer';

import type { Action } from '@rondo/core/actions/action.model';

const recorder = makeRecorder();
const adminId = 3401;

let updateId = 880_000;

const answerTo = Effect.fn('test.answerTo')(function* (communityId: string, action: Action, shown?: string) {
    const summary = shown ?? (yield* describeAction(action, 'uk', communityId));
    const actionId = yield* proposeAction({ communityId, tgUserId: BigInt(adminId), action, summary });
    updateId += 1;
    yield* handleUpdate({
        update_id: updateId,
        callback_query: {
            id: `cb-${updateId}`,
            from: adminNumbered(adminId),
            chat_instance: 'x',
            data: `act:${actionId}:y`,
            message: { message_id: 9, date: 0, chat: { id: adminId, type: 'private', first_name: 'Alex' } }
        }
    });

    return String(recorder.calls.findLast(call => call.method === 'editMessageText')?.payload.text)
        .replace(summary, '')
        .trim();
});

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('failures of a proposal of the assistant', suite => {
    suite.effect('are told in the words of the admin, without English and without buttons of the menu', () =>
        Effect.gen(function* () {
            const { communityId } = yield* seedSeason('failure-words', { groupChatId: -34_001, adminId });
            const game = { localDate: '2026-12-24', localTime: '19:00', venueId: null, capacityMax: null, title: null };
            const stranger = yield* answerTo(communityId, { _tag: 'create_session', ...game, announce: true, chatId: '-999' });
            const reworded = yield* answerTo(communityId, { _tag: 'create_session', ...game, announce: true }, 'Гра\n\nІнше');
            recorder.failures.set('sendPoll', refusal('sendPoll', 'Bad Request: not enough rights'));
            const refused = yield* answerTo(communityId, { _tag: 'create_session', ...game, announce: true });
            recorder.failures.set('sendPoll', new Error('socket hang up'));
            const unknown = yield* answerTo(communityId, { _tag: 'create_session', ...game, announce: true });
            recorder.failures.delete('sendPoll');

            expect(stranger).toBe('⚠️ Цей чат не підключено до спільноти, нічого не надіслано.');
            expect(reworded).toBe('⚠️ Дані змінилися, нічого не надіслано. Спробуй ще раз.');
            expect(refused).toBe('⚠️ Telegram не прийняв повідомлення.');
            expect(unknown).toBe('⚠️ Не знаю, чи дійшло повідомлення. Перевір чат, перш ніж пробувати ще раз.');
        })
    );
});

it('fills the numbers of a failure and picks the words for where it happened', () => {
    const group = { where: '«Games»', isPrivate: false };

    expect(failureText('ru', { code: 'poll_too_long', count: 310, limit: 300 }).text).toBe(
        '⚠️ Опрос слишком длинный: 310 символов из 300. Сократи строку.'
    );
    expect(failureText('ru', { code: 'forward_uncertain' }, group).uncertain).toBe(true);
    expect(failureText('ru', { code: 'result_uncertain' }, group).text).toContain('дошёл ли опрос в «Games»');
    expect(failureText('ru', { code: 'result_uncertain' }, { ...group, isPrivate: true }).text).toContain('дошёл ли опрос тебе');
    expect(failureText('ru', { code: 'records_conflict' }).uncertain).toBe(false);
});
