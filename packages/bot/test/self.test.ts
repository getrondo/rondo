import { expect, layer } from '@effect/vitest';
import { auditLog, messageRef, pollVote, telegramPoll } from '@rondo/db/schema/platform.schema';
import { session, signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { conversation, deliver, lastPollId } from './support/conversation';
import { gamesOn, grantOrganizer, seedSeason } from './support/season';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();
const voter = (id: number) => ({ id, is_bot: false as const, first_name: `Voter ${id}` });
const pollIdTo = (chatId: number) => lastPollId(recorder, chatId);
const vote = (pollId: string, id: number, optionIds: number[]) =>
    deliver({ poll_answer: { poll_id: pollId, user: voter(id), option_ids: optionIds, option_persistent_ids: [] } });

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('posting a poll to myself', it => {
    it.effect('posts to myself without a group, counts votes from a forwarded copy and sends notices to my private chat', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedSeason('self-nogroup', { groupChatId: null, adminId: 1101 });
            const admin = conversation(recorder, adminNumbered(1101));
            yield* admin.type('/newgame');
            const main = admin.screen();
            yield* admin.tap('👥 22');
            yield* admin.type('1');
            yield* admin.tap('✅ Надіслати опитування мені');
            const posted = admin.screen().text;
            const pollId = pollIdTo(1101);
            yield* vote(pollId, 9811, [0]);
            yield* vote(pollId, 9812, [0]);
            yield* vote(pollId, 9811, []);
            const [game] = yield* gamesOn(communityId, '2026-11-27');
            const statuses = yield* db
                .select({ status: signup.status })
                .from(signup)
                .where(eq(signup.sessionId, game?.id ?? ''));
            const promoted = recorder.calls.findLast(
                call => call.method === 'sendMessage' && String(call.payload.text).includes('Voter 9812')
            );
            yield* admin.type('/games');
            yield* admin.tap('Пт 27.11 19:00');
            yield* admin.tap('✖️ Скасувати гру');
            yield* admin.tap('Погода');
            yield* admin.tap('✅ Скасувати й надіслати мені');
            const cancelled = recorder.calls.findLast(
                call => call.method === 'sendMessage' && String(call.payload.text).includes('Скасовано')
            );

            expect(main.buttons[0]?.map(button => button.text)).toEqual(['✅ Надіслати опитування мені']);
            expect(posted).toBe('✅ Гру створено, опитування в тебе.\nНатисни й утримуй опитування → Переслати → група.');
            expect(recorder.calls.some(call => call.method === 'pinChatMessage' && call.payload.chat_id === 1101)).toBe(false);
            expect(statuses.map(row => row.status).toSorted()).toEqual(['in', 'out']);
            expect(promoted?.payload.chat_id).toBe(1101);
            expect(cancelled?.payload.chat_id).toBe(1101);
            expect(String(cancelled?.payload.text)).toContain('Перешли');
        })
    );

    it.effect('remembers posting to myself for the next game and keeps two admins apart', () =>
        Effect.gen(function* () {
            const { communityId } = yield* seedSeason('self-remember', { groupChatId: -9101, adminId: 1102 });
            yield* grantOrganizer(communityId, 1103);
            const first = conversation(recorder, adminNumbered(1102));
            const other = conversation(recorder, adminNumbered(1103));
            yield* first.type('/newgame');
            yield* first.tap('📤 Куди');
            yield* first.tap('👤 Тільки мені');
            yield* first.tap('✅ Надіслати опитування мені');
            yield* first.type('/newgame');
            const remembered = first.screen();
            yield* other.type('/newgame');
            const otherMain = other.screen();

            expect(recorder.calls.findLast(call => call.method === 'sendPoll')?.payload.chat_id).toBe(1102);
            expect(remembered.buttons[0]?.map(button => button.text)).toEqual(['✅ Надіслати опитування мені']);
            expect(remembered.text).toContain('Понеділок, 30 листопада');
            expect(otherMain.buttons[0]?.map(button => button.text)).toEqual(['✅ Надіслати в «Games»']);
        })
    );

    it.effect('deletes a future test game without player votes once and refuses one with them', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedSeason('self-delete', { groupChatId: null, adminId: 1104 });
            const admin = conversation(recorder, adminNumbered(1104));
            yield* admin.type('/newgame');
            yield* admin.tap('✅ Надіслати опитування мені');
            yield* vote(pollIdTo(1104), 1104, [0]);
            yield* admin.tap('✏️ Змінити');
            const card = admin.screen();
            const [created] = yield* gamesOn(communityId, '2026-11-27');
            yield* admin.tap('🗑 Видалити');
            const confirmation = admin.screen();
            yield* admin.tapOn(confirmation, '🗑 Видалити назавжди');
            const afterDelete = admin.screen().text;
            yield* admin.tapOn(confirmation, '🗑 Видалити назавжди');
            const [gone] = yield* gamesOn(communityId, '2026-11-27');
            const leftovers = yield* Effect.all([db.select().from(telegramPoll), db.select().from(pollVote), db.select().from(messageRef)]);
            const [audit] = yield* db.select().from(auditLog).where(eq(auditLog.action, 'session.delete'));
            yield* admin.type('/newgame');
            yield* admin.tap('↔️ ');
            yield* admin.tap('✅ Надіслати опитування мені');
            yield* vote(pollIdTo(1104), 9821, [0]);
            yield* admin.type('/games');
            yield* admin.tap('Пн 30.11 18:30');
            const voted = admin.screen();

            expect(card.buttons.flat().map(button => button.text)).toContain('🗑 Видалити');
            expect(confirmation.text).toContain('Видалити гру');
            expect(afterDelete).toContain('Гру видалено');
            expect(gone).toBeUndefined();
            expect(leftovers[0].filter(row => row.sessionId === created?.id)).toEqual([]);
            expect(leftovers[1].filter(row => row.sessionId === created?.id)).toEqual([]);
            expect(leftovers[2].filter(row => row.entityId === created?.id)).toEqual([]);
            expect(recorder.calls.some(call => call.method === 'stopPoll' && call.payload.chat_id === 1104)).toBe(true);
            expect(JSON.stringify(audit?.diff)).not.toContain('Admin');
            expect(voted.buttons.flat().map(button => button.text)).not.toContain('🗑 Видалити');
            expect(voted.buttons.flat().map(button => button.text)).toContain('✖️ Скасувати гру');
            expect(yield* db.select().from(session).where(eq(session.communityId, communityId))).toHaveLength(19);
        })
    );
});
