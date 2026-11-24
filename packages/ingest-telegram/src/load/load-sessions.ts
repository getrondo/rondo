import { isDefined } from '@rnw-community/shared';
import { team, teamMember } from '@rondo/db/schema/play.schema';
import { attendance, session } from '@rondo/db/schema/scheduling.schema';
import * as Effect from 'effect/Effect';

import { zonedToInstant } from '../extract/zoned-time';
import { chunks } from '../utils/chunks.util';
import { insertMany } from '../utils/insert-many.util';
import { lookupId } from '../utils/lookup-id.util';

import type { PlannedSession } from '../extract/assemble-plan';
import type { LoadContext, ReferenceIds, SessionLoadResult } from '../interface/load-context.interface';

const sessionMinutes = 90;

const startOf = (planned: PlannedSession, timeZone: string): Date => {
    const [year = 0, month = 1, day = 1] = planned.localDate.split('-').map(Number);
    const [hour = 19, minute = 0] = planned.localTime.split(':').map(Number);

    return zonedToInstant({ year, month, day, hour, minute }, timeZone);
};

const insertSessionRows = Effect.fn('IngestTelegram.insertSessionRows')(function* (
    { transaction, communityId, config, plan }: LoadContext,
    reference: ReferenceIds
) {
    const sessionIds: string[] = [];

    for (const batch of chunks(plan.sessions)) {
        const rows = yield* transaction
            .insert(session)
            .values(
                batch.map(planned => {
                    const startsAt = startOf(planned, config.timeZone);

                    return {
                        communityId,
                        activityId: reference.activityIdBySport.get(planned.sport) ?? '',
                        venueId: lookupId(reference.venueIdByKey, planned.venueKey),
                        localDate: planned.localDate,
                        startsAt,
                        endsAt: new Date(startsAt.getTime() + sessionMinutes * 60_000),
                        status: planned.status,
                        capacityMax: planned.capacityMax,
                        fieldsPlanned: planned.fieldsPlanned,
                        format: planned.format,
                        cancelReason: planned.cancelReason,
                        title: planned.title,
                        source: 'import' as const,
                        confidence: planned.confidence
                    };
                })
            )
            .returning({ id: session.id });
        sessionIds.push(...rows.map(row => row.id));
    }

    return sessionIds;
});

const insertTeams = Effect.fn('IngestTelegram.insertTeams')(function* (
    { transaction, plan }: LoadContext,
    reference: ReferenceIds,
    sessionIds: readonly string[]
) {
    const withLineups = plan.sessions.flatMap((planned, index) =>
        isDefined(planned.lineup) ? [{ lineup: planned.lineup, sessionId: sessionIds[index] ?? '' }] : []
    );
    const teamRows = withLineups.flatMap(({ lineup, sessionId }) =>
        lineup.teams.map(lineupTeam => ({
            sessionId,
            ordinal: lineupTeam.ordinal,
            colorId: reference.colorIdByEmoji.get(lineupTeam.emoji),
            members: lineupTeam.members
        }))
    );
    const teamIds: string[] = [];

    for (const batch of chunks(teamRows)) {
        const rows = yield* transaction
            .insert(team)
            .values(batch.map(({ sessionId, ordinal, colorId }) => ({ sessionId, ordinal, colorId })))
            .returning({ id: team.id });
        teamIds.push(...rows.map(row => row.id));
    }

    return { teamRows, teamIds };
});

export const insertSessions = Effect.fn('IngestTelegram.insertSessions')(function* (
    context: LoadContext,
    reference: ReferenceIds,
    personIdByAlias: ReadonlyMap<string, string>
) {
    const { transaction } = context;
    const sessionIds = yield* insertSessionRows(context, reference);
    const { teamRows, teamIds } = yield* insertTeams(context, reference, sessionIds);
    const seen = new Set<string>();
    const memberRows = teamRows.flatMap((teamRow, index) =>
        teamRow.members.flatMap(member => {
            const personId = personIdByAlias.get(member.aliasNorm);
            const key = `${teamRow.sessionId}|${personId}`;

            if (!isDefined(personId) || seen.has(key)) {
                return [];
            }

            seen.add(key);

            return [
                {
                    teamId: teamIds[index] ?? '',
                    sessionId: teamRow.sessionId,
                    personId,
                    isGk: member.isGk,
                    isNewcomer: member.isNewcomer,
                    assignedBy: 'import' as const
                }
            ];
        })
    );

    yield* insertMany(memberRows, batch => transaction.insert(teamMember).values(batch));
    yield* insertMany(memberRows, batch =>
        transaction.insert(attendance).values(
            batch.map(row => ({
                sessionId: row.sessionId,
                personId: row.personId,
                outcome: 'attended' as const,
                source: 'import' as const
            }))
        )
    );

    return { sessionIds, teams: teamRows.length, members: memberRows.length } satisfies SessionLoadResult;
});
