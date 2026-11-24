import { isDefined, isEmptyArray, isNotEmptyArray } from '@rnw-community/shared';
import { person, personAlias, telegramAuthor } from '@rondo/db/schema/identity.schema';
import { messageRef } from '@rondo/db/schema/platform.schema';
import { team, teamColor, teamMember } from '@rondo/db/schema/play.schema';
import { attendance, session } from '@rondo/db/schema/scheduling.schema';
import { venue } from '@rondo/db/schema/venue.schema';
import { Db } from '@rondo/db/service/db.service';
import { extractLineup } from '@rondo/ingest-telegram/extract/extract-lineup';
import { extractPoll, makeVenueMatcher } from '@rondo/ingest-telegram/extract/extract-poll';
import { extractCancellation } from '@rondo/ingest-telegram/extract/extract-signals';
import { and, eq, ne, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { todayIn } from '../sessions/local-time';
import { cancelSession, createSession, listSessions } from '../sessions/session.service';
import { closePollsOf } from '../signups/signup.service';

import type { SessionView } from '../sessions/session.model';
import type { CommunityConfig } from '@rondo/ingest-telegram/config/community-config';
import type { LineupFact, PollFact } from '@rondo/ingest-telegram/extract/fact.model';
import type { TelegramMessage } from '@rondo/ingest-telegram/model/telegram-message.model';

export interface GroupMessage {
    readonly chatId: bigint;
    readonly messageId: number;
    readonly sentAt: Date;
    readonly senderPersonId: string;
    readonly senderTgUserId: bigint;
    readonly senderName: string;
    readonly senderIsAdmin: boolean;
    readonly text?: string;
    readonly poll?: { readonly question: string; readonly answers: readonly string[] };
}

interface LiveIngestResult {
    readonly poll: boolean;
    readonly lineup: boolean;
    readonly cancellation: boolean;
}

const recordAuthor = Effect.fn('Core.recordAuthor')(function* (communityId: string, message: GroupMessage) {
    const db = yield* Db;

    yield* db
        .insert(telegramAuthor)
        .values({
            communityId,
            displayName: message.senderName,
            tgUserId: message.senderTgUserId,
            personId: message.senderPersonId,
            messageCount: 1,
            firstSeenAt: message.sentAt,
            lastSeenAt: message.sentAt
        })
        .onConflictDoUpdate({
            target: [telegramAuthor.communityId, telegramAuthor.displayName],
            set: {
                tgUserId: sql`coalesce(${telegramAuthor.tgUserId}, excluded.tg_user_id)`,
                personId: sql`coalesce(${telegramAuthor.personId}, excluded.person_id)`,
                messageCount: sql`${telegramAuthor.messageCount} + 1`,
                lastSeenAt: sql`excluded.last_seen_at`
            }
        });
});

const venueIdFor = Effect.fn('Core.venueIdFor')(function* (communityId: string, config: CommunityConfig, venueKey: string | undefined) {
    const db = yield* Db;
    const name = config.venues.find(entry => entry.key === venueKey)?.name;

    if (!isDefined(name)) {
        return null;
    }

    const [row] = yield* db
        .select({ id: venue.id })
        .from(venue)
        .where(and(eq(venue.communityId, communityId), eq(venue.name, name)));

    return row?.id ?? null;
});

const gameMinutes = 90;

const minutesOf = (time: string): number => {
    const [hour = 0, minute = 0] = time.split(':').map(Number);

    return hour * 60 + minute;
};

const minutesApart = (left: string, right: string): number => Math.abs(minutesOf(left) - minutesOf(right));

const rescheduleSignal = /перенос|перенес/iu;

const gamesOn = Effect.fn('Core.gamesOn')(function* (communityId: string, localDate: string) {
    const sessions = yield* listSessions(communityId, { from: localDate, to: localDate });

    return sessions.filter(({ sport, status }) => sport === 'football' && status !== 'cancelled');
});

const ensureSession = Effect.fn('Core.ensureSession')(function* (
    communityId: string,
    config: CommunityConfig,
    fact: Pick<PollFact, 'localDate' | 'localTime' | 'venueKey'> & { readonly capacityMax?: number; readonly title?: string }
) {
    const venueId = yield* venueIdFor(communityId, config, fact.venueKey);
    const countConflicts = (game: SessionView): number =>
        Number(isDefined(venueId) && isDefined(game.venueId) && venueId !== game.venueId) +
        Number(isDefined(fact.localTime) && fact.localTime !== game.localTime);
    const isOtherGame = (game: SessionView): boolean =>
        countConflicts(game) > 1 || (isDefined(fact.localTime) && minutesApart(fact.localTime, game.localTime) >= gameMinutes);
    const possible = (yield* gamesOn(communityId, fact.localDate)).filter(game => !isOtherGame(game));
    const exact = possible.filter(game => countConflicts(game) === 0);
    const [match, ...others] = isNotEmptyArray(exact) ? exact : possible;

    if (isNotEmptyArray(others)) {
        yield* Effect.logWarning('[group] several games match, message skipped');

        return Option.none<string>();
    }

    if (isDefined(match)) {
        return Option.fromNullishOr(match.id);
    }

    const created = yield* createSession({
        communityId,
        timezone: config.timeZone,
        localDate: fact.localDate,
        localTime: fact.localTime ?? '19:00',
        venueId,
        capacityMax: fact.capacityMax ?? null,
        title: fact.title ?? null,
        actorPersonId: null
    });

    return Option.fromNullishOr(created);
});

const rememberMessage = Effect.fn('Core.rememberMessage')(function* (message: GroupMessage, purpose: 'poll' | 'lineup', sessionId: string) {
    const db = yield* Db;

    yield* db
        .insert(messageRef)
        .values({ chatId: message.chatId, messageId: message.messageId, purpose, entityType: 'session', entityId: sessionId })
        .onConflictDoNothing();
});

const personForAlias = Effect.fn('Core.personForAlias')(function* (
    communityId: string,
    member: LineupFact['teams'][number]['members'][number],
    message: GroupMessage
) {
    const db = yield* Db;

    if (member.isSelf) {
        return message.senderPersonId;
    }

    const [known] = yield* db
        .update(personAlias)
        .set({ occurrences: sql`${personAlias.occurrences} + 1`, lastSeenAt: message.sentAt })
        .where(and(eq(personAlias.communityId, communityId), eq(personAlias.aliasNorm, member.aliasNorm)))
        .returning({ personId: personAlias.personId });

    if (isDefined(known?.personId)) {
        return known.personId;
    }

    const [created] = yield* db.insert(person).values({ displayName: member.alias, source: 'bot' }).returning({ id: person.id });
    const personId = created?.id ?? '';
    yield* db
        .insert(personAlias)
        .values({
            communityId,
            personId,
            alias: member.alias,
            aliasNorm: member.aliasNorm,
            occurrences: 1,
            firstSeenAt: message.sentAt,
            lastSeenAt: message.sentAt
        })
        .onConflictDoUpdate({ target: [personAlias.communityId, personAlias.aliasNorm], set: { personId } });

    return personId;
});

const applyLineup = Effect.fn('Core.applyLineup')(function* (
    communityId: string,
    config: CommunityConfig,
    fact: LineupFact,
    message: GroupMessage
) {
    const db = yield* Db;
    const found = yield* ensureSession(communityId, config, fact);

    if (Option.isNone(found)) {
        return;
    }

    const sessionId = found.value;
    const colors = yield* db.select().from(teamColor).where(eq(teamColor.communityId, communityId));

    yield* db.delete(team).where(eq(team.sessionId, sessionId));
    yield* db.delete(attendance).where(and(eq(attendance.sessionId, sessionId), eq(attendance.source, 'bot')));

    for (const lineupTeam of fact.teams) {
        const [stored] = yield* db
            .insert(team)
            .values({
                sessionId,
                ordinal: lineupTeam.ordinal,
                colorId: colors.find(color => color.emoji === lineupTeam.emoji)?.id,
                publishedAt: message.sentAt
            })
            .returning({ id: team.id });

        for (const member of lineupTeam.members) {
            const personId = yield* personForAlias(communityId, member, message);
            yield* db
                .insert(teamMember)
                .values({
                    teamId: stored?.id ?? '',
                    sessionId,
                    personId,
                    isGk: member.isGk,
                    isNewcomer: member.isNewcomer,
                    assignedBy: 'organizer'
                })
                .onConflictDoNothing();
            yield* db.insert(attendance).values({ sessionId, personId, outcome: 'attended', source: 'bot' }).onConflictDoNothing();
        }
    }

    const status = fact.localDate < todayIn(config.timeZone, message.sentAt) ? 'played' : 'locked';
    yield* db
        .update(session)
        .set({ status })
        .where(and(eq(session.id, sessionId), ne(session.status, 'played')));
    yield* rememberMessage(message, 'lineup', sessionId);
});

export const ingestGroupMessage = Effect.fn('Core.ingestGroupMessage')(function* (
    communityId: string,
    config: CommunityConfig,
    message: GroupMessage
) {
    const db = yield* Db;
    yield* recordAuthor(communityId, message);

    const telegramMessage: TelegramMessage = {
        id: message.messageId,
        kind: 'message',
        sentAt: message.sentAt,
        author: message.senderName,
        text: message.text,
        poll: message.poll,
        media: []
    };
    if (!message.senderIsAdmin) {
        return { poll: false, lineup: false, cancellation: false } satisfies LiveIngestResult;
    }

    const venueOf = makeVenueMatcher(config);
    const poll = Option.fromNullishOr(extractPoll(telegramMessage, config, venueOf)).pipe(
        Option.filter(fact => !fact.isReserve && !fact.isChoice && fact.sport === 'football')
    );
    const lineup = Option.fromNullishOr(extractLineup(telegramMessage, config, venueOf));
    const cancellation = Option.fromNullishOr(extractCancellation(telegramMessage, config, new Set([message.senderName]))).pipe(
        Option.filter(() => !rescheduleSignal.test(message.text ?? ''))
    );

    if (Option.isSome(poll)) {
        const sessionId = yield* ensureSession(communityId, config, poll.value);

        if (Option.isSome(sessionId)) {
            yield* rememberMessage(message, 'poll', sessionId.value);
        }
    }

    if (Option.isSome(lineup)) {
        yield* db.transaction(() => applyLineup(communityId, config, lineup.value, message));
    }

    if (Option.isSome(cancellation)) {
        const [target, ...others] = yield* gamesOn(communityId, cancellation.value.localDate);

        if (isDefined(target) && isEmptyArray(others) && target.status !== 'played') {
            yield* cancelSession(target, cancellation.value.reason, message.senderPersonId);
            yield* closePollsOf(target.id);
        }
    }

    return {
        poll: Option.isSome(poll),
        lineup: Option.isSome(lineup),
        cancellation: Option.isSome(cancellation)
    } satisfies LiveIngestResult;
});
