import { isDefined, isEmptyArray, isNotEmptyArray } from '@rnw-community/shared';

import { addDays } from '../utils/add-days.util';
import { weekdayOf } from '../utils/weekday-of.util';

import type { GameCandidate, GamePlan, GameSize, PastGame, PlannedGame } from './past-game.interface';

const heldStatuses = new Set(['open', 'full', 'locked', 'played']);
const patternDays = 84;
const minimumDates = 2;
const decayPerWeek = 0.8;
const placeMemory = 12;
const defaultTimes = ['18:00', '18:30', '19:00', '19:30', '20:00', '20:30'];
const dayButtons = 6;
const candidateCount = 2;

const daysBetween = (from: string, to: string): number =>
    Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

const latestFirst = (games: readonly PastGame[]) =>
    games.toSorted((left, right) => `${right.localDate}${right.localTime}`.localeCompare(`${left.localDate}${left.localTime}`));

const heldGames = (games: readonly PastGame[]): PastGame[] =>
    latestFirst([
        ...new Map(
            games
                .filter(game => heldStatuses.has(game.status) && isDefined(game.venueId))
                .map(game => [`${game.localDate}|${game.venueId}|${game.localTime}`, game])
        ).values()
    ]);

const patternOf = (games: readonly PastGame[], today: string): PastGame[] =>
    heldGames(games).filter(game => game.localDate >= addDays(today, -patternDays) && game.localDate <= today);

const rankBy = <Key>(games: readonly PastGame[], today: string, keyOf: (game: PastGame) => Key | null): Key[] => {
    const tally = new Map<Key, { readonly score: number; readonly last: string }>();

    for (const game of latestFirst(games)) {
        const key = keyOf(game);

        if (isDefined(key)) {
            const weight = decayPerWeek ** Math.max(0, Math.floor(daysBetween(game.localDate, today) / 7));
            const entry = tally.get(key);
            tally.set(key, { score: (entry?.score ?? 0) + weight, last: entry?.last ?? game.localDate });
        }
    }

    return [...tally.entries()]
        .toSorted(([, left], [, right]) => right.score - left.score || right.last.localeCompare(left.last))
        .map(([key]) => key);
};

const onWeekdayOf = (games: readonly PastGame[], localDate: string) =>
    games.filter(game => weekdayOf(game.localDate) === weekdayOf(localDate));

const usualWeekdays = (pattern: readonly PastGame[], today: string): number[] =>
    rankBy(pattern, today, game => weekdayOf(game.localDate)).filter(
        weekday => new Set(pattern.filter(game => weekdayOf(game.localDate) === weekday).map(game => game.localDate)).size >= minimumDates
    );

const nextOn = (weekday: number, from: string): string => addDays(from, (weekday - weekdayOf(from) + 7) % 7);

const mostUsed = (games: readonly PastGame[], valueOf: (game: PastGame) => number | null): number[] => {
    const values = games
        .slice(0, placeMemory)
        .map(game => valueOf(game))
        .filter(value => isDefined(value));
    const counts = new Map<number, number>();

    for (const value of values) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
    }

    return [...counts.keys()].toSorted(
        (left, right) => (counts.get(right) ?? 0) - (counts.get(left) ?? 0) || values.indexOf(left) - values.indexOf(right)
    );
};

export const placeSizes = (games: readonly PastGame[], venueId: string | null): number[] =>
    mostUsed(
        heldGames(games).filter(game => game.venueId === venueId),
        game => game.capacityMax
    );

export const sizeAt = (games: readonly PastGame[], venueId: string | null, localDate: string): GameSize => {
    const held = heldGames(games);
    const scopes = [held.filter(game => game.venueId === venueId), onWeekdayOf(held, localDate), held];
    const pick = (valueOf: (game: PastGame) => number | null) =>
        scopes.map(scope => mostUsed(scope, valueOf)[0]).find(value => isDefined(value)) ?? null;

    return { fields: pick(game => game.fieldsPlanned), places: pick(game => game.capacityMax) };
};

