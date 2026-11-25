import { expect, layer } from '@effect/vitest';
import { processedUpdate } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import * as Effect from 'effect/Effect';
import * as Logger from 'effect/Logger';
import * as Option from 'effect/Option';

import { handleUpdate } from '../src/handle-update';

import { menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();
const player = { id: 77, is_bot: false, first_name: 'Ivan', language_code: 'ru' };
const groupChat = { id: -100_500, type: 'supergroup', title: 'Football' };

layer(menuTestLayer(recorder), { timeout: 60_000 })('shapes of updates', it => {
    it.effect('accepts unknown and broken updates without a claim, a call or their content in the log', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const before = yield* db.select().from(processedUpdate);
            const calls = recorder.calls.length;
            const logged: unknown[] = [];
            const collect = Logger.make(({ message: line }) => {
                logged.push(line);
            });
            const payloads = [
                { update_id: 900_000, edited_message: { message_id: 1, date: 1, chat: groupChat, from: player, text: 'private words' } },
                { update_id: 900_001, message: { message_id: 1, date: 1, text: 'private words' } },
                { update_id: 900_002, message: { message_id: 1, date: 1, chat: groupChat, from: { ...player, id: 'private words' } } },
                { update_id: 'private words' },
                null
            ];
            const followUps = yield* Effect.all(payloads.map(payload => handleUpdate(payload))).pipe(
                Effect.provide(Logger.layer([collect]))
            );
            const after = yield* db.select().from(processedUpdate);

            expect(followUps.every(followUp => Option.isNone(followUp))).toBe(true);
            expect(after).toHaveLength(before.length);
            expect(recorder.calls).toHaveLength(calls);
            expect(logged).toHaveLength(payloads.length);
            expect(JSON.stringify(logged)).toContain('900002');
            expect(JSON.stringify(logged)).not.toContain('private words');
        })
    );

    it.effect('lets fields it does not know pass', () =>
        Effect.gen(function* () {
            const chat = { id: player.id, type: 'private', new_field: 1 };
            const message = { message_id: 1, date: 1_764_500_000, chat, from: player, text: 'привет', new_field: { deep: [1] } };
            const calls = recorder.calls.length;
            yield* handleUpdate({ update_id: 900_003, new_field: 1, message });

            expect(recorder.calls.length).toBeGreaterThan(calls);
        })
    );
});
