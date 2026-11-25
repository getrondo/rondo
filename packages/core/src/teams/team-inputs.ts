import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { person, telegramAccount } from '@rondo/db/schema/identity.schema';
import { community, playerProfile } from '@rondo/db/schema/org.schema';
import { pairRule, rating, team, teamColor, teamMember } from '@rondo/db/schema/play.schema';
import { session, signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, asc, desc, eq, inArray, lt, ne } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

import { primaryAccount } from '../identity/primary-account';
import { requireSession } from '../sessions/session.service';

import { badgeOfRow } from './badges';
import { habitsOf } from './habits';
import { unknownRating } from './rate-result';

import type { BadgeColour } from './interface/badge.interface';
import type { SolverPlayer } from './interface/solver.interface';
import type { TeamInputs, TeamMember, TeamSettings, Tier } from './interface/team-inputs.interface';

const seededSigma = 5;
const tierLevels: Readonly<Record<Tier, number>> = { new: 3, normal: 5, strong: 8 };

export const tierLevel = (tier: Tier): number => tierLevels[tier];

const tierOfLevel = (level: number): Tier => {
    if (level <= tierLevels.new) {
        return 'new';
    }

    return level >= 7 ? 'strong' : 'normal';
};

const SettingsSchema = Schema.Struct({
    teams: Schema.optional(Schema.Struct({ leadMinutes: Schema.optional(Schema.Int), showHandles: Schema.optional(Schema.Boolean) }))
});
const decodeSettings = Schema.decodeUnknownOption(SettingsSchema);

export const teamSettingsOf = Effect.fn('Core.teamSettingsOf')(function* (communityId: string) {
    const db = yield* Db;
    const [row] = yield* db.select({ settings: community.settings }).from(community).where(eq(community.id, communityId));
    const teams = decodeSettings(row?.settings).pipe(Option.flatMap(settings => Option.fromNullishOr(settings.teams)));

    return {
        leadMinutes: Option.match(teams, { onNone: () => 60, onSome: value => value.leadMinutes ?? 60 }),
        showHandles: Option.match(teams, { onNone: () => false, onSome: value => value.showHandles ?? false })
    } satisfies TeamSettings;
});

export const membersOf = Effect.fn('Core.membersOf')(function* (sessionId: string, activityId: string) {
    const db = yield* Db;
    const account = primaryAccount(db);
    const rows = yield* db
        .select({
            personId: signup.personId,
            displayName: person.displayName,
            isGuest: signup.isGuest,
            hostId: signup.guestOfPersonId,
            role: signup.role,
            tgUserId: account.tgUserId,
            username: telegramAccount.username
        })
        .from(signup)
        .innerJoin(person, eq(person.id, signup.personId))
        .leftJoin(account, eq(account.personId, signup.personId))
        .leftJoin(telegramAccount, eq(telegramAccount.tgUserId, account.tgUserId))
        .where(and(eq(signup.sessionId, sessionId), eq(signup.status, 'in')))
        .orderBy(asc(signup.createdAt), asc(signup.personId));
    const ratings = isNotEmptyArray(rows)
        ? yield* db
              .select()
              .from(rating)
              .where(
                  and(
                      eq(rating.activityId, activityId),
                      inArray(
                          rating.personId,
                          rows.map(row => row.personId)
                      )
                  )
              )
        : [];
    const seedOf = new Map(ratings.filter(row => row.model === 'organizer_seed').map(row => [row.personId, row.mu]));
    const learned = new Map(ratings.filter(row => row.model === 'openskill_pl').map(row => [row.personId, row]));
    const members = rows.map((row): TeamMember => {
        const seed = seedOf.get(row.personId);

        return {
            personId: row.personId,
            displayName: row.displayName,
            isGuest: row.isGuest,
            hostId: row.hostId,
            isGk: row.role === 'gk',
            tgUserId: row.tgUserId ?? null,
            username: row.username ?? null,
            tier: isDefined(seed) ? tierOfLevel(seed) : null
        };
    });
    const strengthOf = (personId: string) => {
        const known = learned.get(personId);
        const seed = seedOf.get(personId);

        if (isDefined(known)) {
            return { mu: known.mu, sigma: known.sigma };
        }

        return isDefined(seed) ? { mu: unknownRating.mu + 2 * (seed - tierLevels.normal), sigma: seededSigma } : unknownRating;
    };

    return { members, strengthOf, hasLevels: seedOf.size + learned.size > 0 };
});

