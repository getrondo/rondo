import { isDefined } from '@rnw-community/shared';
import { person, telegramAccount } from '@rondo/db/schema/identity.schema';
import { messageRef, telegramPoll } from '@rondo/db/schema/platform.schema';
import { session, signup, signupEvent } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { Telegram } from '@rondo/telegram/service/telegram.service';
import { and, asc, count, eq, ne } from 'drizzle-orm';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { formatSessionLabel, text } from '../i18n/messages';
import { ensureMembership, upsertTelegramUser, type TelegramUser } from '../identity/telegram-user';

import type { Locale } from '../i18n/locale';
import type { SessionView } from '../sessions/session.model';

type PollChoice = 'in' | 'gk' | 'out';

const pollChoices: readonly PollChoice[] = ['in', 'gk', 'out'];

const pollQuestion = (locale: Locale, target: SessionView): string => {
    const label = formatSessionLabel(locale, target);
    const capacity = isDefined(target.capacityMax) ? ` — ${target.capacityMax} ${text(locale, 'places')}` : '';

    return `⚽ ${label}${capacity}`;
};

export const announceSession = Effect.fn('Core.announceSession')(function* (target: SessionView, chatId: bigint, locale: Locale) {
    const db = yield* Db;
    const telegram = yield* Telegram;
    const options = [text(locale, 'pollIn'), text(locale, 'pollGk'), text(locale, 'pollOut')].map(option => ({ text: option }));
    const sent = yield* telegram.call('sendPoll', api =>
        api.sendPoll(Number(chatId), pollQuestion(locale, target), options, { is_anonymous: false, allows_multiple_answers: false })
    );

    yield* db
        .insert(telegramPoll)
        .values({ pollId: sent.poll.id, chatId, messageId: sent.message_id, sessionId: target.id, options: pollChoices });
    yield* db
        .insert(messageRef)
        .values({ chatId, messageId: sent.message_id, purpose: 'poll', entityType: 'session', entityId: target.id })
        .onConflictDoNothing();

    return sent.message_id;
});

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

    return Option.fromNullishOr(previous);
});

const promoteWaitlisted = Effect.fn('Core.promoteWaitlisted')(function* (sessionId: string, freeSeats: number) {
    const db = yield* Db;

    if (freeSeats <= 0) {
        return [];
    }

    const waiting = yield* db
        .select({ id: signup.id, personId: signup.personId, displayName: person.displayName, tgUserId: telegramAccount.tgUserId })
        .from(signup)
        .innerJoin(person, eq(person.id, signup.personId))
        .leftJoin(telegramAccount, eq(telegramAccount.personId, signup.personId))
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

    const taken = yield* fieldPlayersIn(sessionId, null);
    const [current] = yield* db.select({ status: session.status }).from(session).where(eq(session.id, sessionId));

    if (current?.status === 'open' && taken >= capacityMax) {
        yield* db.update(session).set({ status: 'full' }).where(eq(session.id, sessionId));
    }

    if (current?.status === 'full' && taken < capacityMax) {
        yield* db.update(session).set({ status: 'open' }).where(eq(session.id, sessionId));
    }
});

export const applyPollAnswer = Effect.fn('Core.applyPollAnswer')(function* (input: {
    readonly pollId: string;
    readonly user: TelegramUser;
    readonly optionIds: readonly number[];
}) {
    const db = yield* Db;
    const [poll] = yield* db
        .select({
            sessionId: telegramPoll.sessionId,
            communityId: session.communityId,
            capacityMax: session.capacityMax,
            status: session.status
        })
        .from(telegramPoll)
        .innerJoin(session, eq(session.id, telegramPoll.sessionId))
        .where(eq(telegramPoll.pollId, input.pollId));

    if (!isDefined(poll) || poll.status === 'cancelled') {
        return Option.none<PollAnswerOutcome>();
    }

    const personId = yield* upsertTelegramUser(input.user);
    yield* ensureMembership(poll.communityId, personId);
    const choice = pollChoices[input.optionIds[0] ?? 2] ?? 'out';
    const role = choice === 'gk' ? 'gk' : 'field';
    const othersIn = yield* fieldPlayersIn(poll.sessionId, personId);
    const hasSeat = role === 'gk' || !isDefined(poll.capacityMax) || othersIn < poll.capacityMax;
    const seatedStatus = hasSeat ? 'in' : 'waitlisted';
    const status = choice === 'out' ? 'out' : seatedStatus;
    const previous = yield* writeSignup({ sessionId: poll.sessionId, personId, role, status });
    const freedSeat =
        Option.exists(previous, entry => entry.status === 'in' && entry.role === 'field') && !(status === 'in' && role === 'field');
    const promoted =
        freedSeat && isDefined(poll.capacityMax)
            ? yield* promoteWaitlisted(poll.sessionId, poll.capacityMax - (yield* fieldPlayersIn(poll.sessionId, null)))
            : [];
    yield* refreshFullness(poll.sessionId, poll.capacityMax);

    return Option.some<PollAnswerOutcome>({ sessionId: poll.sessionId, status, promoted });
});

export const rosterOf = Effect.fn('Core.rosterOf')(function* (sessionId: string) {
    const db = yield* Db;

    return yield* db
        .select({ personId: signup.personId, displayName: person.displayName, role: signup.role, status: signup.status })
        .from(signup)
        .innerJoin(person, eq(person.id, signup.personId))
        .where(eq(signup.sessionId, sessionId))
        .orderBy(asc(signup.createdAt));
});

export const closePollsOf = Effect.fn('Core.closePollsOf')(function* (sessionId: string) {
    const db = yield* Db;
    const telegram = yield* Telegram;
    const open = yield* db
        .select()
        .from(telegramPoll)
        .where(and(eq(telegramPoll.sessionId, sessionId)));

    for (const poll of open.filter(entry => !isDefined(entry.closedAt))) {
        yield* telegram.call('stopPoll', api => api.stopPoll(Number(poll.chatId), poll.messageId)).pipe(Effect.ignore);
        const closedAt = yield* DateTime.nowAsDate;
        yield* db.update(telegramPoll).set({ closedAt }).where(eq(telegramPoll.pollId, poll.pollId));
    }
});
