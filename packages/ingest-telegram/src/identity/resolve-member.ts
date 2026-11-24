import * as Option from 'effect/Option';

import type { LineupMember } from '../extract/fact.model';
import type { Alias, Directory, ResolvedMember } from '../interface/directory.interface';

const byAccount = (directory: Directory, tgUserId: bigint, resolvedBy: 'account' | 'handle'): Option.Option<ResolvedMember> =>
    Option.fromNullishOr(directory.personIdByAccount.get(tgUserId)).pipe(Option.map(personId => ({ personId, tgUserId, resolvedBy })));

export const aliasResolution = ({ resolution }: Alias): ResolvedMember['resolvedBy'] => {
    if (resolution === 'confirmed') {
        return 'alias';
    }

    return resolution === 'vote' ? 'vote' : 'guest';
};

export const resolveAccount = (member: LineupMember, authorId: number | undefined, directory: Directory): Option.Option<ResolvedMember> => {
    const userId = member.userId ?? (member.isSelf ? authorId : null);
    const handleOwner = directory.accountByHandle.get(member.handle?.toLowerCase() ?? '');

    return Option.fromNullishOr(userId).pipe(
        Option.flatMap(id => byAccount(directory, BigInt(id), 'account')),
        Option.orElse(() => Option.fromNullishOr(handleOwner).pipe(Option.flatMap(tgUserId => byAccount(directory, tgUserId, 'handle'))))
    );
};

export const resolveAlias = (aliasNorm: string, directory: Directory): Option.Option<ResolvedMember> =>
    Option.fromNullishOr(directory.aliasByNorm.get(aliasNorm)).pipe(
        Option.map(alias => ({ personId: alias.personId, aliasId: alias.id, resolvedBy: aliasResolution(alias) }))
    );
