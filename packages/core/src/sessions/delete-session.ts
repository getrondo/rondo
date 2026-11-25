import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { telegramAccount } from '@rondo/db/schema/identity.schema';
import { importedPoll, messageRef, pendingAction, pollVote, telegramPoll } from '@rondo/db/schema/platform.schema';
import { lineupEntry, teamMember } from '@rondo/db/schema/play.schema';
import { session, signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { Telegram } from '@rondo/telegram/service/telegram.service';
import { and, count, eq, sql } from 'drizzle-orm';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as Predicate from 'effect/Predicate';

import { adminPersonIds } from '../access/admin-access';
import { recordAudit } from '../audit/record-audit';
import { ActionFailedError } from '../error/action-failed.error';
import { isSettledPoll } from '../utils/is-settled-poll.util';

export const hasOnlyAdminVotes = Effect.fn('Core.hasOnlyAdminVotes')(function* (communityId: string, sessionId: string) {
    const db = yield* Db;
    const admins = yield* adminPersonIds(communityId);
    const signed = yield* db
        .select({ personId: signup.personId, guestOf: signup.guestOfPersonId })
        .from(signup)
        .where(eq(signup.sessionId, sessionId));
    const voters = yield* db
        .select({ personId: telegramAccount.personId })
        .from(pollVote)
        .leftJoin(telegramAccount, eq(telegramAccount.tgUserId, pollVote.tgUserId))
        .where(eq(pollVote.sessionId, sessionId));
    const lineup = yield* db
        .select({ personId: lineupEntry.personId, guestOf: lineupEntry.guestOfPersonId })
        .from(lineupEntry)
        .where(eq(lineupEntry.sessionId, sessionId));
    const teams = yield* db.select({ personId: teamMember.personId }).from(teamMember).where(eq(teamMember.sessionId, sessionId));

    return [...signed, ...voters, ...lineup, ...teams].every(
        entry => isDefined(entry.personId) && admins.has(entry.personId) && !('guestOf' in entry && isDefined(entry.guestOf))
    );
});

const isDeletableGame = Effect.fn('Core.isDeletableGame')(function* (communityId: string, sessionId: string, today: string) {
    const db = yield* Db;
    const [row] = yield* db
        .select({ source: session.source, localDate: session.localDate })
        .from(session)
        .where(and(eq(session.id, sessionId), eq(session.communityId, communityId)));
    const [foreign] = yield* db.select({ count: count() }).from(importedPoll).where(eq(importedPoll.sessionId, sessionId));
    const [created] = yield* db
        .select({ count: count() })
        .from(pendingAction)
        .where(
            and(
                eq(pendingAction.communityId, communityId),
                eq(pendingAction.kind, 'create_session'),
                sql`${pendingAction.result} ->> 'sessionId' = ${sessionId}`
            )
        );

    if (!isDefined(row) || row.source !== 'bot' || row.localDate < today || (foreign?.count ?? 0) > 0 || (created?.count ?? 0) === 0) {
        return false;
    }

    return yield* hasOnlyAdminVotes(communityId, sessionId);
});

export const isDeletableSession = Effect.fn('Core.isDeletableSession')(function* (communityId: string, sessionId: string, today: string) {
    const db = yield* Db;
    const polls = yield* db.select({ closedAt: telegramPoll.closedAt }).from(telegramPoll).where(eq(telegramPoll.sessionId, sessionId));

    if (!isNotEmptyArray(polls) || polls.some(poll => isDefined(poll.closedAt))) {
        return false;
    }

    return yield* isDeletableGame(communityId, sessionId, today);
});

const refusedDelete = ActionFailedError.make({ failure: { code: 'not_deletable' } });

const stopForDelete = Effect.fn('Core.stopForDelete')(function* (poll: typeof telegramPoll.$inferSelect) {
    const db = yield* Db;
    const telegram = yield* Telegram;
    const stopped = yield* telegram
        .call('stopPoll', api => api.stopPoll(Number(poll.chatId), poll.messageId))
        .pipe(
            Effect.map(result => (Predicate.isNumber(result.total_voter_count) ? result.total_voter_count : null)),
            Effect.catch(error =>
                isSettledPoll(error.description) ? Effect.succeed(null) : ActionFailedError.make({ failure: { code: 'poll_not_closed' } })
            )
        );
    const closedAt = yield* DateTime.nowAsDate;
    yield* db.update(telegramPoll).set({ closedAt }).where(eq(telegramPoll.pollId, poll.pollId));
    const [stored] = yield* db.select({ count: count() }).from(pollVote).where(eq(pollVote.pollId, poll.pollId));

    if (!isDefined(stopped)) {
        return 'uncounted' as const;
    }

    return stopped > (stored?.count ?? 0) ? ('unseen' as const) : ('counted' as const);
});

export const deleteSession = Effect.fn('Core.deleteSession')(function* (input: {
    readonly communityId: string;
    readonly sessionId: string;
    readonly today: string;
    readonly actorPersonId: string | null;
}) {
    const db = yield* Db;
    const outcome = yield* db.transaction(() =>
        Effect.gen(function* () {
            const [game] = yield* db
                .select({ localDate: session.localDate })
                .from(session)
                .where(and(eq(session.id, input.sessionId), eq(session.communityId, input.communityId)))
                .for('update');

            if (!isDefined(game) || !(yield* isDeletableSession(input.communityId, input.sessionId, input.today))) {
                return yield* refusedDelete;
            }

            const polls = yield* db.select().from(telegramPoll).where(eq(telegramPoll.sessionId, input.sessionId));
            const checks: ('counted' | 'unseen' | 'uncounted')[] = [];

            for (const poll of polls) {
                const check = yield* stopForDelete(poll);
                checks.push(check);
            }

            const kept = checks.find(check => check !== 'counted');

            if (isDefined(kept)) {
                return kept;
            }

            yield* db.delete(pollVote).where(eq(pollVote.sessionId, input.sessionId));
            yield* db.delete(messageRef).where(and(eq(messageRef.entityType, 'session'), eq(messageRef.entityId, input.sessionId)));
            yield* db.delete(session).where(eq(session.id, input.sessionId));
            yield* recordAudit({
                communityId: input.communityId,
                actorPersonId: input.actorPersonId,
                action: 'session.delete',
                entityType: 'session',
                entityId: input.sessionId,
                diff: { localDate: game.localDate, polls: polls.length }
            });

            return 'deleted' as const;
        })
    );

    if (outcome === 'unseen') {
        return yield* ActionFailedError.make({
            failure: { code: 'votes_unseen' }
        });
    }

    if (outcome === 'uncounted') {
        return yield* ActionFailedError.make({
            failure: { code: 'votes_uncounted' }
        });
    }

    return input.sessionId;
});