const usualGameOn = (games: readonly PastGame[], pattern: readonly PastGame[], localDate: string, today: string): GamePlan | null => {
    const [combination] = rankBy(onWeekdayOf(pattern, localDate), today, game => `${game.venueId}|${game.localTime}`);
    const sample = pattern.find(game => `${game.venueId}|${game.localTime}` === combination);

    return isDefined(sample)
        ? { localDate, localTime: sample.localTime, venueId: sample.venueId, ...sizeAt(games, sample.venueId, localDate) }
        : null;
};

const candidateOn = (games: readonly PastGame[], planned: readonly PlannedGame[], weekday: number, today: string): GameCandidate | null => {
    const pattern = patternOf(games, today);

    for (let week = 0; week < 4; week += 1) {
        const localDate = nextOn(weekday, addDays(today, 1 + week * 7));
        const existing = planned.filter(game => game.localDate === localDate);
        const unannounced = existing.find(game => !game.hasPoll);

        if (isDefined(unannounced)) {
            return { _tag: 'announce', sessionId: unannounced.sessionId, localDate };
        }

        const usual = isEmptyArray(existing) ? usualGameOn(games, pattern, localDate, today) : null;

        if (isDefined(usual)) {
            return { _tag: 'new', ...usual };
        }
    }

    return null;
};

export const predictGames = (games: readonly PastGame[], planned: readonly PlannedGame[], today: string): GameCandidate[] =>
    usualWeekdays(patternOf(games, today), today)
        .map(weekday => candidateOn(games, planned, weekday, today))
        .filter(candidate => isDefined(candidate))
        .toSorted((left, right) => left.localDate.localeCompare(right.localDate))
        .slice(0, candidateCount);

export const dayChoices = (games: readonly PastGame[], today: string, options: { readonly today: boolean }): string[] => {
    const tomorrow = addDays(today, 1);
    const likely = usualWeekdays(patternOf(games, today), today)
        .map(weekday => nextOn(weekday, tomorrow))
        .toSorted();
    const week = Array.from({ length: 7 }, (_, offset) => addDays(tomorrow, offset));
    const days = [...likely, ...week.filter(day => !likely.includes(day))].slice(0, dayButtons);

    return options.today ? [...days, today] : days;
};

export const rankVenues = <Venue extends { readonly id: string; readonly name: string }>(
    games: readonly PastGame[],
    venues: readonly Venue[],
    localDate: string
): Venue[] => {
    const held = heldGames(games).filter(game => game.localDate <= localDate);
    const pattern = held.filter(game => game.localDate >= addDays(localDate, -patternDays));
    const ranked = [
        ...new Set([
            ...rankBy(onWeekdayOf(pattern, localDate), localDate, game => game.venueId),
            ...rankBy(held, localDate, game => game.venueId)
        ])
    ];
    const position = (id: string) => (ranked.includes(id) ? ranked.indexOf(id) : ranked.length);

    return venues.toSorted((left, right) => position(left.id) - position(right.id) || left.name.localeCompare(right.name));
};

export const rankTimes = (games: readonly PastGame[], venueId: string | null, localDate: string): string[] => {
    const held = heldGames(games).filter(game => game.localDate <= localDate);
    const onWeekday = onWeekdayOf(held, localDate);
    const times = [
        ...rankBy(
            onWeekday.filter(game => game.venueId === venueId),
            localDate,
            game => game.localTime
        ),
        ...rankBy(
            held.filter(game => game.venueId === venueId),
            localDate,
            game => game.localTime
        ),
        ...rankBy(onWeekday, localDate, game => game.localTime),
        ...rankBy(held, localDate, game => game.localTime)
    ];
    const unique = [...new Set(times)];

    return isNotEmptyArray(unique) ? unique : defaultTimes;
};

const shiftTime = (localTime: string, minutes: number): string => {
    const [hours = 0, rest = 0] = localTime.split(':').map(Number);
    const total = (((hours * 60 + rest + minutes) % 1440) + 1440) % 1440;

    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

export const timeChoices = (games: readonly PastGame[], venueId: string | null, localDate: string, current: string): string[] =>
    [
        ...new Set([...rankTimes(games, venueId, localDate).slice(0, 2), shiftTime(current, -30), current, shiftTime(current, 30)])
    ].toSorted();
