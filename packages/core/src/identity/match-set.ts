import { isDefined } from '@rnw-community/shared';
import * as Option from 'effect/Option';

import { minGames, scoreOf, type AliasGame, type Squad } from './match-votes';

interface PersonSet {
    readonly personIds: readonly string[];
    readonly games: number;
    readonly score: number;
    readonly margin: number;
}

const minSetScore = 0.85;
const minSetMargin = 0.08;
const maxCandidates = 40;
const maxCombinations = 10_000;
const minSquads = 2;
const minSharedPlayers = 2;

const votesPerPerson = (squads: readonly Squad[]): Map<string, number> => {
    const counts = new Map<string, number>();

    for (const { yes } of squads) {
        for (const personId of yes ?? []) {
            counts.set(personId, (counts.get(personId) ?? 0) + 1);
        }
    }

    return counts;
};

const combinations = (items: readonly string[], size: number): string[][] => {
    if (size === 0) {
        return [[]];
    }

    return items.flatMap((item, index) => {
        const tails = combinations(items.slice(index + 1), size - 1);

        for (const tail of tails) {
            tail.unshift(item);
        }

        return tails;
    });
};

const usualPlayers = (timeline: readonly AliasGame[]): number => {
    const squadsByCount = new Map<number, number>();

    for (const { players } of timeline) {
        squadsByCount.set(players, (squadsByCount.get(players) ?? 0) + 1);
    }

    return Math.max(minSharedPlayers, ...[...squadsByCount].filter(([, squads]) => squads >= minSquads).map(([players]) => players));
};

const combinationCount = (items: number, size: number): number =>
    Array.from({ length: size }, (_, index) => (items - index) / (index + 1)).reduce((total, factor) => total * factor, 1);

const candidateCount = (size: number): number => {
    let candidates = Math.max(size, maxCandidates);

    while (candidates > size && combinationCount(candidates, size) > maxCombinations) {
        candidates -= 1;
    }

    return candidates;
};

interface RatedSet {
    readonly personIds: readonly string[];
    readonly score: number;
}

const byScore = (sets: readonly RatedSet[]): RatedSet[] => sets.toSorted((left, right) => right.score - left.score);

const isSameSet = (left: RatedSet, right: RatedSet): boolean => left.personIds.every(personId => right.personIds.includes(personId));

export const matchSet = (
    squads: readonly Squad[],
    segment: readonly AliasGame[],
    isPossible: (personId: string) => boolean
): Option.Option<PersonSet> => {
    const judged = segment.filter(({ yes }) => isDefined(yes));
    const entries = judged.reduce((total, { players }) => total + players, 0);
    const size = usualPlayers(segment);
    const from = segment[0]?.date ?? '';
    const to = segment.at(-1)?.date ?? '';
    const yesTotals = votesPerPerson(squads.filter(({ date }) => date >= from && date <= to));
    const possible = [...votesPerPerson(judged)]
        .filter(([personId]) => isPossible(personId))
        .map(([personId, shared]) => ({ personId, score: scoreOf(shared, entries / size, yesTotals.get(personId) ?? 0) }))
        .toSorted((left, right) => right.score - left.score)
        .map(({ personId }) => personId);
    const rate = (personIds: readonly string[]): RatedSet => {
        const explained = judged.reduce(
            (total, { players, yes }) => total + Math.min(players, personIds.filter(personId => yes?.has(personId) === true).length),
            0
        );
        const votes = personIds.reduce((total, personId) => total + (yesTotals.get(personId) ?? 0), 0);

        return { personIds, score: scoreOf(explained, entries, votes) };
    };
    const [found, next] = byScore(combinations(possible.slice(0, candidateCount(size)), size).map(personIds => rate(personIds)));

    if (!isDefined(found)) {
        return Option.none();
    }

    const swaps = byScore(
        found.personIds.flatMap(out =>
            possible
                .filter(personId => !found.personIds.includes(personId))
                .map(personId => rate([...found.personIds.filter(kept => kept !== out), personId]))
        )
    );
    const [best = found, ...others] = byScore([found, ...swaps, ...(isDefined(next) ? [next] : [])]);

    return Option.some({
        personIds: best.personIds.toSorted(),
        games: judged.length,
        score: best.score,
        margin: best.score - (others.find(other => !isSameSet(other, best))?.score ?? 0)
    });
};

export const isCertainSet = ({ games, score, margin }: PersonSet): boolean =>
    games >= minGames && score >= minSetScore && margin >= minSetMargin;