const historyRows = Effect.fn('Core.historyRows')(function* (communityId: string, before: string) {
    const db = yield* Db;

    return yield* db
        .select({ game: teamMember.sessionId, date: session.localDate, team: team.ordinal, player: teamMember.personId })
        .from(teamMember)
        .innerJoin(team, eq(team.id, teamMember.teamId))
        .innerJoin(session, eq(session.id, teamMember.sessionId))
        .where(and(eq(session.communityId, communityId), lt(session.localDate, before), ne(session.status, 'cancelled')));
});

const lastColoursAt = Effect.fn('Core.lastColoursAt')(function* (communityId: string, venueId: string | null, before: string) {
    const db = yield* Db;
    const venue = isDefined(venueId) ? [eq(session.venueId, venueId)] : [];
    const rows = yield* db
        .select({ sessionId: team.sessionId, emoji: teamColor.emoji, name: teamColor.name })
        .from(team)
        .innerJoin(session, eq(session.id, team.sessionId))
        .innerJoin(teamColor, eq(teamColor.id, team.colorId))
        .where(and(eq(session.communityId, communityId), lt(session.localDate, before), ...venue))
        .orderBy(desc(session.localDate), asc(team.ordinal))
        .limit(12);
    const latest = rows.filter(row => row.sessionId === rows[0]?.sessionId);

    return latest.flatMap((row): BadgeColour[] => Option.toArray(Option.fromNullishOr(badgeOfRow(row)?.colour)));
});

export const loadTeamInputs = Effect.fn('Core.loadTeamInputs')(function* (communityId: string, sessionId: string) {
    const db = yield* Db;
    const game = yield* requireSession(communityId, sessionId);
    const [activity] = yield* db.select({ activityId: session.activityId }).from(session).where(eq(session.id, sessionId));
    const activityId = activity?.activityId ?? '';
    const { members, strengthOf, hasLevels } = yield* membersOf(sessionId, activityId);
    const ids = members.map(member => member.personId);
    const among = new Set(ids);
    const roles = isNotEmptyArray(ids)
        ? yield* db
              .select({ personId: playerProfile.personId, positions: playerProfile.positions })
              .from(playerProfile)
              .where(and(eq(playerProfile.activityId, activityId), inArray(playerProfile.personId, ids)))
        : [];
    const pairs = isNotEmptyArray(ids)
        ? yield* db
              .select()
              .from(pairRule)
              .where(and(eq(pairRule.communityId, communityId), inArray(pairRule.personId, ids), inArray(pairRule.otherPersonId, ids)))
        : [];
    const history = yield* historyRows(communityId, game.localDate);
    const { habits, recent, short } = habitsOf(history, game.localDate, among);
    const players = members.map((member): SolverPlayer => {
        const { mu, sigma } = strengthOf(member.personId);
        const positions = roles.find(row => row.personId === member.personId)?.positions ?? [];

        return {
            id: member.personId,
            strength: mu,
            uncertainty: sigma,
            isGk: member.isGk,
            roles: [
                ...positions.filter(position => position !== 'any' && position !== 'gk').slice(0, 1),
                ...(member.tier === 'new' ? ['new'] : [])
            ],
            hostId: member.hostId,
            shortScore: short.get(member.personId) ?? 0
        };
    });
    const pairOf = (row: (typeof pairs)[number]): [string, string] => [row.personId, row.otherPersonId];
    const lastColours = yield* lastColoursAt(communityId, game.venueId, game.localDate);
    const settings = yield* teamSettingsOf(communityId);

    return {
        game,
        members,
        players,
        habits,
        recent,
        together: pairs.filter(row => row.kind === 'together').map(row => pairOf(row)),
        apart: pairs.filter(row => row.kind === 'apart').map(row => pairOf(row)),
        hasLevels,
        lastColours,
        settings
    } satisfies TeamInputs;
});

export const personNames = Effect.fn('Core.personNames')(function* (personIds: readonly string[]) {
    const db = yield* Db;
    const rows = isNotEmptyArray(personIds)
        ? yield* db
              .select({ personId: person.id, name: person.displayName })
              .from(person)
              .where(inArray(person.id, [...personIds]))
        : [];

    return new Map(rows.map(row => [row.personId, row.name]));
});
