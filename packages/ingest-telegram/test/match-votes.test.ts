import { describe, expect, it } from '@effect/vitest';

import { isCertain, rankVoteMatches } from '../src/identity/match-votes';

const gamesFrom = (first: number, count: number): Set<string> => new Set(Array.from({ length: count }, (_, index) => `g${first + index}`));

const certain = (
    gamesByAlias: Record<string, Set<string>>,
    votes: readonly (readonly [bigint, Set<string>])[],
    otherGames: ReadonlySet<string> = new Set()
) =>
    rankVoteMatches({
        personIdByAccount: new Map(votes.map(([id]) => [id, `p${id}`])),
        yesGamesByAccount: new Map(votes),
        gamesByAlias: new Map(Object.entries(gamesByAlias)),
        otherAliasGamesByPerson: () => otherGames
    })
        .filter(match => isCertain(match))
        .map(({ aliasId, tgUserId }) => [aliasId, tgUserId]);

describe('vote matching', () => {
    it('links a nickname only to the one clear account', () => {
        expect(certain({ gonzo: gamesFrom(0, 10) }, [[1n, gamesFrom(0, 11)]])).toEqual([['gonzo', 1n]]);
    });

    it('refuses too few games, too small a share or too small a margin', () => {
        expect(certain({ gonzo: gamesFrom(0, 9) }, [[1n, gamesFrom(0, 9)]])).toEqual([]);
        expect(certain({ gonzo: gamesFrom(0, 20) }, [[1n, gamesFrom(0, 17)]])).toEqual([]);
        expect(
            certain({ gonzo: gamesFrom(0, 10) }, [
                [1n, gamesFrom(0, 10)],
                [2n, gamesFrom(1, 9)]
            ])
        ).toEqual([]);
    });

    it('gives one account one nickname and leaves a close second nickname undecided', () => {
        expect(certain({ gonzo: gamesFrom(0, 20), gonza: gamesFrom(0, 12) }, [[1n, gamesFrom(0, 20)]])).toEqual([['gonzo', 1n]]);
        expect(certain({ gonzo: gamesFrom(0, 20), gonza: gamesFrom(1, 19) }, [[1n, gamesFrom(0, 20)]])).toEqual([]);
    });

    it('refuses a player who is in one of those line-ups under another name', () => {
        expect(certain({ gonzo: gamesFrom(0, 10) }, [[1n, gamesFrom(0, 10)]], new Set(['g3']))).toEqual([]);
    });
});
