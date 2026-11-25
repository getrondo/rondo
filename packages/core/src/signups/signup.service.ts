import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { person } from '@rondo/db/schema/identity.schema';
import { telegramChat } from '@rondo/db/schema/org.schema';
import { pendingAction, pollVote, telegramPoll } from '@rondo/db/schema/platform.schema';
import { session, signup, signupEvent } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, asc, count, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { primaryAccount } from '../identity/primary-account';
import { syncMember, type TelegramUser } from '../identity/telegram-user';
import { closedStatuses, isClosed } from '../sessions/session.model';
import { unsignedSquad } from '../teams/team-inputs';
import { writeToChat, type Approval } from '../telegram/write-to-chat';
import { isSettledPoll } from '../utils/is-settled-poll.util';

import { pollChatsOf } from './poll-chats';

type PollChoice = 'in' | 'gk' | 'out';

const pollChoices: readonly PollChoice[] = ['in', 'gk', 'out'];

export interface PromotedPlayer {
    readonly personId: string;
    readonly displayName: string;
    readonly tgUserId: bigint | null;
}

export interface PollAnswerOutcome {
    readonly sessionId: string;
    readonly status: 'in' | 'out' | 'waitlisted';
    readonly promoted: readonly PromotedPlayer[];
}

const fieldPlayersIn = Effect.fn('Core.fieldPlayersIn')(function* (sessionId: string, exceptPersonId: string | null) {
    const db = yield* Db;
    const conditions = [
        eq(signup.sessionId, sessionId),
        eq(signup.status, 'in'),
        eq(signup.role, 'field'),
        ...(isDefined(exceptPersonId) ? [ne(signup.personId, exceptPersonId)] : [])
    ];
    const [row] = yield* db
        .select({ value: count() })
        .from(signup)
        .where(and(...conditions));

    return row?.value ?? 0;
});

// Seats: field players who said yes, and squad members who play without a «yes»
export const seatsTaken = Effect.fn('Core.seatsTaken')(function* (sessionId: string, exceptPersonId: string | null = null) {
    const unsigned = yield* unsignedSquad(sessionId);
    const seated = unsigned.filter(member => member.role === 'field' && member.personId !== exceptPersonId);

    return (yield* fieldPlayersIn(sessionId, exceptPersonId)) + seated.length;
});

const writeSignup = Effect.fn('Core.writeSignup')(function* (input: {
    readonly sessionId: string;
    readonly personId: string;
    readonly role: 'field' | 'gk';
    readonly status: 'in' | 'out' | 'waitlisted';
}) {
    const db = yield* Db;
    const [previous] = yield* db
        .select({ id: signup.id, status: signup.status, role: signup.role })
        .from(signup)
        .where(and(eq(signup.sessionId, input.sessionId), eq(signup.personId, input.personId)));
    const [stored] = yield* db
        .insert(signup)
        .values(input)
        .onConflictDoUpdate({ target: [signup.sessionId, signup.personId], set: { role: input.role, status: input.status } })
        .returning({ id: signup.id });

    if (previous?.status !== input.status) {
        yield* db.insert(signupEvent).values({
            signupId: stored?.id ?? '',
            fromStatus: previous?.status ?? null,
            toStatus: input.status,
            actorPersonId: input.personId
        });
    }
});

const promoteWaitlisted = Effect.fn('Core.promoteWaitlisted')(function* (sessionId: string, freeSeats: number) {
    const db = yield* Db;

    if (freeSeats <= 0) {
        return [];
    }

    const account = primaryAccount(db, sessionId);
    const waiting = yield* db
        .select({ id: signup.id, personId: signup.personId, displayName: person.displayName, tgUserId: account.tgUserId })
        .from(signup)
        .innerJoin(person, eq(person.id, signup.personId))
        .leftJoin(account, eq(account.personId, signup.personId))
        .where(and(eq(signup.sessionId, sessionId), eq(signup.status, 'waitlisted')))
        .orderBy(asc(signup.updatedAt))
        .limit(freeSeats);

    for (const entry of waiting) {
        yield* db.update(signup).set({ status: 'in' }).where(eq(signup.id, entry.id));
        yield* db.insert(signupEvent).values({ signupId: entry.id, fromStatus: 'waitlisted', toStatus: 'in' });
    }

    return waiting.map(({ personId, displayName, tgUserId }): PromotedPlayer => ({ personId, displayName, tgUserId }));
});

