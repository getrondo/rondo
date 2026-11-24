import { describe, expect, it } from '@effect/vitest';
import * as Option from 'effect/Option';

import { isCertainSet, matchSegments, matchSet, type AliasGame, type Squad } from '../src/identity/match-votes';

const accountsOf = (found: ReturnType<typeof matchSet>): readonly string[] =>
    found.pipe(
        Option.map(({ personIds }) => personIds),
        Option.getOrElse((): readonly string[] => [])
    );

const dayOf = (day: number): string => new Date(Date.UTC(2025, 0, 1) + day * 24 * 60 * 60_000).toISOString().slice(0, 10);

const squadsOf = (days: readonly number[], yesOn: (day: number) => readonly string[]): Squad[] =>
    days.map(day => ({ sessionId: `g${day}`, date: dayOf(day), yes: new Set(yesOn(day)) }));

const range = (from: number, count: number): number[] => Array.from({ length: count }, (_, index) => from + index);

const certain = (
    squads: readonly Squad[],
    daysByAlias: Readonly<Record<string, readonly number[]>>,
    otherGames: ReadonlySet<string> = new Set()
) => {
    const timelines = new Map(
        Object.entries(daysByAlias).map(([aliasId, days]) => [
            aliasId,
            squads
                .filter(({ sessionId }) => days.includes(Number(sessionId.slice(1))))
                .map((squad): AliasGame => Object.assign(squad, { players: 1 }))
        ])
    );
    const evidence = {
        squads,
        timelines,
        gamesUnderOtherName: () => otherGames
    };

    return (aliasId: string) =>
        matchSegments(evidence, aliasId).matches.map(({ personId, sessionIds }) => [personId, sessionIds.length] as const);
};

describe('matching one nickname to one account', () => {
    it('links the one clear account', () => {
        expect(
            certain(
                squadsOf(range(0, 11), () => ['p1']),
                { gonzo: range(0, 10) }
            )('gonzo')
        ).toEqual([['p1', 10]]);
    });

    it('refuses too few games, too small a share or too small a margin', () => {
        expect(
            certain(
                squadsOf(range(0, 9), () => ['p1']),
                { gonzo: range(0, 9) }
            )('gonzo')
        ).toEqual([]);
        expect(
            certain(
                squadsOf(range(0, 20), day => (day < 17 ? ['p1'] : [])),
                { gonzo: range(0, 20) }
            )('gonzo')
        ).toEqual([]);
        expect(
            certain(
                squadsOf(range(0, 10), day => (day === 0 ? ['p1'] : ['p1', 'p2'])),
                { gonzo: range(0, 10) }
            )('gonzo')
        ).toEqual([]);
    });

    it('leaves two close nicknames of one account undecided', () => {
        expect(
            certain(
                squadsOf(range(0, 20), () => ['p1']),
                { gonzo: range(0, 20), gonza: range(1, 19) }
            )('gonzo')
        ).toEqual([]);
    });

    it('refuses a player who is in one of those line-ups under another name', () => {
        expect(
            certain(
                squadsOf(range(0, 10), () => ['p1']),
                { gonzo: range(0, 10) },
                new Set(['g3'])
            )('gonzo')
        ).toEqual([]);
    });

    it('judges each period after a gap of more than 180 days alone', () => {
        const days = [...range(0, 10), ...range(200, 12)];
        const link = certain(
            squadsOf(days, day => (day < 100 ? ['p1'] : ['p2'])),
            { gonzo: days }
        );

        expect(link('gonzo')).toEqual([
            ['p1', 10],
            ['p2', 12]
        ]);
    });

    it('splits a period in which the account changes', () => {
        const link = certain(
            squadsOf(range(0, 24), day => (day < 11 ? ['p1'] : ['p2'])),
            { gonzo: range(0, 24) }
        );

        expect(link('gonzo')).toEqual([
            ['p1', 11],
            ['p2', 13]
        ]);
    });
});

