import { isDefined } from '@rnw-community/shared';
import * as Option from 'effect/Option';

export interface Squad {
    readonly sessionId: string;
    readonly date: string;
    readonly yes: ReadonlySet<string> | null;
}

export interface AliasGame extends Squad {
    readonly players: number;
}

export interface VoteEvidence {
    readonly squads: readonly Squad[];
    readonly timelines: ReadonlyMap<string, readonly AliasGame[]>;
    readonly gamesUnderOtherName: (personId: string, aliasId: string) => ReadonlySet<string>;
}

export interface VoteMatch {
    readonly aliasId: string;
    readonly personId: string;
    readonly sessionIds: readonly string[];
    readonly games: number;
    readonly shared: number;
    readonly score: number;
    readonly margin: number;
    readonly mutual: boolean;
    readonly conflict: boolean;
}

export interface PersonSet {
    readonly personIds: readonly string[];
    readonly games: number;
    readonly score: number;
    readonly margin: number;
}

const minGames = 10;
const minShare = 0.9;
const minMargin = 0.12;
const minSetScore = 0.85;
const minSetMargin = 0.08;
const maxGapDays = 180;
const maxCandidates = 40;
const maxCombinations = 10_000;
const minSquads = 2;
const minSharedPlayers = 2;
const dayMs = 24 * 60 * 60_000;

const daysBetween = (from: string, to: string): number => (Date.parse(to) - Date.parse(from)) / dayMs;

export const splitByGaps = (timeline: readonly AliasGame[]): AliasGame[][] => {
    const segments: AliasGame[][] = [];

    for (const game of timeline) {
        const segment = segments.at(-1);
        const last = segment?.at(-1);

        if (isDefined(segment) && isDefined(last) && daysBetween(last.date, game.date) <= maxGapDays) {
            segment.push(game);
        } else {
            segments.push([game]);
        }
    }

    return segments;
};

const votesPerPerson = (squads: readonly Squad[]): Map<string, number> => {
    const counts = new Map<string, number>();

    for (const { yes } of squads) {
        for (const personId of yes ?? []) {
            counts.set(personId, (counts.get(personId) ?? 0) + 1);
        }
    }

    return counts;
};

const squadsWithin = <Game extends Squad>(squads: readonly Game[], segment: readonly Squad[]): Game[] => {
    const from = segment[0]?.date ?? '';
    const to = segment.at(-1)?.date ?? '';

    return squads.filter(({ yes, date }) => isDefined(yes) && date >= from && date <= to);
};

const overlap = (games: readonly Squad[], personId: string): number => games.filter(({ yes }) => yes?.has(personId) === true).length;

const scoreOf = (shared: number, left: number, right: number): number => (2 * shared) / (left + right);

export const judge = (evidence: VoteEvidence, aliasId: string, segment: readonly AliasGame[]): Option.Option<VoteMatch> => {
    const judged = segment.filter(({ yes }) => isDefined(yes));
    const yesTotals = votesPerPerson(squadsWithin(evidence.squads, segment));
    const [best, runnerUp] = [...votesPerPerson(judged)]
        .map(([personId, shared]) => ({ personId, shared, score: scoreOf(shared, judged.length, yesTotals.get(personId) ?? 0) }))
        .toSorted((left, right) => right.score - left.score);

    if (!isDefined(best)) {
        return Option.none();
    }

    const rivalScore = Math.max(
        0,
        ...[...evidence.timelines]
            .filter(([other]) => other !== aliasId)
            .map(([, timeline]) => {
                const games = squadsWithin(timeline, segment);

                return scoreOf(overlap(games, best.personId), games.length, yesTotals.get(best.personId) ?? 0);
            })
    );
    const otherGames = evidence.gamesUnderOtherName(best.personId, aliasId);

    return Option.some({
        aliasId,
        personId: best.personId,
        sessionIds: segment.map(({ sessionId }) => sessionId),
        games: judged.length,
        shared: best.shared,
        score: best.score,
        margin: best.score - Math.max(rivalScore, runnerUp?.score ?? 0),
        mutual: best.score > rivalScore,
        conflict: segment.some(({ sessionId }) => otherGames.has(sessionId))
    });
};

const isCertain = ({ games, shared, margin, mutual, conflict }: VoteMatch): boolean =>
    games >= minGames && shared / games >= minShare && mutual && margin >= minMargin && !conflict;

const certainMatch = (evidence: VoteEvidence, aliasId: string, segment: readonly AliasGame[]): VoteMatch[] =>
    judge(evidence, aliasId, segment).pipe(
        Option.filter(match => isCertain(match)),
        Option.toArray
    );

type Segment = readonly AliasGame[];

const sharedIn = (matches: readonly VoteMatch[]): number => matches.reduce((total, { shared }) => total + shared, 0);

const bestSplit = (
    evidence: VoteEvidence,
    aliasId: string,
    segment: Segment,
    whole: VoteMatch | undefined
): readonly [Segment, Segment] | undefined => {
    const splits = segment.flatMap((_, index) => {
        const halves = [segment.slice(0, index), segment.slice(index)] as const;

        if (halves.some(half => half.length < minGames)) {
            return [];
        }

        const matches = halves.flatMap(half => certainMatch(evidence, aliasId, half));
        const persons = new Set(matches.map(({ personId }) => personId));
        const changes = isDefined(whole) ? [...persons].some(personId => personId !== whole.personId) : persons.size > 1;

        return changes ? [{ halves, shared: sharedIn(matches) }] : [];
    });

    return splits.toSorted((left, right) => right.shared - left.shared)[0]?.halves;
};

const splitByPerson = (evidence: VoteEvidence, aliasId: string, segment: Segment): Segment[] => {
    const [whole] = certainMatch(evidence, aliasId, segment);
    const split = bestSplit(evidence, aliasId, segment, whole);

    return isDefined(split) ? split.flatMap(half => splitByPerson(evidence, aliasId, half)) : [segment];
};

export const matchSegments = (evidence: VoteEvidence, aliasId: string): { readonly segments: number; readonly matches: VoteMatch[] } => {
    const segments = splitByGaps(evidence.timelines.get(aliasId) ?? []).flatMap(segment => splitByPerson(evidence, aliasId, segment));

    return { segments: segments.length, matches: segments.flatMap(segment => certainMatch(evidence, aliasId, segment)) };
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
    const yesTotals = votesPerPerson(squadsWithin(squads, segment));
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
