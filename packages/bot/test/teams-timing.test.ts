import { expect, layer } from '@effect/vitest';
import { cancelSession, getSession } from '@rondo/core/sessions/session.service';
import { adminState, telegramPoll } from '@rondo/db/schema/platform.schema';
import { rating, team } from '@rondo/db/schema/play.schema';
import { session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { runTeamsTick } from '../src/jobs/teams.job';

import { conversation, deliver } from './support/conversation';
import { setNow } from './support/fixed-clock';
import { grantOrganizer } from './support/season';
import { teamsGame } from './support/teams-game';
import { buttonData, draftTeams, labelsOf, sentMessage } from './support/teams-screen';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();
const at = (time: string) => new Date(`2026-11-27T${time}:00Z`);
const privateTo = (chatId: number) => recorder.calls.filter(call => call.method === 'sendMessage' && call.payload.chat_id === chatId);

const vote = (pollId: string, userId: number, option: number) =>
    deliver({
        poll_answer: {
            poll_id: pollId,
            user: { id: userId, is_bot: false, first_name: `Voter ${userId}` },
            option_ids: option < 0 ? [] : [option],
            option_persistent_ids: []
        }
    });

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('teams before the game', it => {
    it.effect('proposes once an hour before the start, also when the trigger is late, and not for cancelled, made or small games', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { sessionId } = yield* teamsGame('teams-auto', { groupChatId: -3301, adminId: 331, players: 12 });
            yield* teamsGame('teams-auto-few', { groupChatId: -3302, adminId: 332, players: 6 });
            const made = yield* teamsGame('teams-auto-made', { groupChatId: -3303, adminId: 333, players: 12 });
            const gone = yield* teamsGame('teams-auto-gone', { groupChatId: -3304, adminId: 334, players: 12 });
            yield* db.insert(team).values({ sessionId: made.sessionId, ordinal: 1 });
            const target = yield* getSession(gone.sessionId);
            yield* Option.match(target, { onNone: () => Effect.void, onSome: game => cancelSession(game, 'weather', null) });
            const early = yield* runTeamsTick(at('09:00'));
            const before = privateTo(331).length;
            const first = yield* runTeamsTick(at('17:05'));
            const again = yield* runTeamsTick(at('17:15'));
            const proposal = privateTo(331).slice(before);
            const few = privateTo(332);
            yield* db
                .update(session)
                .set({ startsAt: at('19:00') })
                .where(eq(session.id, sessionId));
            yield* runTeamsTick(at('18:10'));
            const late = yield* teamsGame('teams-auto-late', { groupChatId: -3305, adminId: 335, players: 10 });
            yield* runTeamsTick(at('17:55'));
            const afterStart = yield* teamsGame('teams-auto-after', { groupChatId: -3306, adminId: 336, players: 10 });
            yield* runTeamsTick(at('18:05'));

            expect(early).toEqual({ games: 0, proposed: 0, noticed: 0 });
            expect(first.proposed).toBe(1);
            expect(again.proposed).toBe(0);
            expect(proposal).toHaveLength(1);
            expect(String(proposal[0]?.payload.text)).toMatch(
                /^<b>Склади: Пт 27\.11 19:00 · North Arena<\/b>\n\n🔴 <b>Червоні · 6<\/b>\n/u
            );
            expect(String(proposal[0]?.payload.text)).toContain('Поки нічого не надіслано.');
            expect(proposal[0]?.payload.disable_notification).toBe(true);
            expect(few.map(call => String(call.payload.text))).toEqual([
                '👕 На Пт 27.11 19:00 · North Arena поки записалося 6 — замало для команд. Запропоную, коли буде 8.'
            ]);
            expect(privateTo(333)).toEqual([]);
            expect(privateTo(334)).toEqual([]);
            expect(privateTo(331)).toHaveLength(before + 1);
            expect(privateTo(335)).toHaveLength(1);
            expect(privateTo(336)).toEqual([]);
            expect(late.sessionId).not.toBe(afterStart.sessionId);
        })
    );

    it.effect('tells about late changes once per five minutes, at once near the start, and accepts the fewest moves in one tap', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { sessionId } = yield* teamsGame('teams-readapt', { groupChatId: -3311, adminId: 341, players: 12 });
            yield* db
                .insert(telegramPoll)
                .values({ pollId: 'poll-readapt', chatId: -3311n, messageId: 5, sessionId, options: ['in', 'gk', 'out'] });
            yield* setNow(at('17:00').getTime());
            yield* runTeamsTick(at('17:00'));
            const start = yield* draftTeams(sessionId);
            const count = () => privateTo(341).length;
            const before = count();
            yield* setNow(at('17:10').getTime());
            yield* vote('poll-readapt', 34_150, 0);
            const firstNotice = privateTo(341).at(-1);
            yield* setNow(at('17:12').getTime());
            yield* vote('poll-readapt', 34_151, 0);
            const debounced = count();
            yield* runTeamsTick(at('17:20'));
            const flushed = privateTo(341).at(-1);
            yield* setNow(at('17:50').getTime());
            yield* vote('poll-readapt', 34_150, 2);
            const lastCall = privateTo(341).at(-1);
            const admin = conversation(recorder, adminNumbered(341));
            yield* admin.tap('👌 Прийняти');
            const accepted = yield* draftTeams(sessionId);
            const moved = start.row.state.teams
                .flat()
                .filter(
                    personId =>
                        accepted.row.state.teams.findIndex(members => members.includes(personId)) !==
                        start.row.state.teams.findIndex(members => members.includes(personId))
                );

            expect(before).toBe(1);
            expect(String(firstNotice?.payload.text)).toContain('🔄 Склад змінився: +1: Voter 34150');
            expect(firstNotice?.payload.disable_notification).toBe(true);
            expect(debounced).toBe(before + 1);
            expect(String(flushed?.payload.text)).toContain('+1: Voter 34151');
            expect(String(lastCall?.payload.text)).toContain('−1: Voter 34150');
            expect(accepted.row.state.teams.flat()).toContain(
                accepted.row.state.teams.flat().find(personId => !start.row.state.teams.flat().includes(personId))
            );
            expect(accepted.pending).toEqual([]);
            expect(moved.length).toBeLessThanOrEqual(2);
        })
    );

    it.effect('proposes another team count when many more came, and records the winner of the evening in one tap', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { sessionId } = yield* teamsGame('teams-result', { groupChatId: -3321, adminId: 351, players: 12 });
            const admin = conversation(recorder, adminNumbered(351));
            yield* admin.type('/games');
            yield* admin.tap('Пт 27.11 19:00');
            yield* admin.tap('👕 Склади');
            const two = labelsOf(admin.screen());
            const extra = yield* teamsGame('teams-result-more', { groupChatId: -3322, adminId: 352, players: 18 });
            const more = conversation(recorder, adminNumbered(352));
            yield* more.type('/games');
            yield* more.tap('Пт 27.11 19:00');
            yield* more.tap('👕 Склади');
            const three = yield* draftTeams(extra.sessionId);
            yield* admin.press(buttonData(admin.screen(), '✅ Надіслати в «Games»'));
            yield* setNow(at('21:30').getTime());
            yield* admin.type('/games');
            yield* admin.tap('Пт 27.11');
            const card = labelsOf(admin.screen());
            const cardText = admin.screen().text;
            yield* admin.press(buttonData(admin.screen(), '🏆 Червоні'));
            const saved = admin.screen().text;
            const savedLabels = labelsOf(admin.screen());
            yield* admin.press(buttonData(admin.screen(), '↩️ Змінити результат'));
            yield* admin.press(buttonData(admin.screen(), '🏆 Сині'));
            const corrected = admin.screen();
            const learned = yield* db.select().from(rating).where(eq(rating.model, 'openskill_pl'));
            const ranks = yield* db.select({ rank: team.rank }).from(team).where(eq(team.sessionId, sessionId)).orderBy(team.ordinal);

            expect(two.flat()).not.toContain('🔢 Зробити 3 команди');
            expect(three.teams).toHaveLength(3);
            expect(card).toEqual([['🏆 Червоні', '🏆 Сині'], ['🤝 Нічия'], ['✏️ Хто грав', '🏠 Меню']]);
            expect(cardText).toMatch(/^⚽ <b>[^<]+<\/b>\n\n🏆 Як зіграли\?$/u);
            expect(saved).toMatch(/^⚽ <b>[^<]+<\/b>\n\n🏆 Записав: Червоні виграли\.$/u);
            expect(savedLabels).toEqual([['↩️ Змінити результат'], ['✏️ Хто грав', '🏠 Меню']]);
            expect(corrected.text).toContain('🏆 Записав: Сині виграли.');
            expect(ranks.map(row => row.rank)).toEqual([2, 1]);
            expect(learned.length).toBeGreaterThanOrEqual(12);
            expect(saved).not.toMatch(/[μσ💪]|рівень/u);
        })
    );

    it.effect('speaks to each admin in the language of their last update, Ukrainian when it is unknown', () =>
        Effect.gen(function* () {
            const { communityId } = yield* teamsGame('teams-language', { groupChatId: -3331, adminId: 361, players: 10 });
            yield* grantOrganizer(communityId, 362);
            const russian = conversation(recorder, adminNumbered(361, 'ru'));
            yield* russian.press('m:h');
            yield* runTeamsTick(at('17:05'));

            expect(String(privateTo(361).at(-1)?.payload.text)).toContain('Пока ничего не отправлено.');
            expect(String(privateTo(362).at(-1)?.payload.text)).toContain('Поки нічого не надіслано.');
        })
    );

    it.effect('leaves a game being created on another message alone when the admin taps the team proposal', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            yield* teamsGame('teams-other-flow', { groupChatId: -3341, adminId: 371, players: 10 });
            yield* runTeamsTick(at('17:05'));
            const proposal = privateTo(371).at(-1);
            const admin = conversation(recorder, adminNumbered(371));
            yield* admin.type('/newgame');
            const creating = admin.screen();
            yield* admin.tapOn(sentMessage(proposal), '✏️ Змінити склади');
            const [state] = yield* db.select({ messageId: adminState.messageId }).from(adminState).where(eq(adminState.tgUserId, 371n));

            expect(state?.messageId).toBe(creating.id);
        })
    );
});