const refreshFullness = Effect.fn('Core.refreshFullness')(function* (sessionId: string, capacityMax: number | null) {
    const db = yield* Db;

    if (!isDefined(capacityMax)) {
        return;
    }

    const taken = yield* seatsTaken(sessionId);
    const [current] = yield* db.select({ status: session.status }).from(session).where(eq(session.id, sessionId));

    if (current?.status === 'open' && taken >= capacityMax) {
        yield* db.update(session).set({ status: 'full' }).where(eq(session.id, sessionId));
    }

    if (current?.status === 'full' && taken < capacityMax) {
        yield* db.update(session).set({ status: 'open' }).where(eq(session.id, sessionId));
    }
});

export const fillFreeSeats = Effect.fn('Core.fillFreeSeats')(function* (sessionId: string, capacityMax: number | null) {
    const promoted = isDefined(capacityMax) ? yield* promoteWaitlisted(sessionId, capacityMax - (yield* seatsTaken(sessionId))) : [];
    yield* refreshFullness(sessionId, capacityMax);

    return promoted;
});

export const lockSession = Effect.fn('Core.lockSession')(function* (sessionId: string) {
    const db = yield* Db;
    const [row] = yield* db
        .select({ status: session.status, capacityMax: session.capacityMax })
        .from(session)
        .where(eq(session.id, sessionId))
        .for('update');

    return Option.fromNullishOr(row).pipe(Option.filter(({ status }) => !isClosed(status)));
});

const setSignup = Effect.fn('Core.setSignup')(function* (sessionId: string, personId: string, choice: PollChoice, asksGoalkeeper: boolean) {
    const db = yield* Db;
    const locked = yield* lockSession(sessionId);

    if (Option.isNone(locked)) {
        return Option.none<PollAnswerOutcome>();
    }

    const { capacityMax } = locked.value;
    const [previous] = yield* db
        .select({ role: signup.role })
        .from(signup)
        .where(and(eq(signup.sessionId, sessionId), eq(signup.personId, personId)));
    const keptRole = previous?.role === 'gk' && !(asksGoalkeeper && choice === 'in') ? 'gk' : 'field';
    const role = choice === 'gk' ? 'gk' : keptRole;
    const othersIn = yield* seatsTaken(sessionId, personId);
    const hasSeat = role === 'gk' || !isDefined(capacityMax) || othersIn < capacityMax;
    const seatedStatus = hasSeat ? 'in' : 'waitlisted';
    const status = choice === 'out' ? 'out' : seatedStatus;
    yield* writeSignup({ sessionId, personId, role, status });
    const promoted = yield* fillFreeSeats(sessionId, capacityMax);

    return Option.some<PollAnswerOutcome>({ sessionId, status, promoted });
});

interface Ballot {
    readonly pollId: string;
    readonly tgUserId: bigint;
    readonly sessionId: string;
    readonly choice: PollChoice | null;
}

const storeBallot = Effect.fn('Core.storeBallot')(function* ({ choice, ...ballot }: Ballot) {
    const db = yield* Db;

    if (!isDefined(choice)) {
        yield* db.delete(pollVote).where(and(eq(pollVote.pollId, ballot.pollId), eq(pollVote.tgUserId, ballot.tgUserId)));

        return;
    }

    const answer = { choice: choice === 'out' ? 'no' : 'yes', votedAt: yield* DateTime.nowAsDate };
    yield* db
        .insert(pollVote)
        .values({ ...ballot, ...answer })
        .onConflictDoUpdate({ target: [pollVote.pollId, pollVote.tgUserId], set: answer });
});

