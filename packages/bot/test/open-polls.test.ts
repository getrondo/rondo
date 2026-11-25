import { expect, layer } from '@effect/vitest';
import { closeFinishedPolls } from '@rondo/core/signups/signup.service';
import { community, telegramChat } from '@rondo/db/schema/org.schema';
import { messageRef, pendingAction, telegramPoll } from '@rondo/db/schema/platform.schema';
import { session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder, refusal } from '@rondo/telegram/testing/recording-telegram.layer';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { runMaintenance } from '../src/jobs/maintenance.job';

import { conversation, labelsOf } from './support/conversation';
import { linkGroup } from './support/groups';
import { gamesOn, grantOrganizer, seedSeason } from './support/season';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();
const methodsTo = (chatId: number) => recorder.calls.filter(call => call.payload.chat_id === chatId).map(call => call.method);
const night = new Date('2026-11-28T03:00:00Z');
const closeButton = '🔒 Закрити опитування';

const posted = Effect.fn('test.postedGame')(function* (slug: string, adminId: number, chatId: number) {
    const { communityId } = yield* seedSeason(slug, { groupChatId: chatId, adminId });
    yield* grantOrganizer(communityId, adminId + 1);
    const approver = conversation(recorder, adminNumbered(adminId));
    const helper = conversation(recorder, adminNumbered(adminId + 1));
    yield* approver.type('/newgame');
    yield* approver.tap('✅ Надіслати');
    const [game] = yield* gamesOn(communityId, '2026-11-27');

    return { communityId, approver, helper, sessionId: game?.id ?? '' };
});

const switchOff = Effect.fn('test.switchOff')(function* (chatId: number) {
    const db = yield* Db;
    yield* db
        .update(telegramChat)
        .set({ isPosting: false })
        .where(eq(telegramChat.chatId, BigInt(chatId)));
});

const setStatus = Effect.fn('test.setStatus')(function* (sessionId: string, status: 'played' | 'cancelled') {
    const db = yield* Db;
    yield* db.update(session).set({ status }).where(eq(session.id, sessionId));
});

