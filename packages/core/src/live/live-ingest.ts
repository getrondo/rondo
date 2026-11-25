import { isDefined, isEmptyArray, isNotEmptyArray } from '@rnw-community/shared';
import { telegramAuthor } from '@rondo/db/schema/identity.schema';
import { messageRef } from '@rondo/db/schema/platform.schema';
import { team, teamColor } from '@rondo/db/schema/play.schema';
import { session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { chatRules } from '@rondo/ingest-telegram/extract/chat-rules';
import { extractLineup } from '@rondo/ingest-telegram/extract/extract-lineup';
import { extractPoll, makeVenueMatcher } from '@rondo/ingest-telegram/extract/extract-poll';
import { extractCancellation } from '@rondo/ingest-telegram/extract/extract-signals';
import { withCommunityLock } from '@rondo/ingest-telegram/load/with-community-lock';
import { storeLineup } from '@rondo/ingest-telegram/roster/store-lineup';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { todayIn } from '../sessions/local-time';
import { createSession, getSession, listSessions } from '../sessions/session.service';
import { findVenueByName, withKnownVenues } from '../venues/venue.service';

import { gamesOfChat } from './games-of-chat';
import { hasMainRoster } from './has-main-roster';

import type { CancelReason, SessionView } from '../sessions/session.model';
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
    readonly isTrusted: boolean;
    readonly text?: string;
    readonly poll?: { readonly question: string; readonly answers: readonly string[] };
}

interface LiveIngestResult {
    readonly poll: boolean;
    readonly lineup: boolean;
    readonly cancellation?: { readonly sessionId: string; readonly reason: CancelReason };
    readonly unknownPlace?: { readonly sessionId: string; readonly text: string };
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
    const name = config.venues.find(entry => entry.key === venueKey)?.name;

    if (!isDefined(name)) {
        return null;
    }

    const found = yield* findVenueByName(communityId, name);

    return found?.status === 'active' ? found.id : null;
});

const gameMinutes = 90;

const minutesOf = (time: string): number => {
    const [hour = 0, minute = 0] = time.split(':').map(Number);

    return hour * 60 + minute;
};

const minutesApart = (left: string, right: string): number => Math.abs(minutesOf(left) - minutesOf(right));

const footballOn = Effect.fn('Core.footballOn')(function* (communityId: string, localDate: string) {
    const sessions = yield* listSessions(communityId, { from: localDate, to: localDate });

    return sessions.filter(({ sport }) => sport === 'football');
});

const gamesOn = Effect.fn('Core.gamesOn')(function* (communityId: string, localDate: string) {
    const sessions = yield* footballOn(communityId, localDate);

    return sessions.filter(({ status }) => status !== 'cancelled');
});