describe('a player change inside one period', () => {
    it('splits a long run of one account from a short later or earlier run of another', () => {
        const later = certain(
            squadsOf(range(0, 100), day => (day < 90 ? ['p1'] : ['p2'])),
            { gonzo: range(0, 100) }
        );
        const earlier = certain(
            squadsOf(range(0, 100), day => (day < 10 ? ['p2'] : ['p1'])),
            { gonzo: range(0, 100) }
        );

        expect(later('gonzo')).toEqual([
            ['p1', 90],
            ['p2', 10]
        ]);
        expect(earlier('gonzo')).toEqual([
            ['p2', 10],
            ['p1', 90]
        ]);
    });

    it('splits a change at both ends', () => {
        const yesOn = (day: number): string => (day < 10 ? 'p2' : 'p1');
        const link = certain(
            squadsOf(range(0, 220), day => [day < 210 ? yesOn(day) : 'p3']),
            { gonzo: range(0, 220) }
        );

        expect(link('gonzo')).toEqual([
            ['p2', 10],
            ['p1', 200],
            ['p3', 10]
        ]);
    });
});

describe('matching a shared nickname to several accounts', () => {
    const playersOn = (day: number): number => (day % 3 === 0 ? 2 : 1);
    const gamesOf = (yesOn: (day: number) => readonly string[]): AliasGame[] =>
        squadsOf(range(0, 20), yesOn).map((squad, day) => Object.assign(squad, { players: playersOn(day) }));
    const pair = (day: number): string[] => (playersOn(day) === 2 ? ['p1', 'p2'] : [day % 2 === 0 ? 'p1' : 'p2']);

    it('finds the pair that explains the squads', () => {
        const games = gamesOf(day => [...pair(day), ...(day % 5 === 0 ? ['p3'] : [])]);
        const found = matchSet(games, games, () => true);

        expect(accountsOf(found)).toEqual(['p1', 'p2']);
        expect(Option.exists(found, set => isCertainSet(set))).toBe(true);
    });

    it('is not certain when another account fits as well', () => {
        const games = gamesOf(day => [...pair(day), ...(pair(day).includes('p2') ? ['p3'] : [])]);
        const found = matchSet(games, games, () => true);

        expect(Option.exists(found, set => isCertainSet(set))).toBe(false);
    });

    it('treats a single squad with more players as a slip', () => {
        const games = gamesOf(pair).map((game, day) => (day === 0 ? Object.assign(game, { players: 3 }) : game));

        expect(accountsOf(matchSet(games, games, () => true))).toHaveLength(2);
    });

    it('takes the largest count that occurs in two squads', () => {
        const games = gamesOf(pair).map((game, day) =>
            Object.assign(game, {
                players:
                    new Map([
                        [0, 4],
                        [3, 3]
                    ]).get(day) ?? game.players
            })
        );

        expect(accountsOf(matchSet(games, games, () => true))).toHaveLength(2);
    });

    it('never explains a shared nickname with one person', () => {
        const games = squadsOf(range(0, 20), () => ['p1']).map((squad, day) =>
            Object.assign(squad, {
                players:
                    new Map([
                        [0, 3],
                        [1, 2]
                    ]).get(day) ?? 1
            })
        );

        expect(Option.isNone(matchSet(games, games, () => true))).toBe(true);
    });

    it('bounds the search for large sets', () => {
        const everyone = range(1, 60).map(index => `p${index}`);
        const games = squadsOf(range(0, 20), () => everyone).map(squad => Object.assign(squad, { players: 8 }));
        const startedAt = performance.now();

        expect(accountsOf(matchSet(games, games, () => true))).toHaveLength(8);
        expect(performance.now() - startedAt).toBeLessThan(5000);
    });

    it('leaves out accounts that are in those squads under another name', () => {
        const games = gamesOf(pair);

        expect(accountsOf(matchSet(games, games, account => account !== 'p2'))).not.toContain('p2');
    });
});
