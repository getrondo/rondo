import { describe, expect, it } from '@effect/vitest';
import * as Option from 'effect/Option';

import { isCertainSet, matchSegments, matchSet, type AliasGame, type Squad } from '../src/identity/match-votes';

const accountsOf = (found: ReturnType<typeof matchSet>): readonly bigint[] =>
    found.pipe(
        Option.map(({ accounts }) => accounts),
        Option.getOrElse((): readonly bigint[] => [])
    );

const dayOf = (day: number): string => new Date(Date.UTC(2025, 0, 1) + day * 24 * 60 * 60_000).toISOString().slice(0, 10);

const squadsOf = (days: readonly number[], yesOn: (day: number) => readonly bigint[]): Squad[] =>
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
        personIdByAccount: new Map([1n, 2n, 3n].map(id => [id, `p${id}`])),
        gamesUnderOtherName: () => otherGames
    };

    return (aliasId: string) =>
        matchSegments(evidence, aliasId).matches.map(({ personId, sessionIds }) => [personId, sessionIds.length] as const);
};

describe('matching one nickname to one account', () => {
    it('links the one clear account', () => {
        expect(
            certain(
                squadsOf(range(0, 11), () => [1n]),
                { gonzo: range(0, 10) }
            )('gonzo')
        ).toEqual([['p1', 10]]);
    });

    it('refuses too few games, too small a share or too small a margin', () => {
        expect(
            certain(
                squadsOf(range(0, 9), () => [1n]),
                { gonzo: range(0, 9) }
            )('gonzo')
        ).toEqual([]);
        expect(
            certain(
                squadsOf(range(0, 20), day => (day < 17 ? [1n] : [])),
                { gonzo: range(0, 20) }
            )('gonzo')
        ).toEqual([]);
        expect(
            certain(
                squadsOf(range(0, 10), day => (day === 0 ? [1n] : [1n, 2n])),
                { gonzo: range(0, 10) }
            )('gonzo')
        ).toEqual([]);
    });

    it('leaves two close nicknames of one account undecided', () => {
        expect(
            certain(
                squadsOf(range(0, 20), () => [1n]),
                { gonzo: range(0, 20), gonza: range(1, 19) }
            )('gonzo')
        ).toEqual([]);
    });

    it('refuses a player who is in one of those line-ups under another name', () => {
        expect(
            certain(
                squadsOf(range(0, 10), () => [1n]),
                { gonzo: range(0, 10) },
                new Set(['g3'])
            )('gonzo')
        ).toEqual([]);
    });

    it('judges each period after a gap of more than 180 days alone', () => {
        const days = [...range(0, 10), ...range(200, 12)];
        const link = certain(
            squadsOf(days, day => (day < 100 ? [1n] : [2n])),
            { gonzo: days }
        );

        expect(link('gonzo')).toEqual([
            ['p1', 10],
            ['p2', 12]
        ]);
    });

    it('splits a period in which the account changes', () => {
        const link = certain(
            squadsOf(range(0, 24), day => (day < 11 ? [1n] : [2n])),
            { gonzo: range(0, 24) }
        );

        expect(link('gonzo')).toEqual([
            ['p1', 11],
            ['p2', 13]
        ]);
    });
});

describe('matching a shared nickname to several accounts', () => {
    const playersOn = (day: number): number => (day % 3 === 0 ? 2 : 1);
    const gamesOf = (yesOn: (day: number) => readonly bigint[]): AliasGame[] =>
        squadsOf(range(0, 20), yesOn).map((squad, day) => Object.assign(squad, { players: playersOn(day) }));
    const pair = (day: number): bigint[] => (playersOn(day) === 2 ? [1n, 2n] : [day % 2 === 0 ? 1n : 2n]);

    it('finds the pair that explains the squads', () => {
        const games = gamesOf(day => [...pair(day), ...(day % 5 === 0 ? [3n] : [])]);
        const found = matchSet(games, games, () => true);

        expect(accountsOf(found)).toEqual([1n, 2n]);
        expect(Option.exists(found, set => isCertainSet(set))).toBe(true);
    });

    it('is not certain when another account fits as well', () => {
        const games = gamesOf(day => [...pair(day), ...(pair(day).includes(2n) ? [3n] : [])]);
        const found = matchSet(games, games, () => true);

        expect(Option.exists(found, set => isCertainSet(set))).toBe(false);
    });

    it('treats a single squad with more players as a slip', () => {
        const games = gamesOf(pair).map((game, day) => (day === 0 ? Object.assign(game, { players: 3 }) : game));

        expect(accountsOf(matchSet(games, games, () => true))).toHaveLength(2);
    });

    it('leaves out accounts that are in those squads under another name', () => {
        const games = gamesOf(pair);

        expect(accountsOf(matchSet(games, games, account => account !== 2n))).not.toContain(2n);
    });
});
