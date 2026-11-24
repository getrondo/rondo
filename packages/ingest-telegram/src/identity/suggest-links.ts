import { isDefined } from '@rnw-community/shared';

import { scoreOf, splitByGaps, type AliasGame, type VoteEvidence } from './match-votes';

interface LinkedPeriod {
    readonly first: string;
    readonly last: string;
}

export interface LinkSuggestion {
    readonly aliasId: string;
    readonly personId: string;
    readonly games: number;
    readonly shared: number;
    readonly score: number;
    readonly from: string;
    readonly to: string;
}

const minSuggestionGames = 2;
const minSuggestionScore = 0.5;

const partsOf = (period: readonly AliasGame[], linked: LinkedPeriod | undefined): (readonly AliasGame[])[] =>
    isDefined(linked) ? [period.filter(({ date }) => date < linked.first), period.filter(({ date }) => date > linked.last)] : [period];

const suggestFor = (evidence: VoteEvidence, aliasId: string, personId: string, part: readonly AliasGame[]): LinkSuggestion[] => {
    const judged = part.filter(({ yes }) => isDefined(yes));
    const from = part[0]?.date ?? '';
    const to = part.at(-1)?.date ?? '';
    const shared = judged.filter(({ yes }) => yes?.has(personId) === true).length;
    const yes = evidence.squads.filter(squad => squad.date >= from && squad.date <= to && squad.yes?.has(personId) === true).length;
    const otherGames = evidence.gamesUnderOtherName(personId, aliasId);
    const score = scoreOf(shared, judged.length, yes);
    const isLikely = shared >= minSuggestionGames && score >= minSuggestionScore;

    return isLikely && !part.some(({ sessionId }) => otherGames.has(sessionId))
        ? [{ aliasId, personId, games: judged.length, shared, score, from, to }]
        : [];
};

const bestOnly = (suggestions: readonly LinkSuggestion[]): LinkSuggestion[] => {
    const top = Math.max(0, ...suggestions.map(({ score }) => score));

    return suggestions.filter(({ score }) => score === top);
};

export const suggestLinks = (evidence: VoteEvidence, linkedPeriods: ReadonlyMap<string, LinkedPeriod>): LinkSuggestion[] =>
    [...evidence.timelines]
        .flatMap(([aliasId, timeline]) =>
            splitByGaps(timeline).flatMap(period => {
                const voters = new Set(period.flatMap(({ yes }) => [...(yes ?? [])]));
                const found = [...voters].flatMap(personId =>
                    partsOf(period, linkedPeriods.get(personId)).flatMap(part => suggestFor(evidence, aliasId, personId, part))
                );

                return bestOnly(found);
            })
        )
        .toSorted((left, right) => right.score - left.score || right.shared - left.shared);
