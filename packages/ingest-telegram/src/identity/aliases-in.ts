import { isDefined } from '@rnw-community/shared';
import * as Option from 'effect/Option';

import { placeholderNorm } from './placeholder-norm';
import { resolveAccount } from './resolve-member';

import type { LineupFact, LineupMember } from '../extract/fact.model';
import type { Directory, SeenAlias } from '../interface/directory.interface';

interface Sighting {
    readonly member: LineupMember;
    readonly seenAt: Date;
}

const membersWithoutAccount = (lineup: LineupFact, directory: Directory): LineupMember[] =>
    lineup.teams.flatMap(({ members }) => members).filter(member => Option.isNone(resolveAccount(member, lineup.authorId, directory)));

const repeatedNorms = (members: readonly LineupMember[]): string[] => {
    const alone = members.filter(({ guests }) => guests === 0).map(({ aliasNorm }) => aliasNorm);

    return alone.filter((aliasNorm, index) => alone.indexOf(aliasNorm) !== index);
};

const mostFrequent = (spellings: readonly string[]): string => {
    const counts = new Map<string, number>();

    for (const spelling of spellings) {
        counts.set(spelling, (counts.get(spelling) ?? 0) + 1);
    }

    const [top] = [...counts].toSorted((left, right) => right[1] - left[1]);

    return top?.[0] ?? '';
};

export const aliasesIn = (lineups: readonly LineupFact[], directory: Directory, selfName: string): SeenAlias[] => {
    const games = lineups.map(lineup => ({ seenAt: lineup.postedAt, members: membersWithoutAccount(lineup, directory) }));
    const shared = new Set(games.flatMap(({ members }) => repeatedNorms(members)));
    const isShared = (aliasNorm: string): boolean => shared.has(aliasNorm) || directory.aliasByNorm.get(aliasNorm)?.kind === 'placeholder';
    const sightings = new Map<string, Sighting[]>();

    for (const { seenAt, members } of games) {
        const occurrences = new Map<string, number>();

        for (const member of members) {
            const occurrence = (occurrences.get(member.aliasNorm) ?? 0) + 1;
            const key = isShared(member.aliasNorm) ? placeholderNorm(member.aliasNorm, occurrence) : member.aliasNorm;
            occurrences.set(member.aliasNorm, occurrence);
            sightings.set(key, [...(sightings.get(key) ?? []), { member, seenAt }]);
        }
    }

    return [...sightings].flatMap(([aliasNorm, group]) => {
        const first = group[0]?.member;

        if (!isDefined(first)) {
            return [];
        }

        const times = group.map(({ seenAt }) => seenAt.getTime());
        const knownKind = isShared(first.aliasNorm) ? ('placeholder' as const) : ('nickname' as const);

        return [
            {
                alias: mostFrequent(group.map(({ member }) => member.alias)),
                aliasNorm,
                kind: first.isSelf ? ('self' as const) : knownKind,
                personName: first.isSelf ? selfName : null,
                occurrences: group.length,
                firstSeenAt: new Date(Math.min(...times)),
                lastSeenAt: new Date(Math.max(...times))
            }
        ];
    });
};
