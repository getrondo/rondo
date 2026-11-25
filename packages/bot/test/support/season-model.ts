import { addDays } from '@rondo/core/utils/add-days.util';
import { weekdayOf } from '@rondo/core/utils/weekday-of.util';

import type { PastGame } from '@rondo/core/menu/past-game.interface';

export interface SeasonGame extends PastGame {
    readonly kind: 'usual' | 'one-off' | 'new-place';
}

const firstFriday = '2026-01-02';
const weeks = 47;

const fridayPlaces = (week: number): number => [22, 22, 22, 24, 22, 20, 22, 22, 21, 22][week % 10] ?? 22;

export const syntheticSeason = (): SeasonGame[] => {
    const games: SeasonGame[] = [];

    for (let week = 0; week < weeks; week += 1) {
        const friday = addDays(firstFriday, week * 7);
        const monday = addDays(friday, 3);
        const isNewPlace = week === 23;

        if (week % 9 !== 8) {
            games.push({
                localDate: friday,
                localTime: '19:00',
                venueId: isNewPlace ? '019ab2c3-0000-7000-8000-000000000004' : '019ab2c3-0000-7000-8000-000000000001',
                fieldsPlanned: 1,
                capacityMax: isNewPlace ? 22 : fridayPlaces(week),
                status: 'played',
                kind: isNewPlace ? 'new-place' : 'usual'
            });
        }

        if (week % 13 !== 12) {
            games.push({
                localDate: monday,
                localTime: monday >= '2026-10-01' ? '18:30' : '19:00',
                venueId: '019ab2c3-0000-7000-8000-000000000002',
                fieldsPlanned: 1,
                capacityMax: week % 7 === 3 ? 17 : 18,
                status: 'played',
                kind: 'usual'
            });
        }

        if (week % 10 === 5) {
            games.push({
                localDate: addDays(friday, 5),
                localTime: '19:30',
                venueId: '019ab2c3-0000-7000-8000-000000000003',
                fieldsPlanned: 2,
                capacityMax: 24,
                status: 'played',
                kind: 'one-off'
            });
        }
    }

    return games.toSorted((left, right) => left.localDate.localeCompare(right.localDate)).filter(game => weekdayOf(game.localDate) >= 0);
};