const ensureSession = Effect.fn('Core.ensureSession')(function* (
    communityId: string,
    config: CommunityConfig,
    fact: Pick<PollFact, 'localDate' | 'localTime' | 'venueKey'> & { readonly capacityMax?: number; readonly title?: string },
    { games, canCreate }: { readonly games: readonly SessionView[]; readonly canCreate: boolean }
) {
    const db = yield* Db;
    const venueId = yield* venueIdFor(communityId, config, fact.venueKey);
    const countConflicts = (game: SessionView): number =>
        Number(isDefined(venueId) && isDefined(game.venueId) && venueId !== game.venueId) +
        Number(isDefined(fact.localTime) && fact.localTime !== game.localTime);
    const isOtherGame = (game: SessionView): boolean =>
        countConflicts(game) > 1 || (isDefined(fact.localTime) && minutesApart(fact.localTime, game.localTime) >= gameMinutes);
    const possible = games.filter(game => !isOtherGame(game));
    const exact = possible.filter(game => countConflicts(game) === 0);
    const [match, ...others] = isNotEmptyArray(exact) ? exact : possible;

    if (isNotEmptyArray(others)) {
        yield* Effect.logWarning('[group] several games match, message skipped');

        return Option.none<string>();
    }

    if (isDefined(match)) {
        if (isDefined(venueId)) {
            yield* db
                .update(session)
                .set({ venueId })
                .where(and(eq(session.id, match.id), isNull(session.venueId)));
        }

        return Option.fromNullishOr(match.id);
    }

    if (!canCreate) {
        return Option.none<string>();
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

// A squad of another chat joins a game polled there, or makes the only game of its day
const applyLineup = Effect.fn('Core.applyLineup')(function* (
    communityId: string,
    config: CommunityConfig,
    fact: LineupFact,
    message: GroupMessage
) {
    const db = yield* Db;
    const otherChatId = config.otherChats?.find(({ chatId }) => BigInt(chatId) === message.chatId)?.chatId;
    const sameDay = yield* footballOn(communityId, fact.localDate);
    const own = yield* gamesOfChat(sameDay, { communityId, config, chatId: message.chatId });
    const found = yield* ensureSession(communityId, config, fact, {
        games: own.filter(({ status }) => status !== 'cancelled'),
        canCreate: !isDefined(otherChatId) || isEmptyArray(sameDay)
    });

    if (Option.isNone(found) || (isDefined(otherChatId) && (yield* hasMainRoster(found.value)))) {
        return;
    }

    const sessionId = found.value;
    const colors = yield* db.select().from(teamColor).where(eq(teamColor.communityId, communityId));

    yield* db.delete(team).where(eq(team.sessionId, sessionId));
    yield* db.insert(team).values(
        fact.teams.map(({ ordinal, emoji }) => ({
            sessionId,
            ordinal,
            colorId: colors.find(color => color.emoji === emoji)?.id,
            publishedAt: message.sentAt
        }))
    );
    yield* storeLineup({ communityId, sessionId, lineup: fact, senderName: message.senderName, chatId: otherChatId });

    const status = fact.localDate < todayIn(config.timeZone, message.sentAt) ? 'played' : 'locked';
    yield* db
        .update(session)
        .set({ status })
        .where(and(eq(session.id, sessionId), ne(session.status, 'played')));
    yield* rememberMessage(message, 'lineup', sessionId);
});

export const ingestGroupMessage = Effect.fn('Core.ingestGroupMessage')(function* (
    communityId: string,
    importedConfig: CommunityConfig,
    message: GroupMessage
) {
    yield* recordAuthor(communityId, message);

    const telegramMessage: TelegramMessage = {
        id: message.messageId,
        kind: 'message',
        sentAt: message.sentAt,
        author: message.senderName,
        authorId: Number(message.senderTgUserId),
        text: message.text,
        poll: message.poll,
        media: []
    };
    if (!message.isTrusted) {
        return { poll: false, lineup: false } satisfies LiveIngestResult;
    }

    const config = yield* withKnownVenues(communityId, importedConfig);
    const venueOf = makeVenueMatcher(config);
    const rules = Option.fromNullishOr(config.otherChats?.find(({ chatId }) => BigInt(chatId) === message.chatId)).pipe(
        Option.map(chat => chatRules(config, chat))
    );
    let unknownPlace: LiveIngestResult['unknownPlace'] | null = null;
    const poll = Option.fromNullishOr(extractPoll(telegramMessage, config, venueOf)).pipe(
        Option.filter(fact => !fact.isReserve && !fact.isChoice && fact.sport === 'football'),
        Option.filter(fact => Option.isNone(rules) || rules.value.kindOf(fact) === 'regular')
    );
    const lineup = Option.fromNullishOr(extractLineup(telegramMessage, config, venueOf)).pipe(
        Option.filter(fact => Option.isNone(rules) || rules.value.kindOf(fact) === 'regular')
    );
    const cancellation = Option.fromNullishOr(extractCancellation(telegramMessage, config, new Set([message.senderName]), venueOf)).pipe(
        Option.filter(({ isExplicit }) => isExplicit),
        Option.filter(fact => Option.isNone(rules) || rules.value.kindOf(fact) === 'regular')
    );

    if (Option.isSome(poll)) {
        const games = yield* gamesOn(communityId, poll.value.localDate);
        const sessionId = yield* ensureSession(communityId, config, poll.value, { games, canCreate: true });

        if (Option.isSome(sessionId)) {
            yield* rememberMessage(message, 'poll', sessionId.value);
            const game = yield* getSession(sessionId.value);

            if (!isDefined(poll.value.venueKey) && Option.exists(game, ({ venueId }) => !isDefined(venueId))) {
                unknownPlace = { sessionId: sessionId.value, text: poll.value.title };
            }
        }
    }

    if (Option.isSome(lineup)) {
        yield* withCommunityLock({ id: communityId }, applyLineup(communityId, config, lineup.value, message));
    }

    const sameDay = Option.isSome(cancellation) ? yield* gamesOn(communityId, cancellation.value.localDate) : [];
    const [target, ...others] = yield* gamesOfChat(sameDay, { communityId, config, chatId: message.chatId });
    const toCancel = isDefined(target) && isEmptyArray(others) && target.status !== 'played' ? target : null;

    return {
        poll: Option.isSome(poll),
        lineup: Option.isSome(lineup),
        ...(isDefined(toCancel) && Option.isSome(cancellation)
            ? { cancellation: { sessionId: toCancel.id, reason: cancellation.value.reason } }
            : {}),
        ...(isDefined(unknownPlace) ? { unknownPlace } : {})
    } satisfies LiveIngestResult;
});
