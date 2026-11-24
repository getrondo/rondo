import { isDefined } from '@rnw-community/shared';

export interface VoteEvidence {
    readonly personIdByAccount: ReadonlyMap<bigint, string>;
    readonly yesGamesByAccount: ReadonlyMap<bigint, ReadonlySet<string>>;
    readonly gamesByAlias: ReadonlyMap<string, ReadonlySet<string>>;
    readonly otherAliasGamesByPerson: (personId: string, aliasId: string) => ReadonlySet<string>;
}

interface VoteMatch {
    readonly aliasId: string;
    readonly tgUserId: bigint;
    readonly personId: string;
    readonly games: number;
    readonly shared: number;
    readonly score: number;
}

export interface RankedMatch extends VoteMatch {
    readonly margin: number;
    readonly mutual: boolean;
    readonly conflict: boolean;
}

const minGames = 10;
const minShare = 0.9;
const minMargin = 0.12;

const groupByKey = <Key>(matches: readonly VoteMatch[], keyOf: (match: VoteMatch) => Key): Map<Key, VoteMatch[]> => {
    const groups = new Map<Key, VoteMatch[]>();

    for (const match of matches.toSorted((left, right) => right.score - left.score)) {
        const group = groups.get(keyOf(match)) ?? [];
        group.push(match);
        groups.set(keyOf(match), group);
    }

    return groups;
};

const scoreAll = ({ gamesByAlias, yesGamesByAccount, personIdByAccount }: VoteEvidence): VoteMatch[] =>
    [...gamesByAlias].flatMap(([aliasId, games]) =>
        [...yesGamesByAccount].flatMap(([tgUserId, yesGames]) => {
            const shared = games.intersection(yesGames).size;
            const personId = personIdByAccount.get(tgUserId);

            return shared === 0 || !isDefined(personId)
                ? []
                : [{ aliasId, tgUserId, personId, games: games.size, shared, score: (2 * shared) / (games.size + yesGames.size) }];
        })
    );

const marginOf = (match: VoteMatch, ranked: readonly VoteMatch[]): number =>
    match.score - (ranked.find(other => other !== match)?.score ?? 0);

export const rankVoteMatches = (evidence: VoteEvidence): RankedMatch[] => {
    const matches = scoreAll(evidence);
    const byAlias = groupByKey(matches, match => match.aliasId);
    const byAccount = groupByKey(matches, match => match.tgUserId);

    return [...byAlias.values()]
        .flatMap(([best, ...others]) => (isDefined(best) ? [{ best, others }] : []))
        .map(({ best, others }) => {
            const rivals = byAccount.get(best.tgUserId) ?? [];

            return Object.assign(best, {
                margin: Math.min(marginOf(best, others), marginOf(best, rivals)),
                mutual: rivals[0] === best,
                conflict:
                    (evidence.gamesByAlias.get(best.aliasId) ?? new Set<string>()).intersection(
                        evidence.otherAliasGamesByPerson(best.personId, best.aliasId)
                    ).size > 0
            });
        })
        .toSorted((left, right) => right.score - left.score);
};

export const isCertain = ({ games, shared, margin, mutual, conflict }: RankedMatch): boolean =>
    games >= minGames && shared / games >= minShare && mutual && margin >= minMargin && !conflict;
