import { describe, expect, it } from 'vitest';

import { badgeOfEmoji, badgeOfRow, defaultColours } from '../src/teams/badges';
import { rateResult, unknownRating } from '../src/teams/rate-result';

const team = (size: number) => Array.from({ length: size }, () => unknownRating);

describe('team results and badges', () => {
    it('raises the winners, lowers the others, keeps a draw of equals and shrinks the uncertainty', () => {
        const [winners = [], second = [], third = []] = rateResult([team(5), team(5), team(5)], [1, 2, 2]);
        const [drawn = []] = rateResult([team(5), team(5)], [1, 1]);

        expect(winners[0]?.mu).toBeGreaterThan(25);
        expect(second[0]?.mu).toBeLessThan(25);
        expect(second[0]?.mu).toBeCloseTo(third[0]?.mu ?? 0);
        expect(drawn[0]?.mu).toBeCloseTo(25);
        expect(winners[0]?.sigma).toBeLessThan(unknownRating.sigma);
        expect(drawn[0]?.sigma).toBeLessThan(unknownRating.sigma);
    });

    it('reads the money bibs as the plain colours and picks the colours of the place first', () => {
        expect(badgeOfEmoji('💷')?.badge).toBe('🔴');
        expect(badgeOfEmoji('💸')?.colour).toBe('white');
        expect(badgeOfRow({ emoji: '💷', name: 'orange' })?.colour).toBe('red');
        expect(badgeOfRow({ emoji: null, name: 'b-blue' })?.colour).toBe('blue');
        expect(defaultColours(3, ['green', 'white'])).toEqual(['green', 'white', 'red']);
    });

    it('matches the numbers of openSkill BradleyTerryFull with its default gamma, sqrt(sigma²) / c', () => {
        const fresh = { mu: 25, sigma: 25 / 3 };
        const rated = [
            ...rateResult(
                [
                    [fresh, fresh],
                    [fresh, fresh]
                ],
                [1, 2]
            ),
            ...rateResult(
                [
                    [{ mu: 30, sigma: 5 }, fresh],
                    [
                        { mu: 20, sigma: 4 },
                        { mu: 25, sigma: 6 }
                    ],
                    [fresh]
                ],
                [2, 1, 2]
            )
        ].flatMap(squad => squad.flatMap(player => [player.mu, player.sigma]));
        const reference = [
            26.9642, 8.1776, 26.9642, 8.1776, 23.0358, 8.1776, 23.0358, 8.1776, 28.043, 4.9244, 19.564, 7.9784, 21.0205, 3.9626, 27.2962,
            5.8731, 26.0067, 8.0748
        ];

        expect(rated).toHaveLength(reference.length);

        for (const [index, value] of reference.entries()) {
            expect(rated[index]).toBeCloseTo(value, 3);
        }
    });
});
