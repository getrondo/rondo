import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { extraction, sourceRef } from '@rondo/db/schema/platform.schema';
import { lineupEntry, team } from '@rondo/db/schema/play.schema';
import { attendance, session, sessionChange, signup } from '@rondo/db/schema/scheduling.schema';
import { and, eq, inArray, notExists, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { zonedToInstant } from '../extract/zoned-time';
import { markShared } from '../identity/mark-shared';
import { entriesOf } from '../roster/entries-of';
import { syncSessionRoster } from '../roster/sync-session-roster';
import { chunks } from '../utils/chunks.util';
import { insertMany } from '../utils/insert-many.util';
import { lookupId } from '../utils/lookup-id.util';

import { liveMessages } from './live-messages';
import { sessionEntity } from './load-provenance';

import type { PlannedSession } from '../extract/assemble-plan';
import type { LineupFact } from '../extract/fact.model';
import type { Directory, EntryRow } from '../interface/directory.interface';
import type { LoadContext, ReferenceIds, SessionLoadResult } from '../interface/load-context.interface';

const sessionMinutes = 90;
const unassignedTeam = 0;

const startOf = (planned: PlannedSession, timeZone: string): Date => {
    const [year = 0, month = 1, day = 1] = planned.localDate.split('-').map(Number);
    const [hour = 19, minute = 0] = planned.localTime.split(':').map(Number);

    return zonedToInstant({ year, month, day, hour, minute }, timeZone);
};

const existingSessions = Effect.fn('IngestTelegram.existingSessions')(function* ({ transaction, communityId }: LoadContext) {
    const rows = yield* transaction
        .select({ id: session.id, localDate: session.localDate, activityId: session.activityId, source: session.source })
        .from(session)
        .where(eq(session.communityId, communityId));
    const references = yield* transaction
        .select({ messageId: sourceRef.messageId, sessionId: extraction.entityId })
        .from(sourceRef)
        .innerJoin(extraction, eq(extraction.sourceRefId, sourceRef.id))
        .where(and(eq(sourceRef.communityId, communityId), eq(extraction.entityType, sessionEntity)));
    const changed = yield* transaction
        .select({ id: sessionChange.sessionId })
        .from(sessionChange)
        .innerJoin(session, eq(session.id, sessionChange.sessionId))
        .where(eq(session.communityId, communityId));
    const rowById = new Map(rows.map(row => [row.id, row]));
    const byDay = new Map<string, typeof rows>();

    for (const row of rows) {
        const key = `${row.localDate}|${row.activityId}`;
        byDay.set(key, [...(byDay.get(key) ?? []), row]);
    }

    return {
        edited: new Set(changed.map(({ id }) => id)),
        byMessage: new Map(references.map(({ messageId, sessionId }) => [messageId, rowById.get(sessionId)])),
        byDay
    };
});

type Existing = Effect.Success<ReturnType<typeof existingSessions>>;

const matchSessions = (
    planned: readonly { readonly key: string; readonly messageIds: readonly number[] }[],
    { byMessage, byDay, edited }: Existing
) => {
    const used = new Set<string>();
    const take = <Row extends { readonly id: string }>(candidates: readonly (Row | null | undefined)[]): Row | null => {
        const free = candidates.find(row => isDefined(row) && !used.has(row.id)) ?? null;
        used.add(free?.id ?? '');

        return free;
    };
    const sameMessage = planned.map(({ messageIds }) => take(messageIds.map(id => byMessage.get(id))));

    return planned.map(({ key }, index) => {
        const sameDay = (byDay.get(key) ?? []).filter(({ id }) => !edited.has(id));
        const [only, ...others] = sameDay;
        const imported = sameDay.filter(row => row.source === 'import');

        return sameMessage[index] ?? take(isNotEmptyArray(imported) || isNotEmptyArray(others) ? imported : [only]);
    });
};

const upsertSessionRows = Effect.fn('IngestTelegram.upsertSessionRows')(function* (
    context: LoadContext,
    reference: ReferenceIds,
    liveSessionIds: ReadonlySet<string>
) {
    const { transaction, communityId, config, plan } = context;
    const existing = yield* existingSessions(context);
    const matched = matchSessions(
        plan.sessions.map(item => ({
            key: `${item.localDate}|${reference.activityIdBySport.get(item.sport)}`,
            messageIds: [...item.pollMessageIds, ...(isDefined(item.lineup) ? [item.lineup.messageId] : [])]
        })),
        existing
    );
    const planned = plan.sessions.map((item, index) => {
        const startsAt = startOf(item, config.timeZone);
        const activityId = reference.activityIdBySport.get(item.sport) ?? '';
        const found = matched[index];

        return {
            keep: isDefined(found) && (found.source !== 'import' || liveSessionIds.has(found.id) || existing.edited.has(found.id)),
            row: {
                id: found?.id,
                communityId,
                activityId,
                venueId: lookupId(reference.venueIdByKey, item.venueKey) ?? null,
                localDate: item.localDate,
                startsAt,
                endsAt: new Date(startsAt.getTime() + sessionMinutes * 60_000),
                status: item.status,
                capacityMax: item.capacityMax,
                fieldsPlanned: item.fieldsPlanned,
                format: item.format,
                cancelReason: item.cancelReason,
                title: item.title,
                source: 'import' as const,
                confidence: item.confidence
            }
        };
    });
    const idByKey = new Map<string, string>();

    for (const batch of chunks(planned.filter(({ keep }) => !keep))) {
        const rows = yield* transaction
            .insert(session)
            .values(batch.map(({ row }) => row))
            .onConflictDoUpdate({
                target: session.id,
                set: {
                    localDate: sql`excluded.local_date`,
                    activityId: sql`excluded.activity_id`,
                    venueId: sql`coalesce(excluded.venue_id, ${session.venueId})`,
                    startsAt: sql`excluded.starts_at`,
                    endsAt: sql`excluded.ends_at`,
                    status: sql`excluded.status`,
                    capacityMax: sql`excluded.capacity_max`,
                    fieldsPlanned: sql`excluded.fields_planned`,
                    format: sql`excluded.format`,
                    cancelReason: sql`excluded.cancel_reason`,
                    title: sql`excluded.title`,
                    confidence: sql`excluded.confidence`
                }
            })
            .returning({ id: session.id, localDate: session.localDate, activityId: session.activityId });

        for (const row of rows) {
            idByKey.set(`${row.localDate}|${row.activityId}`, row.id);
        }
    }

    return planned.map(({ row }) => row.id ?? idByKey.get(`${row.localDate}|${row.activityId}`) ?? '');
});

const deleteStaleSessions = Effect.fn('IngestTelegram.deleteStaleSessions')(function* (
    { transaction, communityId }: LoadContext,
    currentIds: ReadonlySet<string>
) {
    const stored = yield* transaction
        .select({ id: session.id })
        .from(session)
        .where(
            and(
                eq(session.communityId, communityId),
                eq(session.source, 'import'),
                notExists(transaction.select().from(sessionChange).where(eq(sessionChange.sessionId, session.id))),
                notExists(transaction.select().from(signup).where(eq(signup.sessionId, session.id))),
                notExists(
                    transaction
                        .select()
                        .from(attendance)
                        .where(and(eq(attendance.sessionId, session.id), eq(attendance.source, 'manual')))
                )
            )
        );
    const stale = stored.map(({ id }) => id).filter(id => !currentIds.has(id));

    if (isNotEmptyArray(stale)) {
        yield* transaction.delete(session).where(inArray(session.id, stale));
    }
});

interface SessionLineup {
    readonly sessionId: string;
    readonly lineup?: LineupFact;
    readonly pollMessageIds: readonly number[];
}

const upsertTeams = Effect.fn('IngestTelegram.upsertTeams')(function* (
    { transaction }: LoadContext,
    reference: ReferenceIds,
    games: readonly SessionLineup[]
) {
    const rows = games.flatMap(({ sessionId, lineup }) =>
        (lineup?.teams ?? []).map(({ ordinal, emoji }) => ({ sessionId, ordinal, colorId: reference.colorIdByEmoji.get(emoji) ?? null }))
    );

    yield* insertMany(games, batch =>
        transaction.execute(
            sql`delete from ${team} where ${team.ordinal} > case ${team.sessionId} ${sql.join(
                batch.map(({ sessionId, lineup }) => sql`when ${sessionId}::uuid then ${lineup?.teams.length ?? 0}::int`),
                sql` `
            )} else 32767 end`
        )
    );
    yield* insertMany(rows, batch =>
        transaction
            .insert(team)
            .values(batch)
            .onConflictDoUpdate({ target: [team.sessionId, team.ordinal], set: { colorId: sql`excluded.color_id` } })
    );

    return rows.length;
});

const guestRequestEntries = ({ plan }: LoadContext, directory: Directory, games: readonly SessionLineup[]) => {
    const gameByPoll = new Map(games.flatMap(game => game.pollMessageIds.map(messageId => [messageId, game] as const)));
    const positions = new Map<string, number>();
    const entries: EntryRow[] = [];
    let unassigned = 0;

    for (const { messageId, userId, replyTo, guests } of plan.facts.guestRequests) {
        const game = gameByPoll.get(replyTo ?? -1);
        const guestOfPersonId = directory.personIdByAccount.get(BigInt(userId));

        if (!isDefined(game) || !isDefined(guestOfPersonId)) {
            unassigned += 1;
        } else if (!isDefined(game.lineup)) {
            const first = positions.get(game.sessionId) ?? 0;
            positions.set(game.sessionId, first + guests);
            entries.push(
                ...Array.from({ length: guests }, (_, index) => ({
                    sessionId: game.sessionId,
                    messageId,
                    teamOrdinal: unassignedTeam,
                    position: first + index + 1,
                    tgUserId: BigInt(userId),
                    isGuest: true,
                    guestOfPersonId,
                    resolvedBy: 'guest' as const
                }))
            );
        }
    }

    return { entries, unassigned };
};

const replaceEntries = Effect.fn('IngestTelegram.replaceEntries')(function* (
    context: LoadContext,
    directory: Directory,
    games: readonly SessionLineup[]
) {
    const { transaction } = context;
    const previous: EntryRow[] = [];

    for (const batch of chunks(games)) {
        previous.push(
            ...(yield* transaction
                .delete(lineupEntry)
                .where(
                    inArray(
                        lineupEntry.sessionId,
                        batch.map(({ sessionId }) => sessionId)
                    )
                )
                .returning())
        );
    }

    const manual = previous.filter(entry => entry.resolvedBy === 'manual');
    const requests = guestRequestEntries(context, directory, games);
    const entries = games.flatMap(({ sessionId, lineup }) =>
        isDefined(lineup)
            ? entriesOf(
                  sessionId,
                  lineup,
                  directory,
                  manual.filter(entry => entry.sessionId === sessionId)
              )
            : []
    );

    yield* insertMany([...entries, ...requests.entries], batch => transaction.insert(lineupEntry).values(batch));
    yield* markShared(context.communityId);
    yield* syncSessionRoster([...new Set([...previous, ...entries].map(entry => entry.sessionId))]);

    return { entries: entries.length, unassigned: requests.unassigned };
});

export const loadSessions = Effect.fn('IngestTelegram.loadSessions')(function* (
    context: LoadContext,
    reference: ReferenceIds,
    directory: Directory
) {
    const live = yield* liveMessages(context.config.slug);
    const liveSessionIds = new Set(live.map(({ sessionId }) => sessionId));
    const liveLineups = new Set(live.filter(({ purpose }) => purpose === 'lineup').map(({ sessionId }) => sessionId));
    const sessionIds = yield* upsertSessionRows(context, reference, liveSessionIds);

    yield* deleteStaleSessions(context, new Set([...sessionIds, ...liveSessionIds]));

    const games = context.plan.sessions
        .map(({ lineup, pollMessageIds }, index) => ({ sessionId: sessionIds[index] ?? '', lineup, pollMessageIds }))
        .filter(({ sessionId }) => !liveLineups.has(sessionId));
    const teams = yield* upsertTeams(context, reference, games);
    const { entries, unassigned } = yield* replaceEntries(context, directory, games);

    return { sessionIds, teams, entries, unassignedGuestRequests: unassigned } satisfies SessionLoadResult;
});
