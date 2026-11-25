import { expect, layer } from '@effect/vitest';
import { isDefined } from '@rnw-community/shared';
import { processedUpdate } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Logger from 'effect/Logger';
import * as Option from 'effect/Option';
import * as Predicate from 'effect/Predicate';

import { handleUpdate } from '../src/handle-update';

import { seedSeason } from './support/season';
import { adminNumbered, menuTestLayer } from './support/test-layer';

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
            expect(logged.flat().filter(line => Predicate.hasProperty(line, 'kind'))).toEqual([
                { kind: 'edited_message', path: '' },
                { kind: 'message', path: 'message.chat' },
                { kind: 'message', path: 'message.from.id' },
                { kind: 'none', path: '' },
                { kind: 'none', path: '' }
            ]);
        })
    );

    it.effect('accepts a chat type and a member status it does not know', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const chat = { ...groupChat, type: 'community' };
            yield* seedSeason('shape-unknown', { groupChatId: groupChat.id, adminId: 9045 });
            yield* handleUpdate({ update_id: 900_010, message: { message_id: 1, date: 1, chat, from: player, text: 'привет' } });
            yield* handleUpdate({ update_id: 900_011, chat_member: { chat, new_chat_member: { status: 'guest', user: player } } });
            const rows = yield* db.select().from(processedUpdate);

            expect(rows.filter(row => isDefined(row.doneAt)).map(row => row.updateId)).toEqual(expect.arrayContaining([900_010, 900_011]));
        })
    );

    it.effect('logs codes only when a group message fails, here and at the webhook', () =>
        Effect.gen(function* () {
            const { communityId } = yield* seedSeason('shape-log', { groupChatId: -90_044, adminId: 9044 });
            const logged: unknown[] = [];
            const collect = Logger.make(({ message: line, cause }) => {
                logged.push(line, Cause.pretty(cause));
            });
            const chat = { ...groupChat, id: -90_044 };
            const from = { ...adminNumbered(9044), first_name: 'private words\u0000' };
            const failed = yield* handleUpdate({ update_id: 900_020, message: { message_id: 1, date: 1, chat, from, text: 'x' } }).pipe(
                Effect.tapCause(Effect.logError),
                Effect.provide(Logger.layer([collect])),
                Effect.flip
            );
            const question = 'Вівторок, 1 грудня, 19.00 Secret Meadow';
            const poll = { id: 'shape', question, options: [{ text: '+' }, { text: '-' }] };
            yield* handleUpdate({
                update_id: 900_021,
                message: { message_id: 2, date: 1_764_500_000, chat, from: adminNumbered(9044), poll }
            }).pipe(Effect.provide(Logger.layer([collect])));

            expect(communityId).not.toBe('');
            expect(failed._tag).toBe('UpdateFailedError');
            expect(JSON.stringify(logged)).toContain('EffectDrizzleQueryError');
            expect(JSON.stringify(logged)).toContain('extracted');
            expect(JSON.stringify(logged)).not.toContain('Failed query');
            expect(JSON.stringify(logged)).not.toContain('private words');
            expect(JSON.stringify(logged)).not.toContain('Secret Meadow');
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
