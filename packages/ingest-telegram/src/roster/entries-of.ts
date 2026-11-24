import { isDefined } from '@rnw-community/shared';
import * as Option from 'effect/Option';

import { resolveAccount, resolveAlias } from '../identity/resolve-member';

import type { LineupFact, LineupMember } from '../extract/fact.model';
import type { Directory, EntryRow, ResolvedMember } from '../interface/directory.interface';

const takeManual = (manual: EntryRow[], raw: string, teamOrdinal: number, position: number): EntryRow | undefined => {
    const same = manual.filter(entry => entry.raw === raw);
    const taken = same.find(entry => entry.teamOrdinal === teamOrdinal && entry.position === position) ?? same[0];

    if (isDefined(taken)) {
        manual.splice(manual.indexOf(taken), 1);
    }

    return taken;
};

const entriesOfMember = (member: LineupMember, resolved: ResolvedMember, override: EntryRow | undefined) => {
    const manualPersonId = override?.personId;
    const player = isDefined(manualPersonId)
        ? { personId: manualPersonId, aliasId: resolved.aliasId, resolvedBy: 'manual' as const }
        : resolved;

    return [
        { ...player, raw: member.raw, isGk: member.isGk, isNewcomer: member.isNewcomer },
        ...Array.from({ length: member.guests }, () => ({
            aliasId: resolved.aliasId,
            guestOfPersonId: player.personId,
            resolvedBy: 'guest' as const
        }))
    ];
};

export const entriesOf = (
    sessionId: string,
    lineup: LineupFact,
    directory: Directory,
    manualEntries: readonly EntryRow[] = []
): EntryRow[] => {
    const manual = [...manualEntries];
    const occurrences = new Map<string, number>();

    const resolve = (member: LineupMember): Option.Option<ResolvedMember> =>
        resolveAccount(member, lineup.authorId, directory).pipe(
            Option.orElse(() => {
                const occurrence = (occurrences.get(member.aliasNorm) ?? 0) + 1;
                occurrences.set(member.aliasNorm, occurrence);

                return resolveAlias(member, occurrence, directory);
            })
        );

    return lineup.teams.flatMap(({ ordinal, members }) => {
        const rows: EntryRow[] = [];

        for (const member of members) {
            for (const resolved of Option.toArray(resolve(member))) {
                const override = takeManual(manual, member.raw, ordinal, rows.length + 1);

                for (const entry of entriesOfMember(member, resolved, override)) {
                    rows.push({ ...entry, sessionId, messageId: lineup.messageId, teamOrdinal: ordinal, position: rows.length + 1 });
                }
            }
        }

        return rows;
    });
};