const isPollClosed = Effect.fn('test.isPollClosed')(function* (sessionId: string) {
    const db = yield* Db;
    const polls = yield* db.select().from(telegramPoll).where(eq(telegramPoll.sessionId, sessionId));

    return polls.every(poll => poll.closedAt instanceof Date);
});

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('a poll that stays open', it => {
    it.effect('is told to the approver once after the game, and their one tap closes it while the group is off, and nothing else', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { approver, helper, sessionId, communityId } = yield* posted('open-night', 4501, -45_001);
            yield* switchOff(-45_001);
            yield* setStatus(sessionId, 'played');
            const before = approver.seen().length;
            const heard = helper.seen().length;
            const written = methodsTo(-45_001).length;
            yield* runMaintenance(night);
            const told = approver.screen();
            yield* runMaintenance(night);
            const count = approver.seen().length - before;
            yield* linkGroup(communityId, { chatId: -45_001, title: 'Games' });
            const retried = yield* closeFinishedPolls();
            yield* switchOff(-45_001);
            yield* helper.press(told.buttons[0]?.[0]?.callback_data ?? '');
            const early = methodsTo(-45_001).length;
            yield* approver.tapOn(told, closeButton);
            const rows = yield* db.select().from(pendingAction).where(eq(pendingAction.kind, 'close_poll'));

            expect(told.text).toContain('Опитування гри Пт 27.11 19:00 · North Arena ще відкрите в «Games».');
            expect(labelsOf(told)).toEqual([closeButton]);
            expect(count).toBe(1);
            expect(helper.seen()).toHaveLength(heard);
            expect(retried).toEqual([]);
            expect(early).toBe(written);
            expect(methodsTo(-45_001).slice(written)).toEqual(['stopPoll']);
            expect(yield* isPollClosed(sessionId)).toBe(true);
            expect(rows[0]?.payload).toMatchObject({ closes: { chatIds: ['-45001'] } });
            expect(approver.seen().find(message => message.id === told.id)?.text).toContain('Виконано ✅');
        })
    );

    it.effect('keeps its button until the approver answers, also after the group was opened, and comes back after a failed tap', () =>
        Effect.gen(function* () {
            const { approver, sessionId } = yield* posted('open-failed', 4511, -45_011);
            yield* switchOff(-45_011);
            yield* setStatus(sessionId, 'played');
            yield* runMaintenance(night);
            const told = approver.screen();
            yield* approver.press('g:p:1:-45011');
            yield* switchOff(-45_011);
            recorder.failures.set('stopPoll', refusal('stopPoll', 'Bad Gateway', 502));
            yield* approver.tapOn(told, closeButton);
            recorder.failures.delete('stopPoll');
            const failed = approver.seen().find(message => message.id === told.id)?.text;
            const again = approver.seen().at(-1);
            yield* approver.tapOn(again ?? told, closeButton);

            expect(failed).toContain('Не вдалося закрити опитування');
            expect(again?.id).not.toBe(told.id);
            expect(yield* isPollClosed(sessionId)).toBe(true);
        })
    );

    it.effect('is told without a button for a group that is not linked any more, and to the owners when there is no approver', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const gone = yield* posted('open-unlinked', 4521, -45_021);
            yield* db.delete(telegramChat).where(eq(telegramChat.chatId, -45_021n));
            yield* setStatus(gone.sessionId, 'played');
            const orphan = yield* posted('open-orphan', 4531, -45_031);
            yield* db.update(community).set({ approverTgUserId: null }).where(eq(community.id, orphan.communityId));
            yield* setStatus(orphan.sessionId, 'cancelled');
            const owner = conversation(recorder, adminNumbered(42));
            const before = owner.seen().length;
            const heard = orphan.approver.seen().length;
            yield* runMaintenance(night);
            yield* runMaintenance(night);
            const told = owner.seen().slice(before);

            expect(gone.approver.screen().text).toContain('ще відкрите в ❓.');
            expect(gone.approver.screen().buttons).toEqual([]);
            expect(told.map(message => message.text)).toEqual(['🔓 Опитування гри Пт 27.11 19:00 · North Arena ще відкрите в «Games».']);
            expect(told[0]?.buttons).toEqual([]);
            expect(orphan.approver.seen()).toHaveLength(heard);
        })
    );

    it.effect('is offered at the cancellation, and the nightly job does not tell it again', () =>
        Effect.gen(function* () {
            const { approver, helper, sessionId } = yield* posted('open-cancel', 4541, -45_041);
            yield* switchOff(-45_041);
            yield* helper.type('/games');
            yield* helper.tap('Пт 27.11 19:00');
            yield* helper.tap('✖️ Скасувати гру');
            yield* helper.tap('Погода');
            const asked = helper.screen().text;
            yield* helper.tap('без повідомлення');
            const offered = approver.screen();
            const count = approver.seen().length;
            yield* runMaintenance(night);
            const after = approver.seen().length;
            yield* approver.tap(closeButton);

            expect(asked).toContain('Опитування ще відкрите в «Games»: туди зараз не пишу.');
            expect(asked).not.toContain('закриється');
            expect(asked).not.toContain('Закриється');
            expect(helper.screen().text).toContain('Опитування ще відкрите в «Games»');
            expect(labelsOf(offered)).toEqual([closeButton]);
            expect(after).toBe(count);
            expect(yield* isPollClosed(sessionId)).toBe(true);
        })
    );

    it.effect('is offered at the deletion, and the game goes with it', () =>
        Effect.gen(function* () {
            const { approver, helper, communityId } = yield* posted('open-delete', 4551, -45_051);
            yield* switchOff(-45_051);
            const written = methodsTo(-45_051).length;
            yield* helper.type('/games');
            yield* helper.tap('Пт 27.11 19:00');
            yield* helper.tap('🗑 Видалити');
            const asked = helper.screen().text;
            yield* helper.tap('🗑 Видалити назавжди');
            const waiting = helper.screen().text;
            const offered = approver.screen();
            const kept = yield* gamesOn(communityId, '2026-11-27');
            yield* approver.tap('🗑 Закрити й видалити');

            expect(asked).toContain('Опитування ще відкрите в «Games»');
            expect(asked).not.toMatch(/акриється/u);
            expect(waiting).toContain('Закрити його й видалити гру може тільки організатор.');
            expect(waiting).not.toContain('Режим цієї групи');
            expect(labelsOf(offered)).toEqual(['🗑 Закрити й видалити']);
            expect(kept).toHaveLength(1);
            expect(yield* gamesOn(communityId, '2026-11-27')).toEqual([]);
            expect(methodsTo(-45_051).slice(written)).toEqual(['stopPoll']);
        })
    );

    it.effect('gets a fresh button when a copy was recorded after the approver was told', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { approver, communityId, sessionId } = yield* posted('open-copy', 4561, -45_061);
            yield* switchOff(-45_061);
            yield* setStatus(sessionId, 'cancelled');
            yield* runMaintenance(night);
            const told = approver.screen();
            yield* linkGroup(communityId, { chatId: -45_062, title: 'Second', purpose: 'other' });
            yield* db
                .insert(messageRef)
                .values({ chatId: -45_062n, messageId: 900, purpose: 'poll', entityType: 'session', entityId: sessionId });
            yield* approver.tapOn(told, closeButton);
            const early = methodsTo(-45_061).includes('stopPoll');
            const fresh = approver.seen().at(-1) ?? told;
            yield* approver.tapOn(fresh, closeButton);

            expect(early).toBe(false);
            expect(fresh.text).toContain('«Second»');
            expect(yield* isPollClosed(sessionId)).toBe(true);
        })
    );
});

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('the words around a post', it => {
    it.effect('say nothing about a poll the game does not have', () =>
        Effect.gen(function* () {
            const { approver, sessionId } = yield* posted('words-none', 4571, -45_071);
            const db = yield* Db;
            yield* db.delete(telegramPoll).where(eq(telegramPoll.sessionId, sessionId));
            yield* approver.type('/games');
            yield* approver.tap('Пт 27.11 19:00');
            yield* approver.tap('✖️ Скасувати гру');
            yield* approver.tap('Погода');

            expect(approver.screen().text).not.toMatch(/опитування/iu);
        })
    );

    it.effect('name the pin of a poll', () =>
        Effect.gen(function* () {
            yield* seedSeason('words-pin', { groupChatId: -45_081, adminId: 4581 });
            const admin = conversation(recorder, adminNumbered(4581));
            yield* admin.type('/newgame');

            expect(admin.screen().text).toContain('📌 Закріплю його.');
        })
    );
});

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('a request that is withdrawn', it => {
    it.effect('is over for the approver, who is told, and cannot be withdrawn after the answer', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedSeason('withdraw', { groupChatId: -45_091, adminId: 4591 });
            yield* grantOrganizer(communityId, 4592);
            const approver = conversation(recorder, adminNumbered(4591));
            const helper = conversation(recorder, adminNumbered(4592));
            const ask = () => helper.type('/newgame').pipe(Effect.andThen(helper.tap('✅ Надіслати в «Games»')));
            yield* ask();
            const request = approver.screen();
            const own = helper.screen();
            yield* helper.tapOn(own, '↩️ Відкликати запит');
            const withdrawn = helper.screen().text;
            const told = approver.seen().at(-1)?.text;
            yield* approver.tapOn(request, '✅ Надіслати в «Games»');
            const nothing = methodsTo(-45_091);
            yield* ask();
            const second = helper.screen();
            yield* approver.tapOn(approver.seen().at(-1) ?? request, '✅ Надіслати в «Games»');
            yield* helper.tapOn(second, '↩️ Відкликати запит');
            const rows = yield* db
                .select()
                .from(pendingAction)
                .where(eq(pendingAction.communityId, communityId))
                .orderBy(pendingAction.createdAt);

            expect(rows.map(row => row.status)).toEqual(['rejected', 'confirmed']);
            expect(withdrawn).toBe('Скасовано, нічого не змінено.');
            expect(told).toContain('↩️ Запит відкликано. У групу нічого не надіслано.');
            expect(nothing).toEqual([]);
            expect(methodsTo(-45_091)).toContain('sendPoll');
            expect(approver.seen().filter(message => message.text.includes('відкликано'))).toHaveLength(1);
        })
    );
});
