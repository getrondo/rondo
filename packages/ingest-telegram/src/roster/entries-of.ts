import { isDefined } from '@rnw-community/shared';
import * as Option from 'effect/Option';

import { normalizeAlias } from '../extract/normalize';
import { resolveAccount, resolveAlias } from '../identity/resolve-member';

import { hostOf } from './host-of';

import type { LineupFact, LineupMember } from '../extract/fact.model';
import type { Directory, EntryRow, ResolvedMember } from '../interface/directory.interface';

type Player = Pick<ResolvedMember, 'personId' | 'aliasId'>;

const guestRows = (host: Player, count: number, raw?: string) =>
    Array.from({ length: count }, (_, index) => ({
        aliasId: host.aliasId,
        guestOfPersonId: host.personId,
        resolvedBy: 'guest' as const,
        isGuest: true,
        raw: index === 0 ? raw : null
    }));

const applyManual = (rows: readonly EntryRow[], manual: readonly EntryRow[]): EntryRow[] => {
    const overrides = new Map<EntryRow, EntryRow>();
    const place = (entry: EntryRow, isTarget: (row: EntryRow) => boolean): void => {
        const row = rows.find(candidate => isTarget(candidate) && !overrides.has(candidate));

        if (isDefined(row)) {
            overrides.set(row, entry);
        }
    };
    const isPlayer = (row: EntryRow, entry: EntryRow): boolean => row.isGuest !== true && row.raw === entry.raw;
    const isSamePlace = (row: EntryRow, entry: EntryRow): boolean =>
        row.teamOrdinal === entry.teamOrdinal && row.position === entry.position;

    for (const entry of manual) {
        place(entry, row => isPlayer(row, entry) && isSamePlace(row, entry));
    }

    for (const entry of manual.filter(candidate => ![...overrides.values()].includes(candidate))) {
        place(entry, row => isPlayer(row, entry));
    }

    return rows.map(row => {
        const override = overrides.get(row);

        return isDefined(override) ? Object.assign(row, { personId: override.personId, resolvedBy: 'manual' as const }) : row;
    });
};

export const entriesOf = (sessionId: string, lineup: LineupFact, directory: Directory, manual: readonly EntryRow[] = []): EntryRow[] => {
    const members = lineup.teams.flatMap(team => team.members);
    const listedAlone = new Set(members.filter(({ guests }) => guests === 0).map(({ aliasNorm }) => aliasNorm));
    const placed = new Set<string>();

    const resolve = (member: LineupMember): Option.Option<ResolvedMember> =>
        resolveAccount(member, lineup.authorId, directory).pipe(Option.orElse(() => resolveAlias(member.aliasNorm, directory)));

    const resolveHost = (host: string): Option.Option<ResolvedMember> =>
        hostOf(host, lineup).pipe(
            Option.flatMap(member => resolve(member)),
            Option.orElse(() => resolveAlias(normalizeAlias(host), directory))
        );

    const playerRow = (member: LineupMember, player: ResolvedMember) => {
        const isRepeated = isDefined(player.personId) && placed.has(player.personId);

        if (isDefined(player.personId)) {
            placed.add(player.personId);
        }

        return {
            ...player,
            ...(isRepeated ? { personId: null, resolvedBy: 'guest' as const } : {}),
            raw: member.raw,
            isGk: member.isGk,
            isNewcomer: member.isNewcomer
        };
    };

    const rowsOf = (member: LineupMember) => {
        const { guest } = member;

        if (isDefined(guest)) {
            const host = Option.fromNullishOr(guest.host).pipe(
                Option.flatMap(name => resolveHost(name)),
                Option.getOrElse((): Player => ({ personId: null }))
            );

            return guestRows(host, guest.count, member.raw);
        }

        return resolve(member).pipe(Option.toArray, items =>
            items.flatMap(player =>
                member.guests > 0 && listedAlone.has(member.aliasNorm)
                    ? guestRows(player, member.guests, member.raw)
                    : [playerRow(member, player), ...guestRows(player, member.guests)]
            )
        );
    };

    const rows = lineup.teams.flatMap(({ ordinal, members: teamMembers }) =>
        teamMembers
            .flatMap(member => rowsOf(member))
            .map((row, index): EntryRow =>
                Object.assign(row, {
                    sessionId,
                    messageId: lineup.messageId,
                    teamOrdinal: ordinal,
                    position: index + 1
                })
            )
    );

    return applyManual(rows, manual);
};
