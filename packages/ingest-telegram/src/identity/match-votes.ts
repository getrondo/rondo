import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import * as Option from 'effect/Option';

export interface Squad {
    readonly sessionId: string;
    readonly date: string;
    readonly yes: ReadonlySet<bigint> | null;
}

export interface AliasGame extends Squad {
    readonly players: number;
}

export interface VoteEvidence {
    readonly squads: readonly Squad[];
    readonly personIdByAccount: ReadonlyMap<bigint, string>;
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

export interface AccountSet {
    readonly accounts: readonly bigint[];
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

const votesPerAccount = (squads: readonly Squad[]): Map<bigint, number> => {
    const counts = new Map<bigint, number>();

    for (const { yes } of squads) {
        for (const account of yes ?? []) {
            counts.set(account, (counts.get(account) ?? 0) + 1);
        }
    }

    return counts;
};

const squadsWithin = <Game extends Squad>(squads: readonly Game[], segment: readonly Squad[]): Game[] => {
    const from = segment[0]?.date ?? '';
    const to = segment.at(-1)?.date ?? '';

    return squads.filter(({ yes, date }) => isDefined(yes) && date >= from && date <= to);
};

const overlap = (games: readonly Squad[], account: bigint): number => games.filter(({ yes }) => yes?.has(account) === true).length;

const scoreOf = (shared: number, left: number, right: number): number => (2 * shared) / (left + right);

export const judge = (evidence: VoteEvidence, aliasId: string, segment: readonly AliasGame[]): Option.Option<VoteMatch> => {
    const judged = segment.filter(({ yes }) => isDefined(yes));
    const yesTotals = votesPerAccount(squadsWithin(evidence.squads, segment));
    const [best, runnerUp] = [...votesPerAccount(judged)]
        .map(([account, shared]) => ({ account, shared, score: scoreOf(shared, judged.length, yesTotals.get(account) ?? 0) }))
        .toSorted((left, right) => right.score - left.score);
    const personId = isDefined(best) ? evidence.personIdByAccount.get(best.account) : null;

    if (!isDefined(best) || !isDefined(personId)) {
        return Option.none();
    }

    const rivalScore = Math.max(
        0,
        ...[...evidence.timelines]
            .filter(([other]) => other !== aliasId)
            .map(([, timeline]) => {
                const games = squadsWithin(timeline, segment);

                return scoreOf(overlap(games, best.account), games.length, yesTotals.get(best.account) ?? 0);
            })
    );
    const otherGames = evidence.gamesUnderOtherName(personId, aliasId);

    return Option.some({
        aliasId,
        personId,
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

const splitByAccount = (evidence: VoteEvidence, aliasId: string, segment: readonly AliasGame[]): VoteMatch[] => {
    const splits = segment.flatMap((_, index) => {
        const halves = [segment.slice(0, index), segment.slice(index)];

        if (halves.some(half => half.length < minGames)) {
            return [];
        }

        const [before, after] = halves.flatMap(half => certainMatch(evidence, aliasId, half));

        return isDefined(before) && isDefined(after) && before.personId !== after.personId ? [[before, after]] : [];
    });
    const sharedIn = (matches: readonly VoteMatch[]): number => matches.reduce((total, { shared }) => total + shared, 0);
    const [best] = splits.toSorted((left, right) => sharedIn(right) - sharedIn(left));

    return best ?? [];
};

export const matchSegments = (evidence: VoteEvidence, aliasId: string): { readonly segments: number; readonly matches: VoteMatch[] } => {
    const segments = splitByGaps(evidence.timelines.get(aliasId) ?? []);
    const matches = segments.flatMap(segment => {
        const whole = certainMatch(evidence, aliasId, segment);

        return isNotEmptyArray(whole) ? whole : splitByAccount(evidence, aliasId, segment);
    });

    return { segments: segments.length, matches };
};

const combinations = (items: readonly bigint[], size: number): bigint[][] => {
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

const usualPlayers = (timeline: readonly AliasGame[]): number =>
    timeline.map(({ players }) => players).toSorted((left, right) => right - left)[1] ?? 1;

interface RatedSet {
    readonly accounts: readonly bigint[];
    readonly score: number;
}

const byScore = (sets: readonly RatedSet[]): RatedSet[] => sets.toSorted((left, right) => right.score - left.score);

const isSameSet = (left: RatedSet, right: RatedSet): boolean => left.accounts.every(account => right.accounts.includes(account));

export const matchSet = (
    squads: readonly Squad[],
    segment: readonly AliasGame[],
    isPossible: (account: bigint) => boolean
): Option.Option<AccountSet> => {
    const judged = segment.filter(({ yes }) => isDefined(yes));
    const entries = judged.reduce((total, { players }) => total + players, 0);
    const size = usualPlayers(segment);
    const yesTotals = votesPerAccount(squadsWithin(squads, segment));
    const possible = [...votesPerAccount(judged)]
        .filter(([account]) => isPossible(account))
        .map(([account, shared]) => ({ account, score: scoreOf(shared, entries / size, yesTotals.get(account) ?? 0) }))
        .toSorted((left, right) => right.score - left.score)
        .map(({ account }) => account);
    const rate = (accounts: readonly bigint[]): RatedSet => {
        const explained = judged.reduce(
            (total, { players, yes }) => total + Math.min(players, accounts.filter(account => yes?.has(account) === true).length),
            0
        );
        const votes = accounts.reduce((total, account) => total + (yesTotals.get(account) ?? 0), 0);

        return { accounts, score: scoreOf(explained, entries, votes) };
    };
    const [found, next] = byScore(combinations(possible.slice(0, maxCandidates), size).map(accounts => rate(accounts)));

    if (!isDefined(found)) {
        return Option.none();
    }

    const swaps = byScore(
        found.accounts.flatMap(out =>
            possible
                .filter(account => !found.accounts.includes(account))
                .map(account => rate([...found.accounts.filter(kept => kept !== out), account]))
        )
    );
    const [best = found, ...others] = byScore([found, ...swaps, ...(isDefined(next) ? [next] : [])]);

    return Option.some({
        accounts: best.accounts.toSorted((left, right) => Number(left - right)),
        games: judged.length,
        score: best.score,
        margin: best.score - (others.find(other => !isSameSet(other, best))?.score ?? 0)
    });
};

export const isCertainSet = ({ games, score, margin }: AccountSet): boolean =>
    games >= minGames && score >= minSetScore && margin >= minSetMargin;
