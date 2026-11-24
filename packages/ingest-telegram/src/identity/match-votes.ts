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

export const minGames = 10;
const minShare = 0.9;
const minMargin = 0.12;
const maxGapDays = 180;
const runCost = 1;
const dayMs = 24 * 60 * 60_000;

interface Range {
    readonly start: number;
    readonly end: number;
}

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

const cumulative = (flags: readonly boolean[]): number[] => {
    const totals = [0];

    for (const flag of flags) {
        totals.push((totals.at(-1) ?? 0) + Number(flag));
    }

    return totals;
};

const between = (totals: readonly number[], { start, end }: Range): number => (totals[end] ?? 0) - (totals[start] ?? 0);

export const scoreOf = (shared: number, left: number, right: number): number => (2 * shared) / (left + right);

const personsIn = (games: readonly Squad[]): Set<string> => new Set(games.flatMap(({ yes }) => [...(yes ?? [])]));

const hasVoted = (games: readonly Squad[], personId: string): number[] => cumulative(games.map(({ yes }) => yes?.has(personId) === true));

const makeCache = <Value>(create: (key: string) => Value): ((key: string) => Value) => {
    const values = new Map<string, Value>();

    return key => {
        const known = values.get(key);

        if (isDefined(known)) {
            return known;
        }

        const created = create(key);
        values.set(key, created);

        return created;
    };
};

export const indexVotes = (evidence: VoteEvidence) => {
    const squads = evidence.squads.filter(({ yes }) => isDefined(yes)).toSorted((left, right) => left.date.localeCompare(right.date));
    const presenceOf = makeCache(aliasId => {
        const present = new Set((evidence.timelines.get(aliasId) ?? []).map(({ sessionId }) => sessionId));

        return cumulative(squads.map(({ sessionId }) => present.has(sessionId)));
    });
    const rivalsOf = makeCache((personId: string) =>
        [...evidence.timelines].map(([aliasId, timeline]) => {
            const shared = new Set(timeline.filter(({ yes }) => yes?.has(personId) === true).map(({ sessionId }) => sessionId));

            return { aliasId, presence: presenceOf(aliasId), shared: cumulative(squads.map(({ sessionId }) => shared.has(sessionId))) };
        })
    );

    return {
        evidence,
        yesOf: makeCache(personId => hasVoted(squads, personId)),
        rivalsOf,
        windowOf: (games: readonly Squad[]): Range => {
            const from = games[0]?.date ?? '';
            const to = games.at(-1)?.date ?? '';
            const first = squads.findIndex(({ date }) => date >= from);
            const after = squads.findIndex(({ date }) => date > to);

            return { start: first === -1 ? squads.length : first, end: after === -1 ? squads.length : after };
        }
    };
};

export type VoteIndex = ReturnType<typeof indexVotes>;

const judgeTimeline = (index: VoteIndex, aliasId: string, timeline: readonly AliasGame[]) => {
    const judgedGames = cumulative(timeline.map(({ yes }) => isDefined(yes)));
    const voters = [...personsIn(timeline)].map(personId => ({
        personId,
        voted: hasVoted(timeline, personId),
        yes: index.yesOf(personId)
    }));
    const otherGames = makeCache(personId => index.evidence.gamesUnderOtherName(personId, aliasId));

    return (range: Range): Option.Option<VoteMatch> => {
        const segment = timeline.slice(range.start, range.end);
        const window = index.windowOf(segment);
        const games = between(judgedGames, range);
        const ranked = voters
            .map(({ personId, voted, yes }) => ({ personId, shared: between(voted, range), yes: between(yes, window) }))
            .filter(({ shared }) => shared > 0)
            .map(({ personId, shared, yes }) => ({ personId, shared, yes, score: scoreOf(shared, games, yes) }))
            .toSorted((left, right) => right.score - left.score);
        const [best, runnerUp] = ranked;

        if (!isDefined(best)) {
            return Option.none();
        }

        const rivalScore = index
            .rivalsOf(best.personId)
            .filter(rival => rival.aliasId !== aliasId)
            .reduce((top, rival) => Math.max(top, scoreOf(between(rival.shared, window), between(rival.presence, window), best.yes)), 0);
        const others = otherGames(best.personId);

        return Option.some({
            aliasId,
            personId: best.personId,
            sessionIds: segment.map(({ sessionId }) => sessionId),
            games,
            shared: best.shared,
            score: best.score,
            margin: best.score - Math.max(rivalScore, runnerUp?.score ?? 0),
            mutual: best.score > rivalScore,
            conflict: segment.some(({ sessionId }) => others.has(sessionId))
        });
    };
};

const isCertain = ({ games, shared, margin, mutual, conflict }: VoteMatch): boolean =>
    games >= minGames && shared / games >= minShare && mutual && margin >= minMargin && !conflict;

interface Run {
    readonly range: Range;
    readonly match: VoteMatch | null;
}

interface Partition {
    readonly value: number;
    readonly runs: readonly Run[];
}

const extended = (before: Partition, range: Range, match: VoteMatch | null): Partition => ({
    value: before.value + (match?.shared ?? 0) - runCost,
    runs: [...before.runs, { range, match }]
});

const bestPartition = (length: number, certain: (range: Range) => VoteMatch | null): readonly Run[] => {
    const partitions: Partition[] = [{ value: 0, runs: [] }];

    for (let end = 1; end <= length; end += 1) {
        const options = partitions.flatMap((before, start) => {
            const match = end - start >= minGames ? certain({ start, end }) : null;
            const last = before.runs.at(-1);
            const isAfterGap = isDefined(last) && !isDefined(last.match);

            return isDefined(match) || !isAfterGap ? [extended(before, { start, end }, match)] : [];
        });
        const [best] = options.toSorted((left, right) => right.value - left.value);
        partitions.push(best ?? { value: 0, runs: [] });
    }

    return partitions[length]?.runs ?? [];
};

const withoutUnexplainedEdges = (timeline: readonly AliasGame[], runs: readonly Run[]): VoteMatch[] =>
    runs.flatMap(({ range, match }, position) => {
        if (!isDefined(match)) {
            return [];
        }

        const games = timeline.slice(range.start, range.end);
        const explained = games.map(({ yes }) => yes?.has(match.personId) === true);
        const first = position === 0 ? 0 : explained.indexOf(true);
        const last = position === runs.length - 1 ? games.length : explained.lastIndexOf(true) + 1;

        return [{ ...match, sessionIds: games.slice(first, last).map(({ sessionId }) => sessionId) }];
    });

export const matchSegments = (index: VoteIndex, aliasId: string): { readonly segments: number; readonly matches: VoteMatch[] } => {
    const results = splitByGaps(index.evidence.timelines.get(aliasId) ?? []).map(period => {
        const judgeRange = judgeTimeline(index, aliasId, period);
        const certain = (range: Range): VoteMatch | null =>
            judgeRange(range).pipe(
                Option.filter(match => isCertain(match)),
                Option.getOrNull
            );
        const whole = certain({ start: 0, end: period.length });
        const runs = bestPartition(period.length, certain);
        const persons = new Set(runs.flatMap(({ match }) => (isDefined(match) ? [match.personId] : [])));

        if (persons.size > 1) {
            return { segments: runs.length, matches: withoutUnexplainedEdges(period, runs) };
        }

        return { segments: 1, matches: isDefined(whole) ? [whole] : [] };
    });

    return {
        segments: results.reduce((total, { segments }) => total + segments, 0),
        matches: results.flatMap(({ matches }) => matches)
    };
};
