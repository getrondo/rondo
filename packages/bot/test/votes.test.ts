import { expect, layer } from '@effect/vitest';
import { upsertTelegramUser } from '@rondo/core/identity/telegram-user';
import { telegramAccount } from '@rondo/db/schema/identity.schema';
import { membership } from '@rondo/db/schema/org.schema';
import { session, signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import { and, eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { conversation, deliver } from './support/conversation';
import { seedSeason } from './support/season';
import { adminNumbered, menuTestLayer } from './support/test-layer';

import type { Update } from 'grammy/types';

const recorder = makeRecorder();
const voter = (id: number) => ({ id, is_bot: false as const, first_name: `Voter ${id}` });

const postedGame = Effect.fn('test.postedGame')(function* (slug: string, chatId: number, adminId: number, places: string) {
    const db = yield* Db;
    const { communityId } = yield* seedSeason(slug, { groupChatId: chatId, adminId });
    const admin = conversation(recorder, adminNumbered(adminId));
    yield* admin.type('/newgame');
    yield* admin.tap('👥 22');
    yield* admin.type(places);
    yield* admin.tap('✅ Опублікувати');
    const sent = recorder.calls.findLast(call => call.method === 'sendPoll' && call.payload.chat_id === chatId)?.result as {
        poll: { id: string };
    };
    const [game] = yield* db
        .select()
        .from(session)
        .where(and(eq(session.communityId, communityId), eq(session.localDate, '2026-11-27')));

    return { communityId, admin, pollId: sent.poll.id, sessionId: game?.id ?? '' };
});

const statusesOf = Effect.fn('test.statusesOf')(function* (sessionId: string) {
    const db = yield* Db;
    const rows = yield* db
        .select({ tgUserId: telegramAccount.tgUserId, status: signup.status })
        .from(signup)
        .innerJoin(telegramAccount, eq(telegramAccount.personId, signup.personId))
        .where(eq(signup.sessionId, sessionId))
        .orderBy(telegramAccount.tgUserId);

    return rows.map(row => `${row.tgUserId}:${row.status}`);
});

const answer = (pollId: string, id: number, optionIds: number[]): Omit<Update, 'update_id'> => ({
    poll_answer: { poll_id: pollId, user: voter(id), option_ids: optionIds, option_persistent_ids: [] }
});

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('votes through poll answers', it => {
    it.effect('counts poll answers: yes, no, change, withdraw, a new person and the waiting list with its mention', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, pollId, sessionId } = yield* postedGame('votes-basic', -6001, 901, '2');
            yield* deliver(answer(pollId, 9401, [0]));
            yield* deliver(answer(pollId, 9402, [1]));
            yield* deliver(answer(pollId, 9402, [0]));
            yield* deliver(answer(pollId, 9403, [0]));
            const full = yield* statusesOf(sessionId);
            yield* deliver(answer(pollId, 9401, []));
            const after = yield* statusesOf(sessionId);
            const mention = recorder.calls.findLast(call => call.method === 'sendMessage' && call.payload.chat_id === -6001)?.payload.text;
            const [member] = yield* db
                .select()
                .from(membership)
                .innerJoin(telegramAccount, eq(telegramAccount.personId, membership.personId))
                .where(and(eq(membership.communityId, communityId), eq(telegramAccount.tgUserId, 9403n)));

            expect(full).toEqual(['9401:in', '9402:in', '9403:waitlisted']);
            expect(after).toEqual(['9401:out', '9402:in', '9403:in']);
            expect(String(mention)).toContain('<a href="tg://user?id=9403">Voter 9403</a>');
            expect(member?.membership.status).toBe('active');
        })
    );

    it.effect('ignores an unknown poll, a repeated update and votes after the game is cancelled', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { pollId, sessionId } = yield* postedGame('votes-ignored', -6002, 902, '5');
            yield* deliver(answer('unknown-poll', 9501, [0]));
            const repeated = { update_id: 987_654, ...answer(pollId, 9502, [0]) };
            yield* deliver(repeated);
            yield* db.update(signup).set({ status: 'out' }).where(eq(signup.sessionId, sessionId));
            yield* deliver(repeated);
            const repeatedOnce = yield* statusesOf(sessionId);
            yield* db.update(session).set({ status: 'cancelled' }).where(eq(session.id, sessionId));
            yield* deliver(answer(pollId, 9503, [0]));

            expect(repeatedOnce).toEqual(['9502:out']);
            expect(yield* statusesOf(sessionId)).toEqual(['9502:out']);
        })
    );

    it.effect('gives the last place to one of two votes arriving together and counts two accounts of one person once', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { pollId, sessionId } = yield* postedGame('votes-race', -6003, 903, '1');
            yield* Effect.all([deliver(answer(pollId, 9601, [0])), deliver(answer(pollId, 9602, [0]))], { concurrency: 2 });
            const raced = yield* statusesOf(sessionId);
            const personId = yield* upsertTelegramUser({ id: 9603n, firstName: 'Twin' });
            yield* db.insert(telegramAccount).values({ tgUserId: 9604n, personId, firstName: 'Twin second' });
            yield* deliver(answer(pollId, 9603, [0]));
            yield* deliver(answer(pollId, 9604, [0]));
            const rows = yield* db
                .select()
                .from(signup)
                .where(and(eq(signup.sessionId, sessionId), eq(signup.personId, personId)));

            expect(raced.toSorted()).toEqual(['9601:in', '9602:waitlisted']);
            expect(rows).toHaveLength(1);
        })
    );

    it.effect('applies poll answers in the order Telegram delivers them', () =>
        Effect.gen(function* () {
            const { pollId, sessionId } = yield* postedGame('votes-order', -6004, 904, '5');
            yield* deliver(answer(pollId, 9701, [0]));
            yield* deliver(answer(pollId, 9701, []));
            yield* deliver(answer(pollId, 9701, [1]));
            yield* deliver(answer(pollId, 9701, [0]));

            expect(yield* statusesOf(sessionId)).toEqual(['9701:in']);
        })
    );
});