export const applyPollAnswer = Effect.fn('Core.applyPollAnswer')(function* (input: {
    readonly pollId: string;
    readonly user: TelegramUser;
    readonly optionIds: readonly number[];
}) {
    const db = yield* Db;
    const [poll] = yield* db
        .select({ sessionId: telegramPoll.sessionId, communityId: session.communityId, options: telegramPoll.options })
        .from(telegramPoll)
        .innerJoin(session, eq(session.id, telegramPoll.sessionId))
        .where(eq(telegramPoll.pollId, input.pollId));

    if (!isDefined(poll)) {
        return Option.none<PollAnswerOutcome>();
    }

    const personId = yield* syncMember(poll.communityId, input.user, 'active');
    const chosen = poll.options[input.optionIds[0] ?? -1];
    const choice = pollChoices.find(candidate => candidate === chosen) ?? 'out';

    return yield* db.transaction(() =>
        Effect.gen(function* () {
            const [game] = yield* db.select({ id: session.id }).from(session).where(eq(session.id, poll.sessionId)).for('update');

            if (!isDefined(game)) {
                return Option.none<PollAnswerOutcome>();
            }

            yield* storeBallot({
                pollId: input.pollId,
                tgUserId: input.user.id,
                sessionId: poll.sessionId,
                choice: isDefined(chosen) ? choice : null
            });

            return yield* setSignup(poll.sessionId, personId, choice, poll.options.includes('gk'));
        })
    );
});

export const rosterOf = Effect.fn('Core.rosterOf')(function* (sessionId: string) {
    const db = yield* Db;

    return yield* db
        .select({
            personId: signup.personId,
            displayName: person.displayName,
            role: signup.role,
            status: signup.status,
            isGuest: signup.isGuest,
            hostId: signup.guestOfPersonId
        })
        .from(signup)
        .innerJoin(person, eq(person.id, signup.personId))
        .where(eq(signup.sessionId, sessionId))
        .orderBy(asc(signup.createdAt));
});

// The groups whose poll could not be closed because nothing may be written there
export const closePollsOf = Effect.fn('Core.closePollsOf')(function* (sessionId: string, approval: Approval | null) {
    const db = yield* Db;
    const open = yield* db
        .select()
        .from(telegramPoll)
        .where(and(eq(telegramPoll.sessionId, sessionId), isNull(telegramPoll.closedAt)));
    const kept: boolean[] = [];

    for (const poll of open) {
        const outcome = yield* writeToChat({
            target: { chatId: poll.chatId, topicId: null },
            approval,
            content: { _tag: 'stop_poll', messageId: poll.messageId }
        }).pipe(
            Effect.as({ isSettled: true, isKept: false }),
            Effect.tapError(error => Effect.logWarning('[poll] not closed', error)),
            Effect.catchTags({
                ActionFailedError: () => Effect.succeed({ isSettled: false, isKept: true }),
                TelegramApiError: error => Effect.succeed({ isSettled: isSettledPoll(error.description), isKept: false })
            })
        );
        kept.push(outcome.isKept);

        if (outcome.isSettled) {
            const closedAt = yield* DateTime.nowAsDate;
            yield* db.update(telegramPoll).set({ closedAt }).where(eq(telegramPoll.pollId, poll.pollId));
        }
    }

    const chatIds = kept.includes(true) ? yield* pollChatsOf(sessionId) : [];
    const rows = isNotEmptyArray(chatIds)
        ? yield* db.select({ title: telegramChat.title }).from(telegramChat).where(inArray(telegramChat.chatId, chatIds))
        : [];

    return rows.map(({ title }) => `«${title}»`).join(', ');
});

// A cancellation the approver allowed also allows the close that did not go through then
const closureApproval = Effect.fn('Core.closureApproval')(function* (sessionId: string) {
    const db = yield* Db;
    const [row] = yield* db
        .select({ approver: pendingAction.approverTgUserId, requester: pendingAction.requestedByTgUserId })
        .from(pendingAction)
        .innerJoin(session, sql`${session.id}::text = ${pendingAction.payload} ->> 'sessionId' and ${session.status} = 'cancelled'`)
        .where(and(eq(session.id, sessionId), eq(pendingAction.kind, 'cancel_session'), eq(pendingAction.status, 'confirmed')))
        .orderBy(desc(pendingAction.decidedAt))
        .limit(1);

    return isDefined(row) ? ({ _tag: 'approver', tgUserId: row.approver ?? row.requester } as const) : null;
});

export const closeFinishedPolls = Effect.fn('Core.closeFinishedPolls')(function* () {
    const db = yield* Db;
    const games = yield* db
        .selectDistinct({ sessionId: telegramPoll.sessionId })
        .from(telegramPoll)
        .innerJoin(session, eq(session.id, telegramPoll.sessionId))
        .where(and(isNull(telegramPoll.closedAt), inArray(session.status, closedStatuses)));

    for (const { sessionId } of games) {
        const approval = yield* closureApproval(sessionId);
        yield* closePollsOf(sessionId, approval);
    }
});
