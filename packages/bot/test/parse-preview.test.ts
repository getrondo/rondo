import { describe, expect, it } from '@effect/vitest';

import { parsePreview } from '../src/utils/parse-preview.util';

describe('typed preview values', () => {
    it('reads the hint as written, with commas and the word for places', () => {
        expect(parsePreview('пн 19:30, 18 місць')).toEqual({ weekday: 1, time: '19:30', places: 18 });
        expect(parsePreview('Пт 20:00, 16 мест')).toEqual({ weekday: 5, time: '20:00', places: 16 });
        expect(parsePreview('22 місця')).toEqual({ places: 22 });
        expect(parsePreview('місць 18')).toBeNull();
        expect(parsePreview('приду в 19:30')).toBeNull();
    });
});
