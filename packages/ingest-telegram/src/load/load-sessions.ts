import { isDefined } from '@rnw-community/shared';
import { lineupEntry, team, teamMember } from '@rondo/db/schema/play.schema';
import { session } from '@rondo/db/schema/scheduling.schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { postIdIn, sourceOf } from '../extract/post-id';
import { markShared } from '../identity/mark-shared';
import { entriesOf } from '../roster/entries-of';
import { syncSessionRoster } from '../roster/sync-session-roster';
import { chunks } from '../utils/chunks.util';
import { insertMany } from '../utils/insert-many.util';
import { lookupId } from '../utils/lookup-id.util';

import { deleteStaleSessions } from './delete-stale-sessions';
import { liveMessages } from './live-messages';
import { mainChatId } from './main-chat-id';
import { existingSessions, matchOf, matchSessions } from './match-sessions';
import { sessionMillis, startOf } from './start-of';

import type { LineupFact } from '../extract/fact.model';
import type { Directory, EntryRow } from '../interface/directory.interface';
import type { LoadContext, ReferenceIds, SessionLoadResult } from '../interface/load-context.interface';

const unassignedTeam = 0;

type LiveMessages = Effect.Success<ReturnType<typeof liveMessages>>;

const gameKey = ({ startsAt, activityId }: { readonly startsAt: Date; readonly activityId: string }): string =>
    `${startsAt.getTime()}|${activityId}`;

const upsertSessionRows = Effect.fn('IngestTelegram.upsertSessionRows')(function* (
    context: LoadContext,
    reference: ReferenceIds,
    live: LiveMessages
) {
    const { transaction, communityId, config, plan } = context;
    const existing = yield* existingSessions(context, live);
    const liveSessionIds = new Set(live.map(({ sessionId }) => sessionId));
    const matched = matchSessions(
        plan.sessions.map(item => ({
            key: `${item.localDate}|${reference.activityIdBySport.get(item.sport)}`,
            ...matchOf(item, config)
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
                endsAt: new Date(startsAt.getTime() + sessionMillis),
                status: item.status,
                capacityMax: item.capacityMax,
                fieldsPlanned: item.fieldsPlanned,
                format: item.format,
                cancelReason: item.cancelReason,
                reviewReason: item.reviewReason ?? null,
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
                    reviewReason: sql`excluded.review_reason`,
                    title: sql`excluded.title`,
                    confidence: sql`excluded.confidence`
                }
            })
            .returning({ id: session.id, startsAt: session.startsAt, activityId: session.activityId });

        for (const row of rows) {
            idByKey.set(gameKey(row), row.id);
        }
    }

    const sessionIds = planned.map(({ row }) => row.id ?? idByKey.get(gameKey(row)) ?? '');

    return { sessionIds, ambiguousDates: existing.ambiguousDates };
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
    const { otherChats } = context.config;
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

    const chats = { mainChatId: yield* mainChatId(context.config), otherChats };
    const manual = previous
        .filter(entry => entry.resolvedBy === 'manual')
        .map(entry =>
            Object.assign(entry, {
                messageId: Option.getOrElse(
                    postIdIn(chats, { chatId: entry.chatId ?? null, messageId: entry.messageId }),
                    () => entry.messageId
                )
            })
        );
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

    const rows = [...entries, ...requests.entries].map(entry => Object.assign(entry, sourceOf(otherChats, entry.messageId)));

    yield* insertMany(rows, batch => transaction.insert(lineupEntry).values(batch));
    yield* markShared(context.communityId);
    yield* syncSessionRoster([...new Set([...previous, ...entries].filter(entry => entry.teamOrdinal > 0).map(entry => entry.sessionId))]);

    return { entries: entries.length, unassigned: requests.unassigned };
});

export const loadSessions = Effect.fn('IngestTelegram.loadSessions')(function* (
    context: LoadContext,
    reference: ReferenceIds,
    directory: Directory
) {
    const live = yield* liveMessages(context.config);
    const liveSessionIds = new Set(live.map(({ sessionId }) => sessionId));
    const lineups = live.filter(({ isLineup }) => isLineup);
    const liveLineups = new Set(lineups.map(({ sessionId }) => sessionId));
    const published = yield* context.transaction
        .selectDistinct({ sessionId: teamMember.sessionId })
        .from(teamMember)
        .innerJoin(session, eq(session.id, teamMember.sessionId))
        .where(and(eq(session.communityId, context.communityId), eq(teamMember.assignedBy, 'balancer')));
    const isMainPost = (messageId: number): boolean => !isDefined(sourceOf(context.config.otherChats, messageId).chatId);
    const stored = lineups.filter(({ isStored }) => isStored);
    const storedLineups = new Set([...stored.filter(({ isOtherChat }) => !isOtherChat), ...published].map(({ sessionId }) => sessionId));
    const otherLineups = new Set(stored.map(({ sessionId }) => sessionId));
    const { sessionIds, ambiguousDates } = yield* upsertSessionRows(context, reference, live);

    const planned = context.plan.sessions
        .map(({ lineup, pollMessageIds }, index) => ({ sessionId: sessionIds[index] ?? '', lineup, pollMessageIds }))
        .filter(({ sessionId, lineup }) => !storedLineups.has(sessionId) && (isDefined(lineup) || !liveLineups.has(sessionId)))
        .filter(({ sessionId, lineup }) => !otherLineups.has(sessionId) || (isDefined(lineup) && isMainPost(lineup.messageId)));
    const manual = yield* context.transaction
        .selectDistinct({ sessionId: lineupEntry.sessionId })
        .from(lineupEntry)
        .innerJoin(session, eq(session.id, lineupEntry.sessionId))
        .where(and(eq(session.communityId, context.communityId), eq(lineupEntry.resolvedBy, 'manual')));
    const manualSessionIds = new Set(manual.map(({ sessionId }) => sessionId));
    const games = planned.filter(({ sessionId, lineup }) => isDefined(lineup) || !manualSessionIds.has(sessionId));
    const withoutSquad = games.filter(({ lineup }) => !isDefined(lineup)).map(({ sessionId }) => sessionId);

    yield* deleteStaleSessions(context, new Set([...sessionIds, ...liveSessionIds]), new Set(withoutSquad));

    const teams = yield* upsertTeams(context, reference, games);
    const { entries, unassigned } = yield* replaceEntries(context, directory, games);

    return { sessionIds, ambiguousDates, teams, entries, unassignedGuestRequests: unassigned } satisfies SessionLoadResult;
});
