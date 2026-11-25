import { describe, expect, it } from '@effect/vitest';

import {
    dayChoices,
    placeSizes,
    predictGames,
    rankTimes,
    rankVenues,
    sizeAt,
    sizeOfPlace,
    timeChoices
} from '../src/menu/game-suggestions';

import type { PastGame, PlannedGame } from '../src/menu/past-game.interface';

const played = (localDate: string, localTime: string, venueId: string | null, places: number | null): PastGame => ({
    localDate,
    localTime,
    venueId,
    capacityMax: places,
    fieldsPlanned: 1,
    status: 'played'
});

const history: readonly PastGame[] = [
    played('2026-11-20', '19:00', 'arena', 22),
    played('2026-11-20', '19:00', 'arena', 22),
    { ...played('2026-11-13', '19:00', 'arena', 24), fieldsPlanned: null },
    played('2026-11-06', '19:00', 'arena', 20),
    played('2026-10-30', '19:30', 'lake', 20),
    played('2026-11-23', '18:30', 'park', 17),
    played('2026-11-16', '18:30', 'park', null),
    played('2026-11-09', '19:00', 'park', 18),
    played('2026-11-02', '19:00', 'park', 18),
    played('2026-11-24', '20:00', null, null),
    played('2026-11-17', '20:00', null, null),
    played('2026-11-19', '20:00', null, null),
    played('2026-11-12', '20:00', null, null),
    { ...played('2026-11-21', '10:00', 'lake', 10), status: 'cancelled' },
    { ...played('2026-11-14', '10:00', 'lake', 10), status: 'cancelled' },
    played('2026-06-05', '18:00', 'old', 30),
    played('2026-06-12', '18:00', 'old', 30)
];
const venues = [
    { id: 'arena', name: 'Arena' },
    { id: 'lake', name: 'Lake' },
    { id: 'park', name: 'Park' },
    { id: 'zoo', name: 'Zoo' }
];
const fridayGame = { _tag: 'new', localDate: '2026-11-27', localTime: '19:00', venueId: 'arena', fields: 1, places: 22 } as const;
const mondayGame = { _tag: 'new', localDate: '2026-11-30', localTime: '18:30', venueId: 'park', fields: 1, places: 18 } as const;

describe('game predictions', () => {
    it('proposes tomorrow on a Thursday, then the next usual game', () => {
        expect(predictGames(history, [], '2026-11-26')).toEqual([fridayGame, mondayGame]);
    });

    it('proposes Monday first on a Sunday and on a Friday', () => {
        expect(predictGames(history, [], '2026-11-29')[0]).toEqual(mondayGame);
        expect(predictGames(history, [], '2026-11-27').map(game => game.localDate)).toEqual(['2026-11-30', '2026-12-04']);
        expect(predictGames(history, [], '2026-11-24')).toHaveLength(2);
    });

    it('never proposes today and skips days whose game already has a poll', () => {
        const planned: PlannedGame[] = [{ sessionId: 's1', localDate: '2026-11-27', hasPoll: true }];

        expect(predictGames(history, [], '2026-11-25').map(game => game.localDate)).toEqual(['2026-11-27', '2026-11-30']);
        expect(predictGames(history, planned, '2026-11-26').map(game => game.localDate)).toEqual(['2026-11-30', '2026-12-04']);
    });

    it('offers to post the poll of a planned game that has none', () => {
        const planned: PlannedGame[] = [{ sessionId: 's1', localDate: '2026-11-27', hasPoll: false }];

        expect(predictGames(history, planned, '2026-11-26')[0]).toEqual({ _tag: 'announce', sessionId: 's1', localDate: '2026-11-27' });
    });

    it('has nothing to propose with too little history', () => {
        expect(predictGames([played('2026-11-20', '19:00', 'arena', 22)], [], '2026-11-26')).toEqual([]);
    });

    it('lists days from tomorrow with the usual ones first and today last while its time is ahead', () => {
        expect(dayChoices(history, '2026-11-25', { today: false })).toEqual([
            '2026-11-27',
            '2026-11-30',
            '2026-11-26',
            '2026-11-28',
            '2026-11-29',
            '2026-12-01'
        ]);
        expect(dayChoices(history, '2026-11-25', { today: true }).at(-1)).toBe('2026-11-25');
    });

    it('sorts places by the weekday, then by recent use, and keeps unused ones last', () => {
        expect(rankVenues(history, venues, '2026-12-04').map(entry => entry.id)).toEqual(['arena', 'lake', 'park', 'zoo']);
        expect(rankVenues(history, venues, '2026-11-30').map(entry => entry.id)).toEqual(['park', 'arena', 'lake', 'zoo']);
    });

    it('sorts times by use at that place and weekday, then falls back to the community', () => {
        expect(rankTimes(history, 'park', '2026-11-30')).toEqual(['18:30', '19:00', '19:30', '18:00']);
        expect(rankTimes(history, 'zoo', '2026-12-02')).toEqual(['19:00', '18:30', '19:30', '18:00']);
        expect(rankTimes([], null, '2026-12-02')).toEqual(['18:00', '18:30', '19:00', '19:30', '20:00', '20:30']);
    });

    it('offers the two usual times of the place and half an hour around the current one', () => {
        expect(timeChoices(history, 'park', '2026-11-30', '18:30')).toEqual(['18:00', '18:30', '19:00']);
        expect(timeChoices(history, 'arena', '2026-12-04', '20:15')).toEqual(['19:00', '19:30', '19:45', '20:15', '20:45']);
    });

    it('takes the usual full size of the place from its last games, skipping empty values', () => {
        expect(sizeAt(history, 'park', '2026-11-30')).toEqual({ fields: 1, places: 18 });
        expect(sizeAt(history, 'arena', '2026-12-04')).toEqual({ fields: 1, places: 22 });
        expect(sizeAt(history, 'zoo', '2026-12-02')).toEqual({ fields: 1, places: 18 });
        expect(sizeAt([], null, '2026-12-02')).toEqual({ fields: null, places: null });
    });

    it('lists the most used sizes of the place', () => {
        expect(placeSizes(history, 'arena')).toEqual([22, 24, 20]);
        expect(placeSizes([], 'arena')).toEqual([]);
        expect(sizeOfPlace(history, 'park')).toEqual({ fields: 1, places: 18 });
        expect(sizeOfPlace(history, 'zoo')).toEqual({ fields: null, places: null });
    });
});
