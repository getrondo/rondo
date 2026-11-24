import { isDefined } from '@rnw-community/shared';
import * as Option from 'effect/Option';

import { resolveAccount } from './resolve-member';

import type { LineupFact, LineupMember } from '../extract/fact.model';
import type { Directory, SeenAlias } from '../interface/directory.interface';

interface Sighting {
    readonly member: LineupMember;
    readonly seenAt: Date;
}

const mostFrequent = (spellings: readonly string[]): string => {
    const counts = new Map<string, number>();

    for (const spelling of spellings) {
        counts.set(spelling, (counts.get(spelling) ?? 0) + 1);
    }

    const [top] = [...counts].toSorted((left, right) => right[1] - left[1]);

    return top?.[0] ?? '';
};

export const aliasesIn = (lineups: readonly LineupFact[], directory: Directory, selfName: string): SeenAlias[] => {
    const sightings = new Map<string, Sighting[]>();

    for (const lineup of lineups) {
        const named = lineup.teams
            .flatMap(({ members }) => members)
            .filter(member => !isDefined(member.guest) && Option.isNone(resolveAccount(member, lineup.authorId, directory)));

        for (const member of named) {
            sightings.set(member.aliasNorm, [...(sightings.get(member.aliasNorm) ?? []), { member, seenAt: lineup.postedAt }]);
        }
    }

    return [...sightings].map(([aliasNorm, group]) => {
        const times = group.map(({ seenAt }) => seenAt.getTime());
        const isSelf = group.some(({ member }) => member.isSelf);

        return {
            alias: mostFrequent(group.map(({ member }) => member.alias)),
            aliasNorm,
            kind: isSelf ? ('self' as const) : ('nickname' as const),
            personName: isSelf ? selfName : null,
            occurrences: group.length,
            firstSeenAt: new Date(Math.min(...times)),
            lastSeenAt: new Date(Math.max(...times))
        };
    });
};
