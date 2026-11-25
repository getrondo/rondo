import { expect, layer } from '@effect/vitest';
import { describeAction } from '@rondo/core/actions/describe-action';
import { proposeAction } from '@rondo/core/actions/pending-action.service';
import { linkGroup } from '@rondo/core/testing/link-group';
import { community, telegramChat } from '@rondo/db/schema/org.schema';
import { auditLog, pendingAction } from '@rondo/db/schema/platform.schema';
import { session, signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { defaultReply, makeRecorder, refusal } from '@rondo/telegram/testing/recording-telegram.layer';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { runTeamsTick } from '../src/jobs/teams.job';

import { conversation, deliver, forwardsTo, labelsOf, lastPollId, pollsTo } from './support/conversation';
import { advanceNow } from './support/fixed-clock';
import { gamesOn, grantOrganizer, seedSeason, thursdayMorning } from './support/season';
import { teamsGame } from './support/teams-game';
import { buttonData, openOverview } from './support/teams-screen';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const blocked = new Set<unknown>();
const recorder = makeRecorder((method, payload) => {
    if (method === 'sendMessage' && blocked.has(payload.chat_id)) {
        throw refusal(method, 'Forbidden: bot was kicked', 403);
    }

    return defaultReply(method, payload);
});
const sentTo = (chatId: number) => recorder.calls.filter(call => call.payload.chat_id === chatId);
const writesTo = (chatId: number) => sentTo(chatId).map(call => call.method);

// The approver has the group, the helper is another admin
const twoAdmins = Effect.fn('test.twoAdmins')(function* (slug: string, approverId: number, chatId: number) {
    const seeded = yield* seedSeason(slug, { groupChatId: chatId, adminId: approverId });
    yield* grantOrganizer(seeded.communityId, approverId + 1);

    return {
        ...seeded,
        approver: conversation(recorder, adminNumbered(approverId)),
        helper: conversation(recorder, adminNumbered(approverId + 1, 'ru'))
    };
});

const proposed = Effect.fn('test.proposed')(function* (helper: ReturnType<typeof conversation>) {
    yield* helper.type('/newgame');
    yield* helper.tap('✅ Отправить в «Games»');
});

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('a post of another admin', it => {
    it.effect('reaches the group only after the approver saw exactly it and tapped ✅, and the other admin hears the outcome', () =>
        Effect.gen(function* () {
            const { approver, helper, communityId } = yield* twoAdmins('approve-yes', 4201, -42_001);
            yield* proposed(helper);
            const waiting = helper.screen();
            const request = approver.screen();
            const before = sentTo(-42_001).length;
            yield* approver.tap('✅ Надіслати в «Games»');
            const [poll] = pollsTo(recorder, -42_001);
            yield* approver.tapOn(request, '✅ Надіслати в «Games»');
            const [game] = yield* gamesOn(communityId, '2026-11-27');

            expect(waiting.text).toBe('⏳ Ждём Admin 4201. В группу ещё ничего не отправлено.');
            expect(before).toBe(0);
            expect(request.text).toContain('🙋 <b>Admin 4202</b> хоче написати в «Games»:');
            expect(request.text).toContain('Без твого ✅ у групу нічого не піде.');
            expect(labelsOf(request)).toEqual(['✅ Надіслати в «Games»', '✏️ Змінити', '✖️ Не надсилати']);
            expect(request.text).toContain(String(poll?.payload.question).split('\n')[0]);
            expect(pollsTo(recorder, -42_001)).toHaveLength(1);
            expect(game?.status).toBe('open');
            expect(helper.screen().text).toContain('✅ Подтверждено и отправлено.');
        })
    );

    it.effect('stays out of the group after ✖️, and the other admin cannot approve it', () =>
        Effect.gen(function* () {
            const { approver, helper, communityId } = yield* twoAdmins('approve-no', 4211, -42_011);
            yield* proposed(helper);
            const request = approver.screen();
            const data = request.buttons[0]?.[0]?.callback_data ?? '';
            yield* helper.press(data);
            const own = sentTo(-42_011).length;
            yield* approver.tap('✖️ Не надсилати');
            yield* approver.tapOn(request, '✅ Надіслати в «Games»');

            expect(own).toBe(0);
            expect(sentTo(-42_011)).toEqual([]);
            expect(yield* gamesOn(communityId, '2026-11-27')).toEqual([]);
            expect(helper.screen().text).toContain('✖️ Не подтверждено. В группу ничего не отправлено.');
        })
    );

    it.effect('opens for a change by the approver, who then posts it as their own', () =>
        Effect.gen(function* () {
            const { approver, helper } = yield* twoAdmins('approve-edit', 4221, -42_021);
            yield* proposed(helper);
            yield* approver.tap('✏️ Змінити');
            const draft = approver.screen();
            yield* approver.type('14');
            yield* approver.tap('✅ Надіслати в «Games»');
            const [poll] = pollsTo(recorder, -42_021);

            expect(draft.text).toContain('Опитування буде таким:');
            expect(helper.screen().text).toContain('✏️ Организатор изменит это. В группу ничего не отправлено.');
            expect(String(poll?.payload.question)).toContain('14 місць');
            expect(pollsTo(recorder, -42_021)).toHaveLength(1);
        })
    );

    it.effect('must be approved again after a change, and runs out at the kick-off', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { approver, helper, communityId } = yield* twoAdmins('approve-again', 4231, -42_031);
            yield* proposed(helper);
            const first = approver.screen();
            yield* db
                .update(community)
                .set({ settings: { ingest: {}, poll: { question: 'Інший текст {date}', answers: ['+', '-'] } } })
                .where(eq(community.id, communityId));
            yield* approver.tap('✅ Надіслати в «Games»');
            const changed = approver.seen().find(message => message.id === first.id);
            yield* proposed(helper);
            const second = approver.screen();
            yield* advanceNow(40 * 60 * 60_000);
            yield* approver.tapOn(second, '✅ Надіслати в «Games»');

            expect(changed?.text).toContain('Дані змінилися, нічого не надіслано.');
            expect(approver.seen().find(message => message.id === second.id)?.text).toBe('Час на підтвердження минув.');
            expect(writesTo(-42_031)).toEqual([]);
        })
    );

    it.effect('covers changes, forwards and quiet cancellations too', () =>
        Effect.gen(function* () {
            const { approver, helper, communityId } = yield* twoAdmins('approve-all', 4241, -42_041);
            yield* approver.type('/newgame');
            yield* approver.tap('✅ Надіслати');
            yield* linkGroup(communityId, { chatId: -42_042, title: 'Second', purpose: 'other' });
            const start = sentTo(-42_041).length;
            const openCard = (time: string) => helper.type('/games').pipe(Effect.andThen(helper.tap(`Пт 27.11 ${time}`)));
            yield* openCard('19:00');
            yield* helper.tap('🕖 Время');
            yield* helper.tap('19:30');
            yield* helper.tap('✅ Изменить и написать в «Games»');
            const change = approver.screen();
            const untouched = yield* gamesOn(communityId, '2026-11-27');
            yield* approver.tap('✅ Надіслати в «Games»');
            const notice = sentTo(-42_041).at(-1);
            yield* openCard('19:30');
            yield* helper.tap('📣 Отправить ещё в «Second»');
            yield* helper.tap('✅ Отправить в «Second»');
            const previewed = forwardsTo(recorder, 4241).length;
            const early = writesTo(-42_042);
            yield* approver.tap('✅ Надіслати в «Second»');
            yield* openCard('19:30');
            yield* helper.tap('✖️ Отменить игру');
            yield* helper.tap('Погода');
            yield* helper.tap('Отменить, в группу не писать');
            const quiet = approver.screen();
            const beforeClose = writesTo(-42_041).filter(method => method === 'stopPoll');
            yield* approver.tap('✅ Так');
            const games = yield* gamesOn(communityId, '2026-11-27');

            expect(start).toBe(2);
            expect(change.text).toContain('19:00 → 19:30');
            expect(untouched.map(game => game.startsAt.toISOString())).toEqual(['2026-11-27T18:00:00.000Z']);
            expect(notice?.method).toBe('sendMessage');
            expect(change.text).toContain('🕐 Час: 19:00 → 19:30');
            expect(previewed).toBe(1);
            expect(early).toEqual([]);
            expect(writesTo(-42_042)).toContain('forwardMessage');
            expect(quiet.text).toContain('хоче написати в «Games»');
            expect(beforeClose).toEqual([]);
            expect(writesTo(-42_041)).toContain('stopPoll');
            expect(games.map(game => game.status)).toEqual(['cancelled']);
        })
    );

    it.effect('sends the squads of another admin to the approver first', () =>
        Effect.gen(function* () {
            const { communityId, sessionId } = yield* teamsGame('approve-teams', { groupChatId: -42_051, adminId: 4251, players: 10 });
            yield* grantOrganizer(communityId, 4252);
            const approver = conversation(recorder, adminNumbered(4251));
            const helper = conversation(recorder, adminNumbered(4252));
            yield* openOverview(helper);
            const preview = helper.screen().text.split('\n').slice(0, 4).join('\n');
            yield* helper.press(buttonData(helper.screen(), '✅ Надіслати в «Games»'));
            const waiting = helper.screen().text;
            const request = approver.screen();
            const early = sentTo(-42_051).length;
            yield* approver.tap('✅ Надіслати в «Games»');
            const posted = String(sentTo(-42_051).at(-1)?.payload.text);

            expect(sessionId).not.toBe('');
            expect(waiting).toContain('⏳ Чекаємо на Admin 4251. У групу ще нічого не надіслано.');
            expect(early).toBe(0);
            expect(request.text).toContain('👥 Опублікувати склади');
            expect(posted.split('\n').slice(0, 4).join('\n')).toBe(preview);
        })
    );

    it.effect('posts nothing and tells the owner when nobody can approve or the approver never opened the bot', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { helper, communityId } = yield* twoAdmins('approve-unheard', 4261, -42_061);
            yield* db.delete(auditLog).where(eq(auditLog.action, 'ownerNoApprover'));
            yield* helper.type('/newgame');
            const form = helper.screen();
            recorder.failures.set('sendMessage', refusal('sendMessage', 'Forbidden: bot can not initiate conversation', 403));
            yield* helper.tapOn(form, '✅ Отправить в «Games»');
            recorder.failures.delete('sendMessage');
            const unheard = helper.screen().text;
            yield* db.update(community).set({ approverTgUserId: null }).where(eq(community.id, communityId));
            yield* proposed(helper);
            const rows = yield* db.select().from(pendingAction).where(eq(pendingAction.communityId, communityId));

            expect(unheard).toContain('Организатор ещё не открывал бота, в группу ничего не отправлено.');
            expect(helper.screen().text).toContain('Некому подтвердить, в группу ничего не отправлено.');
            expect(sentTo(42).some(call => String(call.payload.text).includes('Організатор недоступний'))).toBe(true);
            expect(rows.map(row => row.status)).toEqual(['failed', 'failed']);
            expect(sentTo(-42_061)).toEqual([]);
        })
    );
});

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('what a request and its result say', it => {
    it.effect('previews a forward with the poll itself and sends nothing when it cannot be shown', () =>
        Effect.gen(function* () {
            const { approver, communityId } = yield* twoAdmins('say-forward', 4401, -44_001);
            yield* approver.type('/newgame');
            yield* approver.tap('✅ Надіслати');
            yield* linkGroup(communityId, { chatId: -44_002, title: 'Second', purpose: 'other' });
            yield* approver.type('/games');
            yield* approver.tap('Пт 27.11 19:00');
            const card = approver.screen();
            recorder.failures.set('forwardMessage', refusal('forwardMessage', 'Bad Request: message to forward not found'));
            yield* approver.tap('📣 Надіслати ще в «Second»');
            recorder.failures.delete('forwardMessage');
            const hidden = approver.screen();
            yield* approver.tapOn(card, '📣 Надіслати ще в «Second»');
            const shown = approver.screen().text;
            const [preview] = forwardsTo(recorder, 4401).slice(-1);
            yield* approver.tap('✅ Надіслати в «Second»');
            const [sent] = forwardsTo(recorder, -44_002);

            expect(labelsOf(hidden).some(label => label.startsWith('✅'))).toBe(false);
            expect(shown).toContain('Надішлю саме це опитування 👇');
            expect(preview?.payload.message_id).toBe(sent?.payload.message_id);
            expect(forwardsTo(recorder, -44_002)).toHaveLength(1);
        })
    );

    it.effect('tells the other admin once, within the hour, that the time for an approval ran out', () =>
        Effect.gen(function* () {
            const { helper } = yield* twoAdmins('say-expired', 4411, -44_011);
            yield* proposed(helper);
            yield* advanceNow(40 * 60 * 60_000);
            yield* runTeamsTick(new Date(thursdayMorning + 40 * 60 * 60_000));
            const told = helper.screen().text;
            const count = helper.seen().length;
            yield* runTeamsTick(new Date(thursdayMorning + 41 * 60 * 60_000));

            expect(told).toContain('⌛ Время на подтверждение истекло. В группу ничего не отправлено.');
            expect(helper.seen()).toHaveLength(count);
            expect(sentTo(-44_011)).toEqual([]);
        })
    );

    it.effect('names the group whose poll stays open, what was sent and what was not', () =>
        Effect.gen(function* () {
            const { approver, communityId } = yield* twoAdmins('say-result', 4421, -44_021);
            yield* linkGroup(communityId, { chatId: -44_021, title: '<i>Games</i>' });
            yield* approver.type('/newgame');
            yield* approver.tap('✅ Надіслати');
            yield* linkGroup(communityId, { chatId: -44_022, title: 'Second', purpose: 'other' });
            const card = (time: string) => approver.type('/games').pipe(Effect.andThen(approver.tap(`Пт 27.11 ${time}`)));
            yield* card('19:00');
            yield* approver.tap('📣 Надіслати ще в «Second»');
            yield* approver.tap('✅ Надіслати в «Second»');
            yield* card('19:00');
            yield* approver.tap('🕖 Час');
            yield* approver.tap('19:30');
            blocked.add(-44_022);
            yield* approver.tap('✅ Змінити й написати');
            blocked.clear();
            const partial = approver.screen().text;
            yield* linkGroup(communityId, { chatId: -44_022, title: 'Second', purpose: 'other', isPosting: false });
            yield* card('19:30');
            yield* approver.tap('✖️ Скасувати гру');
            yield* approver.tap('Погода');
            yield* approver.tap('Скасувати, у групу не писати');

            expect(partial).toContain('Надіслано: «&lt;i&gt;Games&lt;/i&gt;». Не дійшло або невідомо: «Second».');
            expect(approver.screen().text).toContain('Опитування ще відкрите в «&lt;i&gt;Games&lt;/i&gt;», «Second»');
            expect(writesTo(-44_021)).not.toContain('stopPoll');
        })
    );

    it.effect('fits the request into one message', () =>
        Effect.gen(function* () {
            const { helper, approver, communityId } = yield* twoAdmins('say-long', 4431, -44_031);
            const action = {
                _tag: 'create_session' as const,
                localDate: '2026-12-11',
                localTime: '19:00',
                venueId: null,
                capacityMax: null,
                title: null,
                announce: true,
                chatId: '-44031'
            };
            const actionId = yield* proposeAction({ communityId, tgUserId: 4432n, action, summary: `Гра\n\n${'<'.repeat(5000)}` });
            yield* helper.type('/menu');
            yield* helper.press(`act:${actionId}:y`);
            const sent = String(sentTo(4431).at(-1)?.payload.text);

            expect(approver.screen().buttons.length).toBeGreaterThan(0);
            expect(sent.split('&lt;').length).toBeGreaterThan(3000);
            expect(sent.replaceAll('&lt;', '<').length).toBeLessThan(4096);
        })
    );
});

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('switches of a group', it => {
    it.effect('mentions a promoted player in the group only after that switch was turned on', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { approver, communityId } = yield* twoAdmins('switch-mention', 4301, -43_001);
            yield* linkGroup(communityId, { chatId: -43_001, title: 'Games', isMentioning: false });
            yield* approver.type('/newgame');
            yield* approver.tap('✅ Надіслати');
            const [game] = yield* gamesOn(communityId, '2026-11-27');
            yield* db
                .update(session)
                .set({ capacityMax: 1 })
                .where(eq(session.id, game?.id ?? ''));
            const vote = (id: number, optionIds: number[]) =>
                deliver({
                    poll_answer: {
                        poll_id: lastPollId(recorder, -43_001),
                        user: { id, is_bot: false, first_name: `V${id}` },
                        option_ids: optionIds,
                        option_persistent_ids: []
                    }
                });
            yield* vote(43_011, [0]);
            yield* vote(43_012, [0]);
            yield* vote(43_011, [1]);
            const silent = writesTo(-43_001).filter(method => method === 'sendMessage').length;
            const promoted = yield* db
                .select()
                .from(signup)
                .where(eq(signup.sessionId, game?.id ?? ''));
            yield* approver.type('/menu');
            yield* approver.tap('👥 Групи');
            yield* approver.tap('Games');
            const screen = approver.screen();
            yield* approver.tap('🔔 Кликати з резерву без мене');
            yield* vote(43_011, [0]);
            yield* vote(43_012, [1]);
            const loud = sentTo(-43_001).filter(call => call.method === 'sendMessage');

            expect(promoted.filter(row => row.status === 'in')).toHaveLength(1);
            expect(silent).toBe(0);
            expect(screen.text).toContain('можу сам написати «🎉 Імʼя, звільнилося місце — ти в складі!»');
            expect(loud).toHaveLength(1);
            expect(String(loud[0]?.payload.text)).toContain('звільнилося місце');
        })
    );

    it.effect('sends the notice of a switched off group to the admin to forward', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { approver } = yield* twoAdmins('switch-off', 4311, -43_011);
            yield* approver.type('/newgame');
            yield* approver.tap('✅ Надіслати');
            yield* db.update(telegramChat).set({ isPosting: false }).where(eq(telegramChat.chatId, -43_011n));
            const start = sentTo(-43_011).length;
            yield* approver.type('/games');
            yield* approver.tap('Пт 27.11 19:00');
            yield* approver.tap('🕖 Час');
            yield* approver.tap('19:30');
            yield* approver.tap('✅ Змінити й надіслати мені');

            expect(sentTo(-43_011)).toHaveLength(start);
            expect(approver.seen().some(message => message.text.includes('🕐 Час: 19:00 → 19:30') && message.text.includes('↪️'))).toBe(
                true
            );
        })
    );

    it.effect('drops what was proposed before the group was opened', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { approver, communityId } = yield* twoAdmins('switch-drain', 4321, -43_021);
            yield* linkGroup(communityId, { chatId: -43_021, title: 'Games', isPosting: false });
            const action = {
                _tag: 'create_session' as const,
                localDate: '2026-12-11',
                localTime: '19:00',
                venueId: null,
                capacityMax: null,
                title: null,
                announce: true,
                chatId: '-43021'
            };
            const summary = yield* describeAction(action, 'uk', communityId);
            const actionId = yield* proposeAction({ communityId, tgUserId: 4321n, action, summary });
            yield* approver.type('/menu');
            yield* approver.tap('👥 Групи');
            yield* approver.tap('Games');
            yield* approver.tap('📣 Писати в групу після мого ✅');
            yield* approver.press(`act:${actionId}:y`);
            const [row] = yield* db.select().from(pendingAction).where(eq(pendingAction.id, actionId));

            expect(row?.status).toBe('expired');
            expect(approver.screen().text).toBe('Час на підтвердження минув.');
            expect(sentTo(-43_021)).toEqual([]);
        })
    );
});
