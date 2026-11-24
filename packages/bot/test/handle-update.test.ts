import { expect, layer } from '@effect/vitest';
import { isDefined } from '@rnw-community/shared';
import { AiGateway } from '@rondo/assistant/service/ai-gateway.service';
import { Access } from '@rondo/core/access/admin-access';
import { seedCommunity, seedConfig } from '@rondo/core/testing/seed-community';
import { processedUpdate, telegramPoll } from '@rondo/db/schema/platform.schema';
import { session, signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { testDbLayer } from '@rondo/db/testing/test-db.layer';
import { makeRecorder, recordingTelegramLayer } from '@rondo/telegram/testing/recording-telegram.layer';
import { MockLanguageModelV4 } from 'ai/test';
import { eq } from 'drizzle-orm';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';

import { handleUpdate } from '../src/handle-update';

import type { Update } from 'grammy/types';

const owner = { id: 42, is_bot: false, first_name: 'Alex', language_code: 'uk' };
const player = { id: 77, is_bot: false, first_name: 'Ivan', language_code: 'ru' };
const groupChat = { id: -100_500, type: 'supergroup' as const, title: 'Football' };
const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } };

let modelCalls = 0;
const model = new MockLanguageModelV4({
    doGenerate: async () => {
        modelCalls += 1;

        return await Promise.resolve(
            modelCalls === 1
                ? {
                      content: [
                          {
                              type: 'tool-call' as const,
                              toolCallId: 'call-1',
                              toolName: 'propose_create_session',
                              input: JSON.stringify({ localDate: '2026-12-04', localTime: '19:30', capacityMax: 14, announce: true })
                          }
                      ],
                      finishReason: { unified: 'tool-calls' as const, raw: 'tool_use' },
                      usage,
                      warnings: []
                  }
                : {
                      content: [{ type: 'text' as const, text: 'Гра готова до підтвердження.' }],
                      finishReason: { unified: 'stop' as const, raw: 'end_turn' },
                      usage,
                      warnings: []
                  }
        );
    }
});

const recorder = makeRecorder();
let updateId = 1;
const nextUpdate = (body: Omit<Update, 'update_id'>): Update => {
    updateId += 1;

    return { update_id: updateId, ...body };
};
const message = (
    from: typeof owner,
    chat: { readonly id: number; readonly type: 'private' | 'supergroup'; readonly title?: string },
    text: string
) => nextUpdate({ message: { message_id: updateId, date: 1_764_500_000, chat: chat as never, from, text } });

const testLayer = Layer.mergeAll(
    testDbLayer,
    recordingTelegramLayer(recorder),
    AiGateway.layerFor(model),
    Access.layerFor([BigInt(owner.id)])
);

layer(testLayer, { timeout: 60_000 })('telegram webhook updates', it => {
    it.effect('lets the owner link the group, create a game through the assistant, confirm it and collect sign-ups', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedCommunity(seedConfig('e2e-fc'));

            yield* handleUpdate(message(owner, groupChat, '/link e2e-fc'));
            yield* handleUpdate(
                message(owner, { id: owner.id, type: 'private' }, 'створи гру в пʼятницю 4 грудня о 19:30 на 14 людей і оголоси')
            );
            const proposal = recorder.calls.find(call => call.method === 'sendMessage' && isDefined(call.payload.reply_markup));
            const keyboard = proposal?.payload.reply_markup as { inline_keyboard: { callback_data: string }[][] } | undefined;
            const confirmData = keyboard?.inline_keyboard[0]?.[0]?.callback_data ?? '';

            yield* handleUpdate(
                nextUpdate({
                    callback_query: {
                        id: 'cb-1',
                        from: owner,
                        chat_instance: 'x',
                        data: confirmData,
                        message: { message_id: 9, date: 0, chat: { id: owner.id, type: 'private', first_name: 'Alex' } }
                    }
                })
            );
            const [created] = yield* db.select().from(session).where(eq(session.communityId, communityId));
            const poll = recorder.calls.find(call => call.method === 'sendPoll');
            const [stored] = yield* db
                .select({ pollId: telegramPoll.pollId })
                .from(telegramPoll)
                .where(eq(telegramPoll.sessionId, created?.id ?? ''));
            const answer = nextUpdate({
                poll_answer: { poll_id: stored?.pollId ?? '', user: player, option_ids: [0], option_persistent_ids: ['in'] }
            });
            yield* handleUpdate(answer);
            yield* handleUpdate(answer);
            const signups = yield* db
                .select()
                .from(signup)
                .where(eq(signup.sessionId, created?.id ?? ''));

            expect(
                recorder.calls.some(call => call.method === 'sendMessage' && String(call.payload.text).includes('Групу підключено'))
            ).toBe(true);
            expect(String(proposal?.payload.text)).toContain('➕ Нова гра: Пт 04.12 19:30, 14 місць');
            expect(confirmData).toMatch(/^act:[\da-f-]{36}:y$/u);
            expect(created).toMatchObject({ localDate: '2026-12-04', capacityMax: 14, status: 'open' });
            expect(poll?.payload).toMatchObject({ chat_id: groupChat.id });
            expect(recorder.calls.some(call => call.method === 'editMessageText' && String(call.payload.text).includes('Виконано'))).toBe(
                true
            );
            expect(signups.map(row => row.status)).toEqual(['in']);
        })
    );

    it.effect('answers members who are not admins without calling the model', () =>
        Effect.gen(function* () {
            const before = modelCalls;

            yield* handleUpdate(message(player, { id: player.id, type: 'private' }, 'привет'));
            const reply = recorder.calls.at(-1);

            expect(modelCalls).toBe(before);
            expect(String(reply?.payload.text)).toContain('Пока я работаю с администраторами');
        })
    );

    it.effect('retries a failed update up to three times and ignores confirmations outside a private chat', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const failing = message({ ...owner, id: Number.NaN }, groupChat, 'boom');
            const exits = yield* Effect.all(Array.from({ length: 4 }, () => Effect.exit(handleUpdate(failing))));
            const [stored] = yield* db.select().from(processedUpdate).where(eq(processedUpdate.updateId, failing.update_id));
            const edits = recorder.calls.filter(call => call.method === 'editMessageText').length;
            yield* handleUpdate(
                nextUpdate({
                    callback_query: {
                        id: 'cb-2',
                        from: owner,
                        chat_instance: 'x',
                        data: 'act:00000000-0000-7000-8000-000000000000:y',
                        message: { message_id: 9, date: 0, chat: groupChat }
                    }
                })
            );

            expect(exits.map(exit => exit._tag)).toEqual(['Failure', 'Failure', 'Failure', 'Success']);
            expect(stored).toMatchObject({ attempts: 3, doneAt: null });
            expect(recorder.calls.filter(call => call.method === 'editMessageText')).toHaveLength(edits);
        })
    );

    it.effect('does not run an update that another attempt is still handling', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const update = message(player, { id: player.id, type: 'private' }, 'привет');
            const at = yield* DateTime.nowAsDate;
            yield* db.insert(processedUpdate).values({ updateId: update.update_id, at });
            const calls = recorder.calls.length;
            const error = yield* Effect.flip(handleUpdate(update));

            expect(error).toMatchObject({ _tag: 'UpdateInProgressError' });
            expect(recorder.calls).toHaveLength(calls);
        })
    );
});
