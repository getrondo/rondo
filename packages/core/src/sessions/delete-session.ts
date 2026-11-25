import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { telegramAccount } from '@rondo/db/schema/identity.schema';
import { messageRef, pollVote, telegramPoll } from '@rondo/db/schema/platform.schema';
import { session, signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { Telegram } from '@rondo/telegram/service/telegram.service';
import { and, eq, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { adminPersonIds } from '../access/admin-access';
import { recordAudit } from '../audit/record-audit';
import { ActionFailedError } from '../error/action-failed.error';

export const hasOnlyAdminVotes = Effect.fn('Core.hasOnlyAdminVotes')(function* (communityId: string, sessionId: string) {
    const db = yield* Db;
    const admins = yield* adminPersonIds(communityId);
    const signed = yield* db.select({ personId: signup.personId }).from(signup).where(eq(signup.sessionId, sessionId));
    const voters = yield* db
        .select({ personId: telegramAccount.personId })
        .from(pollVote)
        .leftJoin(telegramAccount, eq(telegramAccount.tgUserId, pollVote.tgUserId))
        .where(eq(pollVote.sessionId, sessionId));

    return [...signed, ...voters].every(entry => isDefined(entry.personId) && admins.has(entry.personId));
});

export const isDeletableSession = Effect.fn('Core.isDeletableSession')(function* (communityId: string, sessionId: string, today: string) {
    const db = yield* Db;
    const [row] = yield* db
        .select({ source: session.source, localDate: session.localDate })
        .from(session)
        .where(and(eq(session.id, sessionId), eq(session.communityId, communityId)));

    if (!isDefined(row) || row.source !== 'bot' || row.localDate < today) {
        return false;
    }

    return yield* hasOnlyAdminVotes(communityId, sessionId);
});

export const deleteSession = Effect.fn('Core.deleteSession')(function* (input: {
    readonly communityId: string;
    readonly sessionId: string;
    readonly today: string;
    readonly actorPersonId: string | null;
}) {
    const db = yield* Db;
    const telegram = yield* Telegram;

    if (!(yield* isDeletableSession(input.communityId, input.sessionId, input.today))) {
        return yield* ActionFailedError.make({ reason: 'only a future game made by the bot without votes of players can be deleted' });
    }

    const polls = yield* db.select().from(telegramPoll).where(eq(telegramPoll.sessionId, input.sessionId));

    for (const poll of polls) {
        yield* telegram.call('stopPoll', api => api.stopPoll(Number(poll.chatId), poll.messageId)).pipe(Effect.ignore);
    }

    yield* db.transaction(() =>
        Effect.gen(function* () {
            yield* db.execute(sql`select set_config('rondo.erase_game', 'on', true)`);
            const [game] = yield* db.select({ localDate: session.localDate }).from(session).where(eq(session.id, input.sessionId));
            yield* db.delete(pollVote).where(eq(pollVote.sessionId, input.sessionId));
            yield* db.delete(messageRef).where(and(eq(messageRef.entityType, 'session'), eq(messageRef.entityId, input.sessionId)));
            const deleted = yield* db.delete(session).where(eq(session.id, input.sessionId)).returning({ id: session.id });

            if (!isNotEmptyArray(deleted)) {
                return yield* ActionFailedError.make({ reason: 'the game is already gone' });
            }

            return yield* recordAudit({
                communityId: input.communityId,
                actorPersonId: input.actorPersonId,
                action: 'session.delete',
                entityType: 'session',
                entityId: input.sessionId,
                diff: { localDate: game?.localDate ?? null, polls: polls.length }
            });
        })
    );

    return input.sessionId;
});
