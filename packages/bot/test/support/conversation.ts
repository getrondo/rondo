import { isDefined } from '@rnw-community/shared';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { handleUpdate } from '../../src/handle-update';

import type { TelegramRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import type { Update } from 'grammy/types';

interface Button {
    readonly text: string;
    readonly callback_data?: string;
    readonly url?: string;
}

interface ShownMessage {
    readonly id: number;
    readonly text: string;
    readonly buttons: readonly (readonly Button[])[];
}

export interface Person {
    readonly id: number;
    readonly is_bot: false;
    readonly first_name: string;
    readonly language_code?: string;
}

let nextUpdateId = 50_000;

const keyboardOf = (markup: unknown): readonly (readonly Button[])[] =>
    (markup as { inline_keyboard?: Button[][] } | undefined)?.inline_keyboard ?? [];

export const deliver = (body: Omit<Update, 'update_id'> & { readonly update_id?: number }) => {
    nextUpdateId += 1;

    return handleUpdate({ update_id: nextUpdateId, ...body }).pipe(Effect.flatMap(Option.getOrElse(() => Effect.void)));
};

export const conversation = (recorder: TelegramRecorder, user: Person) => {
    const chat = { id: user.id, type: 'private' as const, first_name: user.first_name };
    const messages = () => {
        const shown = new Map<number, ShownMessage>();
        let last: number | null = null;

        for (const call of recorder.calls.filter(entry => entry.payload.chat_id === user.id && isDefined(entry.result))) {
            const result = call.result as { message_id?: number } | true;
            const id = call.method === 'sendMessage' && result !== true ? (result.message_id ?? 0) : Number(call.payload.message_id);

            if (call.method === 'sendMessage' || call.method === 'editMessageText') {
                shown.set(id, { id, text: String(call.payload.text), buttons: keyboardOf(call.payload.reply_markup) });
                last = id;
            }
        }

        return { shown, last };
    };
    const screen = (): ShownMessage => {
        const { shown, last } = messages();

        return shown.get(last ?? 0) ?? { id: 0, text: '', buttons: [] };
    };
    const buttonsOf = (message: ShownMessage) => message.buttons.flat();
    const find = (label: string, message: ShownMessage) =>
        buttonsOf(message).find(button => button.text === label) ?? buttonsOf(message).find(button => button.text.includes(label));
    const pressed: string[] = [];
    const press = (message: ShownMessage, data: string) =>
        deliver({
            callback_query: {
                id: `cb-${pressed.push(`cb-${nextUpdateId + 1}`) && nextUpdateId + 1}`,
                from: user,
                chat_instance: 'private',
                data,
                message: { message_id: message.id, date: 0, chat }
            }
        });

    return {
        screen,
        labels: () => screen().buttons.map(row => row.map(button => button.text)),
        type: (text: string) => deliver({ message: { message_id: nextUpdateId, date: 0, chat, from: user, text } }),
        location: (latitude: number, longitude: number) =>
            deliver({ message: { message_id: nextUpdateId, date: 0, chat, from: user, location: { latitude, longitude } } }),
        tap: (label: string) =>
            Effect.gen(function* () {
                const message = screen();
                const button = find(label, message);

                if (!isDefined(button?.callback_data)) {
                    return yield* Effect.die(
                        new Error(`no button "${label}" in ${JSON.stringify(message.buttons.map(row => row.map(entry => entry.text)))}`)
                    );
                }

                return yield* press(message, button.callback_data);
            }),
        tapOn: (message: ShownMessage, label: string) => press(message, find(label, message)?.callback_data ?? 'm:gone'),
        press: (data: string) => press(screen(), data),
        tidy: () => {
            const answered = new Set(
                recorder.calls.filter(call => call.method === 'answerCallbackQuery').map(call => call.payload.callback_query_id)
            );
            const data = recorder.calls.flatMap(call =>
                keyboardOf(call.payload.reply_markup)
                    .flat()
                    .map(button => button.callback_data ?? '')
            );

            return { unanswered: pressed.filter(id => !answered.has(id)), oversized: data.filter(entry => Buffer.byteLength(entry) > 64) };
        }
    };
};

export const labelsOf = (screen: { readonly buttons: readonly (readonly { readonly text: string }[])[] }) =>
    screen.buttons.flat().map(button => button.text);

export const lastPollId = (recorder: TelegramRecorder, chatId: number) =>
    (
        recorder.calls.findLast(call => call.method === 'sendPoll' && call.payload.chat_id === chatId)?.result as
            | { poll?: { id?: string } }
            | undefined
    )?.poll?.id ?? '';

export const walkManual = (admin: ReturnType<typeof conversation>, labels: readonly string[]) =>
    Effect.all(
        labels.map(label => admin.tap(label)),
        { concurrency: 1 }
    );
