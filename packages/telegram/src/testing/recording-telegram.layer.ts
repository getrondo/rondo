import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { Api } from 'grammy';

import { Telegram, makeTelegramClient } from '../service/telegram.service';

interface RecordedCall {
    readonly method: string;
    readonly payload: Readonly<Record<string, unknown>>;
}

export interface TelegramRecorder {
    readonly calls: RecordedCall[];
    readonly reply: (method: string, payload: Readonly<Record<string, unknown>>) => unknown;
}

let nextMessageId = 1000;

const defaultReply = (method: string, payload: Readonly<Record<string, unknown>>): unknown => {
    nextMessageId += 1;

    if (method === 'sendPoll') {
        return {
            message_id: nextMessageId,
            date: 0,
            chat: { id: payload.chat_id, type: 'supergroup' },
            poll: { id: `poll-${nextMessageId}` }
        };
    }

    return method.startsWith('send') ? { message_id: nextMessageId, date: 0, chat: { id: payload.chat_id, type: 'private' } } : true;
};

export const makeRecorder = (reply: TelegramRecorder['reply'] = defaultReply): TelegramRecorder => ({ calls: [], reply });

export const recordingTelegramLayer = (recorder: TelegramRecorder): Layer.Layer<Telegram> =>
    Layer.effect(
        Telegram,
        Effect.sync(() => {
            const api = new Api('0:test');
            api.config.use(async (_previous, method, payload) => {
                const recorded = { ...(payload as Record<string, unknown>) };
                recorder.calls.push({ method, payload: recorded });

                return await Promise.resolve({ ok: true as const, result: recorder.reply(method, recorded) as never });
            });

            return makeTelegramClient(api);
        })
    );
