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
});
