import { expect, layer } from '@effect/vitest';
import { isDefined } from '@rnw-community/shared';
import { importedPoll, pollVote, telegramPoll } from '@rondo/db/schema/platform.schema';
import { lineupEntry } from '@rondo/db/schema/play.schema';
import { session, signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { countLabel } from '../src/i18n/count-label';
import { syncMember, upsertTelegramUser } from '../src/identity/telegram-user';
import { ingestGroupMessage } from '../src/live/live-ingest';
import { createSession } from '../src/sessions/session.service';
import { coverageText } from '../src/stats/coverage-text';
import { personGames, personPolls, personStatistics, topPlayers } from '../src/stats/participation.service';
import { attendanceCoverage, playerHistory } from '../src/stats/stats.service';
import { recordedTelegramDbLayer } from '../src/testing/recorded-telegram.layer';
import { seedCommunity, seedConfig } from '../src/testing/seed-community';

const range = { from: '2026-01-01', to: '2026-12-31' };
const player = 500n;

const seeded = Effect.fn('test.seeded')(function* (slug: string, base: bigint) {
    const db = yield* Db;
    const { communityId } = yield* seedCommunity(seedConfig(slug));
    const organizer = yield* upsertTelegramUser({ id: base, firstName: 'Org' });
    const personId = yield* syncMember(communityId, { id: player + base, firstName: 'Player', username: `player${base}` }, 'active');
    let messageId = 0;
    const addGame = Effect.fn('test.addGame')(function* (localDate: string) {
        const sessionId = yield* createSession({
            communityId,
            timezone: 'Europe/Vienna',
            localDate,
            localTime: '19:00',
            venueId: null,
            capacityMax: null,
            title: null,
            actorPersonId: null
        });
        yield* db.update(session).set({ status: 'played' }).where(eq(session.id, sessionId));

        return sessionId;
    });
    const postSquad = Effect.fn('test.postSquad')(function* (localDate: string, names: string) {
        messageId += 1;
        yield* ingestGroupMessage(communityId, seedConfig(slug), {
            chatId: -base,
            messageId,
            sentAt: new Date(`${localDate}T15:00:00Z`),
            senderPersonId: organizer,
            senderTgUserId: base,
            senderName: 'Org',
            isTrusted: true,
            text: `Составы на сегодня, 19.00:\n🟢Я, ${names}\n🔵Олег, Семён`
        });
    });
    const addPoll = Effect.fn('test.addPoll')(function* (input: {
        readonly sessionId: string | null;
        readonly choice: 'yes' | 'no' | 'other';
        readonly kind?: 'participation' | 'reserve' | 'other';
        readonly answers?: number;
        readonly postedAt?: string;
    }) {
        messageId += 1;
        const pollId = `${slug}-${messageId}`;
        const kind = input.kind ?? 'participation';
        const postedAt = new Date(input.postedAt ?? '2026-05-01T10:00:00Z');
        yield* db
            .insert(importedPoll)
            .values({ pollId, communityId, sessionId: input.sessionId, messageId, postedAt, kind, answers: input.answers ?? 2 });
        yield* db.insert(pollVote).values({
            pollId,
            tgUserId: player + base,
            sessionId: kind === 'participation' ? input.sessionId : null,
            choice: input.choice,
            votedAt: postedAt
        });
    });

    return { communityId, personId, addGame, addPoll, postSquad, username: `@player${base}` };
});

layer(recordedTelegramDbLayer, { timeout: 60_000 })('participation and squads as separate data points', it => {
    it.effect('counts a yes vote without a squad, with two polls for one game', () =>
        Effect.gen(function* () {
            const { communityId, personId, addGame, addPoll } = yield* seeded('polls-fc', 1000n);
            const sessionId = yield* addGame('2026-05-04');
            yield* addPoll({ sessionId, choice: 'yes' });
            yield* addPoll({ sessionId, choice: 'yes', answers: 4 });
            const { total } = yield* personStatistics(communityId, personId);

            expect(total.polls).toEqual({
                unit: 'polls',
                answered: 2,
                participationYes: 2,
                participationYesTwoAnswers: 1,
                participationYesMoreAnswers: 1,
                participationNo: 0,
                participationUnreadable: 0,
                reserveYes: 0
            });
            expect(total.games).toMatchObject({ unit: 'games', withYesVote: 1, namedInSquad: 0, yesWithoutPostedSquad: 1 });
        })
    );

    it.effect('keeps a squad entry without a vote, a no vote in a squad and a yes vote outside the squad apart', () =>
        Effect.gen(function* () {
            const { communityId, personId, addGame, addPoll, postSquad, username } = yield* seeded('squads-fc', 2000n);
            yield* addGame('2026-05-04');
            yield* postSquad('2026-05-04', username);
            const withNo = yield* addGame('2026-05-11');
            yield* addPoll({ sessionId: withNo, choice: 'no' });
            yield* postSquad('2026-05-11', username);
            const outside = yield* addGame('2026-05-18');
            yield* addPoll({ sessionId: outside, choice: 'yes' });
            yield* postSquad('2026-05-18', 'Гонзо');
            const polls = yield* personPolls(communityId, personId);
            const games = yield* personGames(communityId, personId, polls);
            const { total } = yield* personStatistics(communityId, personId);

            expect(games.map(({ localDate, vote, squad }) => [localDate, vote, squad])).toEqual([
                ['2026-05-04', 'none', 'named'],
                ['2026-05-11', 'no', 'named'],
                ['2026-05-18', 'yes', 'not_named']
            ]);
            expect(games[0]).toMatchObject({ polls: [], attendance: 'attended', attendanceSource: 'bot' });
            expect(games[0]?.squadMessageId).not.toBeNull();
            expect(games[2]?.polls).toMatchObject([{ choice: 'yes', answers: 2, source: 'imported' }]);
            expect(total.games).toMatchObject({
                withYesVote: 1,
                namedInSquad: 2,
                yesAndInSquad: 0,
                yesButNotInSquad: 1,
                inSquadWithoutVote: 1,
                inSquadDespiteNo: 1
            });
        })
    );

    it.effect('tells an unreadable answer from no vote and keeps reserve polls apart', () =>
        Effect.gen(function* () {
            const { communityId, personId, addGame, addPoll } = yield* seeded('unreadable-fc', 3000n);
            const sessionId = yield* addGame('2026-05-04');
            yield* addPoll({ sessionId, choice: 'other', answers: 5 });
            yield* addPoll({ sessionId, choice: 'yes', kind: 'reserve' });
            yield* addPoll({ sessionId: null, choice: 'yes', kind: 'other', postedAt: '2025-03-01T10:00:00Z' });
            const games = yield* personGames(communityId, personId, yield* personPolls(communityId, personId));
            const { total, years } = yield* personStatistics(communityId, personId);

            expect(games.map(({ vote, reserve }) => [vote, reserve.length])).toEqual([['unreadable', 1]]);
            expect(total.polls).toMatchObject({ answered: 3, participationYes: 0, participationUnreadable: 1, reserveYes: 1 });
            expect(total.games).toMatchObject({ withYesVote: 0 });
            expect(years.map(({ year, polls }) => [year, polls.answered])).toEqual([
                ['2025', 1],
                ['2026', 2]
            ]);
        })
    );

    it.effect('ranks by the chosen data point, participation by default', () =>
        Effect.gen(function* () {
            const { communityId, personId, addGame, addPoll, postSquad } = yield* seeded('ranking-fc', 4000n);
            const sessionId = yield* addGame('2026-05-04');
            yield* addPoll({ sessionId, choice: 'yes' });
            yield* addPoll({ sessionId, choice: 'yes' });
            yield* postSquad('2026-05-04', 'Гонзо');
            const byPolls = yield* topPlayers(communityId, range, { limit: 5 });
            const bySquads = yield* topPlayers(communityId, range, { by: 'squads', limit: 5 });
            const history = yield* playerHistory(communityId, personId);
            const coverage = yield* attendanceCoverage(communityId, range);

            expect(byPolls.map(({ personId: id, games }) => [id, games])).toEqual([[personId, 1]]);
            expect(bySquads.map(({ name }) => name)).toContain('Гонзо');
            expect(bySquads.map(({ personId: id }) => id)).not.toContain(personId);
            expect(history).toMatchObject({ name: 'Player', total: { games: { withYesVote: 1, namedInSquad: 0 } } });
            expect(coverage).toEqual({ playedGames: 1, gamesWithSquad: 1, gamesWithPoll: 1 });
            expect(coverageText('uk', coverage)).toBe('Усього 1 гра: з опитуванням — 1, з опублікованим складом — 1.');
        })
    );

    it.effect('uses the right plural forms', () =>
        Effect.sync(() => {
            const games = (locale: 'uk' | 'ru') => [1, 2, 5, 11, 21, 22, 112].map(count => countLabel(locale, 'games', count));

            expect(games('uk')).toEqual(['1 гра', '2 гри', '5 ігор', '11 ігор', '21 гра', '22 гри', '112 ігор']);
            expect(games('ru')).toEqual(['1 игра', '2 игры', '5 игр', '11 игр', '21 игра', '22 игры', '112 игр']);
            expect(countLabel('ru', 'polls', 3)).toBe('3 опроса');
        })
    );

    it.effect('counts every combination of vote and squad in its own field and year', () =>
        Effect.gen(function* () {
            const { communityId, personId, addGame, addPoll, postSquad, username } = yield* seeded('combinations-fc', 5000n);
            const combine = Effect.fn('test.combine')(function* (date: string, choice: 'yes' | 'no' | null, squad: string | null) {
                const sessionId = yield* addGame(date);

                if (isDefined(choice)) {
                    yield* addPoll({ sessionId, choice, postedAt: `${date}T08:00:00Z` });
                }

                if (isDefined(squad)) {
                    yield* postSquad(date, squad);
                }
            });
            yield* combine('2025-05-05', 'yes', null);
            yield* combine('2026-05-04', 'yes', username);
            yield* combine('2026-05-11', 'yes', null);
            yield* combine('2026-05-18', 'yes', null);
            yield* combine('2026-05-25', 'yes', 'Гонзо');
            yield* combine('2026-06-01', 'no', username);
            yield* combine('2026-06-08', 'no', username);
            yield* combine('2026-06-15', null, username);
            yield* combine('2026-06-22', 'no', null);
            const { total, years } = yield* personStatistics(communityId, personId);

            expect(total.games).toEqual({
                unit: 'games',
                withYesVote: 5,
                namedInSquad: 4,
                yesAndInSquad: 1,
                yesWithoutPostedSquad: 3,
                yesButNotInSquad: 1,
                inSquadWithoutVote: 1,
                inSquadDespiteNo: 2,
                attendanceRecorded: 4
            });
            expect(total.polls).toMatchObject({ answered: 8, participationYes: 5, participationNo: 3 });
            expect(years.map(({ year, polls, games }) => [year, polls.answered, games.withYesVote, games.namedInSquad])).toEqual([
                ['2025', 1, 1, 0],
                ['2026', 7, 4, 4]
            ]);
        })
    );

    it.effect('counts sign-ups in a poll of the bot', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, personId, addGame } = yield* seeded('bot-poll-fc', 6000n);
            const coming = yield* addGame('2026-05-04');
            const absent = yield* addGame('2026-05-11');
            const older = yield* addGame('2026-05-18');
            yield* db.insert(telegramPoll).values(
                [coming, absent, older].map((sessionId, index) => ({
                    pollId: `bot-${index}`,
                    chatId: -6000n,
                    messageId: index + 1,
                    sessionId,
                    options: sessionId === older ? ['in', 'gk', 'out'] : ['in', 'out']
                }))
            );
            yield* db.insert(signup).values([
                { sessionId: coming, personId, status: 'in' },
                { sessionId: absent, personId, status: 'out' },
                { sessionId: older, personId, status: 'in' }
            ]);
            const { total } = yield* personStatistics(communityId, personId);
            const ranking = yield* topPlayers(communityId, range, { limit: 5 });

            expect(total.polls).toMatchObject({
                answered: 3,
                participationYes: 2,
                participationYesTwoAnswers: 1,
                participationYesMoreAnswers: 1,
                participationNo: 1
            });
            expect(total.games.withYesVote).toBe(2);
            expect(ranking.map(({ games }) => games)).toEqual([2]);
        })
    );

    it.effect('counts a squad with only unidentified players as a posted squad', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, addGame } = yield* seeded('unidentified-fc', 7000n);
            const sessionId = yield* addGame('2026-05-04');
            yield* db
                .insert(lineupEntry)
                .values({ sessionId, messageId: 1, teamOrdinal: 1, position: 1, raw: 'Кто-то', resolvedBy: 'guest' });

            expect(yield* attendanceCoverage(communityId, range)).toMatchObject({ playedGames: 1, gamesWithSquad: 1 });
        })
    );
});
