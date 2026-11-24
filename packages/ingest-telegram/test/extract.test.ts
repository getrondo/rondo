import { describe, expect, it } from 'vitest';

import { assemblePlan } from '../src/extract/assemble-plan';
import { extractAll } from '../src/extract/extract-all';
import { extractLineup } from '../src/extract/extract-lineup';
import { makeVenueMatcher } from '../src/extract/extract-poll';
import { makeFixtureExtractor } from '../src/extract/extract-signals';
import { findLocalTime, resolveGameDate } from '../src/extract/game-date';
import { normalizeAlias } from '../src/extract/normalize';
import { zonedToInstant } from '../src/extract/zoned-time';

import { message, testConfig } from './fixture';

const venueOf = makeVenueMatcher(testConfig);

describe('game date resolution', () => {
    it('reads an explicit day and month', () => {
        expect(resolveGameDate('Понедельник, 21 октября, 19.00', '2024-10-20')).toEqual({ date: '2024-10-21', confidence: 0.95 });
    });

    it('rolls an explicit January date into the next year', () => {
        expect(resolveGameDate('Пятница, 3 января', '2024-12-30').date).toBe('2025-01-03');
    });

    it('resolves today and tomorrow', () => {
        expect(resolveGameDate('Сегодня играем', '2025-05-02').date).toBe('2025-05-02');
        expect(resolveGameDate('Завтра 19:00', '2025-05-02').date).toBe('2025-05-03');
    });

    it('resolves the next matching weekday', () => {
        expect(resolveGameDate('Пятница, 19.00', '2025-05-05').date).toBe('2025-05-09');
    });

    it('finds kick-off times but ignores dates', () => {
        expect(findLocalTime('Пятница, 19.00, поле')).toBe('19:00');
        expect(findLocalTime('18:30-20:00')).toBe('18:30');
        expect(findLocalTime('13.10.2025')).toBeUndefined();
    });
});

describe('time zones', () => {
    it('converts Vienna summer and winter wall-clock time to instants', () => {
        expect(zonedToInstant({ year: 2025, month: 7, day: 1, hour: 19, minute: 0 }, 'Europe/Vienna').toISOString()).toBe(
            '2025-07-01T17:00:00.000Z'
        );
        expect(zonedToInstant({ year: 2025, month: 1, day: 10, hour: 19, minute: 0 }, 'Europe/Vienna').toISOString()).toBe(
            '2025-01-10T18:00:00.000Z'
        );
    });
});

describe('aliases', () => {
    it('normalizes case, ё and punctuation', () => {
        expect(normalizeAlias('  Пётр  Вратарь! ')).toBe('петр вратарь');
    });
});

describe('line-ups', () => {
    it('extracts teams, goalkeepers, newcomers and the organizer self-alias', () => {
        const lineup = extractLineup(
            message(
                10,
                '2025-05-05T15:00:00Z',
                'Составы на сегодня, 19.00 North:\n🟢Я, Иван, Пётр вратарь\n🔵Олег, Павел новый, Семён\nПо 10 евро на поле'
            ),
            testConfig,
            venueOf
        );

        expect(lineup?.venueKey).toBe('north');
        expect(lineup?.localTime).toBe('19:00');
        expect(lineup?.priceCents).toBe(1000);
        expect(lineup?.teams.map(team => team.members.map(member => member.aliasNorm))).toEqual([
            ['я', 'иван', 'петр'],
            ['олег', 'павел', 'семен']
        ]);
        expect(lineup?.teams[0]?.members[0]?.isSelf).toBe(true);
        expect(lineup?.teams[0]?.members[2]?.isGk).toBe(true);
        expect(lineup?.teams[1]?.members[1]?.isNewcomer).toBe(true);
    });

    it('ignores messages with fewer than two teams', () => {
        expect(extractLineup(message(11, '2025-05-05T15:00:00Z', 'Составы позже'), testConfig, venueOf)).toBeUndefined();
    });
});

describe('league fixtures', () => {
    const fixtures = makeFixtureExtractor(testConfig, new Set(['Org']));

    it('reads away results with the score on a later line and squad from context', () => {
        expect(fixtures(message(20, '2025-09-11T10:00:00Z', '5я лига. Rivals FC- TFC2 . / 7 сентября. / Счет: 0-17'))).toMatchObject([
            {
                squadName: 'TFC-2',
                competition: '5. Liga',
                season: '2025/26',
                opponent: 'Rivals FC',
                goalsFor: 17,
                goalsAgainst: 0,
                home: false,
                localDate: '2025-09-07'
            }
        ]);
    });

    it('reads several inline results from one message', () => {
        expect(
            fixtures(message(21, '2026-04-29T10:00:00Z', 'Игровой день 19 Апреля.\nTFC- Alpha 6:4\nTFC- Beta 17:9')).map(fact => [
                fact.opponent,
                fact.goalsFor,
                fact.goalsAgainst
            ])
        ).toEqual([
            ['Alpha', 6, 4],
            ['Beta', 17, 9]
        ]);
    });

    it('ignores messages from non-organizers', () => {
        expect(fixtures(message(22, '2025-09-11T10:00:00Z', 'TFC- Alpha 3:1', { author: 'Someone' }))).toEqual([]);
    });
});

describe('plan assembly', () => {
    const messages = [
        message(1, '2025-05-04T18:00:00Z', '', {
            text: undefined,
            poll: { question: 'Понедельник, 5 мая, 19.00 North. 18 чел', answers: ['+', '-'] }
        }),
        message(2, '2025-05-05T15:00:00Z', 'Составы на сегодня:\n🟢Иван, Пётр\n🔵Олег, Семён\nПо 8 евро на поле'),
        message(3, '2025-05-08T18:00:00Z', '', {
            text: undefined,
            poll: { question: 'Пятница, 9 мая, 19.30 Park. 18 чел', answers: ['+', '-'] }
        }),
        message(4, '2025-05-09T10:00:00Z', 'Сегодня отмена, дождь'),
        message(5, '2025-06-02T15:00:00Z', 'Составы на сегодня:\n🟢Иван, Олег\n🔵Пётр, Семён\nПо 10 евро на поле')
    ];
    const plan = assemblePlan(extractAll(messages, testConfig), '2025-06-30');

    it('merges polls and line-ups into sessions with status', () => {
        expect(plan.sessions.map(session => [session.localDate, session.status, session.venueKey, session.localTime])).toEqual([
            ['2025-05-05', 'played', 'north', '19:00'],
            ['2025-05-09', 'cancelled', 'park', '19:30'],
            ['2025-06-02', 'played', undefined, '19:00']
        ]);
        expect(plan.sessions[1]?.cancelReason).toBe('weather');
    });

    it('aggregates aliases across line-ups', () => {
        expect(plan.aliases.find(alias => alias.aliasNorm === 'иван')?.occurrences).toBe(2);
    });

    it('compresses prices into validity ranges', () => {
        expect(plan.prices.map(price => [price.amountCents, price.from, price.to])).toEqual([
            [800, '2025-05-01', '2025-06-01'],
            [1000, '2025-06-01', undefined]
        ]);
    });
});
