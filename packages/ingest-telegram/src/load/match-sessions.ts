import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { extraction, sourceRef } from '@rondo/db/schema/platform.schema';
import { session, sessionChange } from '@rondo/db/schema/scheduling.schema';
import { and, eq, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { postIdIn, sourceOf } from '../extract/post-id';

import { sessionEntity } from './load-provenance';
import { mainChatId } from './main-chat-id';
import { sessionMillis, startOf } from './start-of';

import type { PlannedSession } from '../extract/assemble-plan';
import type { LoadContext } from '../interface/load-context.interface';
import type { liveMessages } from './live-messages';
import type { CommunityConfig } from '@rondo/core/config/community-config';

type LiveMessages = Effect.Success<ReturnType<typeof liveMessages>>;

export const existingSessions = Effect.fn('IngestTelegram.existingSessions')(function* (
    { transaction, communityId, config }: LoadContext,
    live: LiveMessages
) {
    const rows = yield* transaction
        .select({
            id: session.id,
            localDate: session.localDate,
            startsAt: session.startsAt,
            activityId: session.activityId,
            source: session.source
        })
        .from(session)
        .where(eq(session.communityId, communityId));
    const references = yield* transaction
        .select({ chatId: sourceRef.chatId, messageId: sourceRef.messageId, sessionId: extraction.entityId })
        .from(sourceRef)
        .innerJoin(extraction, eq(extraction.sourceRefId, sourceRef.id))
        .where(and(eq(sourceRef.communityId, communityId), eq(extraction.entityType, sessionEntity)));
    const changed = yield* transaction
        .select({ id: sessionChange.sessionId, isDecision: sql<boolean>`${sessionChange.diff} ? 'decision'` })
        .from(sessionChange)
        .innerJoin(session, eq(session.id, sessionChange.sessionId))
        .where(eq(session.communityId, communityId));
    const chats = { mainChatId: yield* mainChatId(config), otherChats: config.otherChats };
    const otherIds = new Set(config.otherChats?.map(({ chatId }) => chatId));
    const rowById = new Map(rows.map(row => [row.id, row]));
    const byDay = new Map<string, typeof rows>();

    for (const row of rows) {
        const key = `${row.localDate}|${row.activityId}`;
        byDay.set(key, [...(byDay.get(key) ?? []), row]);
    }

    const posted = [
        ...references.map(({ chatId, sessionId }) => ({ sessionId, isOtherChat: otherIds.has(chatId ?? 0) })),
        ...live.map(({ sessionId, isOtherChat }) => ({ sessionId, isOtherChat }))
    ];
    const ofMain = new Set(posted.filter(({ isOtherChat }) => !isOtherChat).map(({ sessionId }) => sessionId));
    const ofOther = new Set(posted.map(({ sessionId }) => sessionId).filter(id => !ofMain.has(id)));
    const decided = new Set(changed.filter(({ isDecision }) => isDecision).map(({ id }) => id));

    return {
        edited: new Set(changed.map(({ id }) => id)),
        decided,
        ofOther,
        ambiguousDates: [...byDay.values()].flatMap(games => {
            const [first, second] = games.filter(({ id }) => decided.has(id));

            return isDefined(first) && isDefined(second) ? [first.localDate] : [];
        }),
        byMessage: new Map([
            ...references.flatMap(row => Option.toArray(postIdIn(chats, row)).map(postId => [postId, rowById.get(row.sessionId)] as const)),
            ...live.flatMap(({ postId, sessionId }) => Option.toArray(postId).map(id => [id, rowById.get(sessionId)] as const))
        ]),
        byDay
    };
});

type Existing = Effect.Success<ReturnType<typeof existingSessions>>;

interface PlannedMatch {
    readonly key: string;
    readonly messageIds: readonly number[];
    readonly isMain: boolean;
    readonly isNear: (startsAt: Date) => boolean;
}

export const matchSessions = (planned: readonly PlannedMatch[], { byMessage, byDay, edited, decided, ofOther }: Existing) => {
    const used = new Set<string>();
    const take = <Row extends { readonly id: string }>(candidates: readonly (Row | null | undefined)[]): Row | null => {
        const free = candidates.find(row => isDefined(row) && !used.has(row.id)) ?? null;
        used.add(free?.id ?? '');

        return free;
    };
    const sameMessage = planned.map(({ messageIds }) => take(messageIds.map(id => byMessage.get(id))));

    return planned.map(({ key, isMain, isNear }, index) => {
        const near = (byDay.get(key) ?? []).filter(({ id, startsAt }) => (isMain && !ofOther.has(id)) || isNear(startsAt));
        const decidedGames = near.filter(({ id }) => decided.has(id));
        const sameDay = near.filter(({ id }) => !edited.has(id));
        const [only, ...others] = sameDay;
        const imported = sameDay.filter(row => row.source === 'import');

        return (
            sameMessage[index] ??
            take(decidedGames.length === 1 ? decidedGames : []) ??
            take(isNotEmptyArray(imported) || isNotEmptyArray(others) ? imported : [only])
        );
    });
};

const messageIdsOf = ({ pollMessageIds, lineup }: PlannedSession): number[] => [
    ...pollMessageIds,
    ...(isDefined(lineup) ? [lineup.messageId] : [])
];

export const matchOf = (planned: PlannedSession, { otherChats, timeZone }: CommunityConfig) => {
    const isMainPost = (messageId: number | undefined): boolean =>
        isDefined(messageId) && !isDefined(sourceOf(otherChats, messageId).chatId);
    const times = planned.statedTimes.map(localTime => startOf({ localDate: planned.localDate, localTime }, timeZone).getTime());

    return {
        messageIds: messageIdsOf(planned),
        isMain: isMainPost(planned.pollMessageIds[0]) || isMainPost(planned.lineup?.messageId),
        isNear: (startsAt: Date): boolean =>
            !isNotEmptyArray(times) || times.some(time => Math.abs(time - startsAt.getTime()) < sessionMillis)
    };
};
