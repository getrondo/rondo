import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { person } from '@rondo/db/schema/identity.schema';
import { lineupEntry, team, teamColor, teamMember } from '@rondo/db/schema/play.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { formatSessionLabel } from '../i18n/messages';

import { badgeOfColour, badgeOfRow, paddedColours } from './badges';

import type { Locale } from '../i18n/locale';
import type { SessionView } from '../sessions/session.model';
import type { DraftState } from './draft-state';
import type { LineupPost, PostTeam } from './interface/lineup-post.interface';
import type { TeamMember } from './interface/team-inputs.interface';
import type { TeamPlacement } from './lineup-post';

export const postTeamsOf = (state: DraftState, members: readonly TeamMember[]): PostTeam[] => {
    const colours = paddedColours(state.colours, state.teams.length);

    return state.teams.map((personIds, index) => ({
        colour: colours[index] ?? '',
        badge: badgeOfColour(colours[index])?.badge ?? `${index + 1}.`,
        members: personIds.flatMap(personId => {
            const member = members.find(entry => entry.personId === personId);

            return isDefined(member)
                ? [
                      {
                          personId,
                          name: member.displayName,
                          tgUserId: member.tgUserId,
                          username: member.username,
                          isGk: state.keepers.includes(personId),
                          isGuest: member.isGuest,
                          hostId: member.hostId
                      }
                  ]
                : [];
        })
    }));
};

export const postOf = (
    game: SessionView,
    teams: readonly PostTeam[],
    options: { readonly locale: Locale; readonly showHandles: boolean; readonly isUpdate: boolean }
): LineupPost => ({ title: formatSessionLabel(options.locale, game), teams, ...options });

export const placementOf = (teams: readonly PostTeam[]): TeamPlacement[] =>
    teams.flatMap((entry, index) =>
        entry.members.map(member => ({ personId: member.personId, name: member.name, badge: entry.badge, team: index + 1 }))
    );

export const publishedPlacement = Effect.fn('Core.publishedPlacement')(function* (sessionId: string) {
    const db = yield* Db;
    const rows = yield* db
        .select({
            personId: teamMember.personId,
            name: person.displayName,
            ordinal: team.ordinal,
            emoji: teamColor.emoji,
            colour: teamColor.name
        })
        .from(teamMember)
        .innerJoin(team, eq(team.id, teamMember.teamId))
        .innerJoin(person, eq(person.id, teamMember.personId))
        .leftJoin(teamColor, eq(teamColor.id, team.colorId))
        .where(eq(teamMember.sessionId, sessionId))
        .orderBy(asc(team.ordinal));

    return rows.map((row): TeamPlacement => ({
        personId: row.personId,
        name: row.name,
        badge: badgeOfRow({ emoji: row.emoji, name: row.colour ?? '' })?.badge ?? `${row.ordinal}.`,
        team: row.ordinal
    }));
});

export const squadOf = Effect.fn('Core.squadOf')(function* (sessionId: string) {
    const db = yield* Db;
    const posted = yield* db
        .select({
            ordinal: team.ordinal,
            personId: teamMember.personId,
            isGk: teamMember.isGk,
            isGuest: sql<boolean>`exists (select 1 from scheduling.signup guest where guest.session_id = ${sessionId}::uuid
                and guest.person_id = ${teamMember.personId} and guest.is_guest)`
        })
        .from(teamMember)
        .innerJoin(team, eq(team.id, teamMember.teamId))
        .where(eq(teamMember.sessionId, sessionId));

    if (isNotEmptyArray(posted)) {
        return posted;
    }

    const imported = yield* db
        .select({ ordinal: lineupEntry.teamOrdinal, personId: lineupEntry.personId, isGk: lineupEntry.isGk })
        .from(lineupEntry)
        .where(and(eq(lineupEntry.sessionId, sessionId), gt(lineupEntry.teamOrdinal, 0)));

    // A guest entry never has a person (lineup_entry_player_ck), so only players are left
    return imported.flatMap(row => (isDefined(row.personId) ? [{ ...row, personId: row.personId, isGuest: false }] : []));
});

export const storedTeams = Effect.fn('Core.storedTeams')(function* (sessionId: string) {
    const db = yield* Db;
    const squad = yield* squadOf(sessionId);
    const rows = yield* db
        .select({ ordinal: team.ordinal, rank: team.rank, emoji: teamColor.emoji, colour: teamColor.name })
        .from(team)
        .leftJoin(teamColor, eq(teamColor.id, team.colorId))
        .where(eq(team.sessionId, sessionId))
        .orderBy(asc(team.ordinal));

    return rows
        .flatMap(row => (squad.some(entry => entry.ordinal === row.ordinal && !entry.isGuest) ? [row] : []))
        .map(row => ({
            ordinal: row.ordinal,
            rank: row.rank,
            badge: badgeOfRow({ emoji: row.emoji, name: row.colour ?? '' })?.badge ?? `${row.ordinal}.`
        }));
});
