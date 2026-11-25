import { expect, layer } from '@effect/vitest';
import { messageRef, pendingAction, telegramPoll } from '@rondo/db/schema/platform.schema';
import { team } from '@rondo/db/schema/play.schema';
import { session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { refusal } from '@rondo/telegram/testing/recording-telegram.layer';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Predicate from 'effect/Predicate';

import { describeAction } from '../src/actions/describe-action';
import { decideAction, proposeAction } from '../src/actions/pending-action.service';
import { createSession } from '../src/sessions/session.service';
import { publishPoll } from '../src/signups/publish-poll';
import { recordedTelegramDbLayer, recorder } from '../src/testing/recorded-telegram.layer';
import { seedCommunity, seedConfig } from '../src/testing/seed-community';

import type { Action } from '../src/actions/action.model';

const admin = 42n;
const group = { chatId: -100n, topicId: null };
const gameOf = (communityId: string) => ({
    communityId,
    timezone: 'Europe/Vienna',
    localDate: '2026-12-05',
    localTime: '10:00',
    venueId: null,
    capacityMax: null,
    title: null,
    actorPersonId: null
});
const createAction: Action = {
    _tag: 'create_session',
    localDate: '2026-12-05',
    localTime: '10:00',
    venueId: null,
    capacityMax: 16,
    title: null,
    announce: true
};

const decide = (actionId: string) =>
    decideAction({
        actionId,
        tgUserId: admin,
        confirm: true,
        context: communityId =>
            Effect.succeed({
                communityId,
                timezone: 'Europe/Vienna',
                group: Option.fromNullishOr(group),
                groupLocale: 'uk',
                actorPersonId: null
            })
    });

const confirm = Effect.fn('test.confirm')(function* (communityId: string, action: Action) {
    const db = yield* Db;
    const summary = yield* describeAction(action, 'uk', communityId).pipe(Effect.orElseSucceed(() => action._tag));
    const actionId = yield* proposeAction({ communityId, tgUserId: admin, action, summary });
    const outcome = yield* decide(actionId);
    const [stored] = yield* db.select().from(pendingAction).where(eq(pendingAction.id, actionId));

    return { actionId, outcome, status: stored?.status, result: stored?.result };
});

const reasonIn = (value: unknown): string => (Predicate.hasProperty(value, 'reason') ? String(value.reason) : '');

const countOfCalls = (method: string) => recorder.calls.filter(call => call.method === method).length;

const failing = <Value, Failure, Requirements>(method: string, error: Error, effect: Effect.Effect<Value, Failure, Requirements>) =>
    Effect.sync(() => recorder.failures.set(method, error)).pipe(
        Effect.andThen(effect),
        Effect.ensuring(Effect.sync(() => recorder.failures.delete(method)))
    );

const gamesOf = Effect.fn('test.gamesOf')(function* (communityId: string) {
    const db = yield* Db;

    return yield* db.select().from(session).where(eq(session.communityId, communityId));
});

layer(recordedTelegramDbLayer, { timeout: 60_000 })('publishing a poll', it => {
    it.effect('leaves no game when Telegram refuses the poll', () =>
        Effect.gen(function* () {
            const { communityId } = yield* seedCommunity(seedConfig('publish-refused-fc'));
            const refused = refusal('sendPoll', 'Bad Request: not enough rights to send polls');
            const { outcome, status } = yield* failing('sendPoll', refused, confirm(communityId, createAction));

            expect(outcome._tag).toBe('failed');
            expect(reasonIn(outcome)).toContain('not enough rights to send polls');
            expect(status).toBe('failed');
            expect(yield* gamesOf(communityId)).toEqual([]);
        })
    );

    it.effect('reports an unknown result and never sends again', () =>
        Effect.gen(function* () {
            const { communityId } = yield* seedCommunity(seedConfig('publish-timeout-fc'));
            const before = countOfCalls('sendPoll');
            const timeout = new Error("Request to 'sendPoll' timed out after 10 seconds");
            const { actionId, outcome, status, result } = yield* failing('sendPoll', timeout, confirm(communityId, createAction));
            const again = yield* decide(actionId);

            expect(outcome._tag).toBe('failed');
            expect(reasonIn(outcome)).toContain('uncertain, check the group');
            expect(status).toBe('failed');
            expect(reasonIn(result)).toContain('uncertain, check the group');
            expect(again._tag).toBe('missing');
            expect(countOfCalls('sendPoll') - before).toBe(1);
            expect(yield* gamesOf(communityId)).toEqual([]);
        })
    );

    it.effect('closes the poll when a write after the send fails', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedCommunity(seedConfig('publish-write-fc'));
            const publish = Effect.flip(
                publishPoll({
                    communityId,
                    group,
                    note: null,
                    approvedSummary: null,
                    prepare: createSession(gameOf(communityId)),
                    settle: () => Effect.fail('the result was not written')
                })
            );
            const closed = yield* publish;
            const stopped = recorder.calls.at(-1);
            const left = yield* failing('stopPoll', new Error('no answer'), publish);
            const polls = yield* db.select().from(telegramPoll).where(eq(telegramPoll.chatId, group.chatId));
            const messages = yield* db.select().from(messageRef).where(eq(messageRef.chatId, group.chatId));

            expect(reasonIn(closed)).toContain('was closed');
            expect(stopped?.method).toBe('stopPoll');
            expect(reasonIn(left)).toContain('check the group');
            expect(yield* gamesOf(communityId)).toEqual([]);
            expect([...polls, ...messages]).toEqual([]);
        })
    );

    it.effect('refuses a game that is over and a poll that is too long before anything is sent', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedCommunity(seedConfig('publish-early-fc'));
            const sessionId = yield* createSession(gameOf(communityId));
            yield* db.update(session).set({ status: 'cancelled' }).where(eq(session.id, sessionId));
            const before = countOfCalls('sendPoll');
            const over = yield* confirm(communityId, { _tag: 'announce_session', sessionId });
            const long = yield* confirm(communityId, { ...createAction, note: 'x'.repeat(300) });

            expect(over.outcome).toMatchObject({ _tag: 'failed', reason: 'the game is already over or cancelled' });
            expect(long.outcome._tag).toBe('failed');
            expect(reasonIn(long.outcome)).toContain('300');
            expect(countOfCalls('sendPoll')).toBe(before);
            expect(yield* gamesOf(communityId)).toHaveLength(1);
        })
    );

    it.effect('posts one poll per game and only the poll the admin saw', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedCommunity(seedConfig('publish-once-fc'));
            const sessionId = yield* createSession(gameOf(communityId));
            const announce: Action = { _tag: 'announce_session', sessionId };
            const summary = yield* describeAction(announce, 'uk', communityId);
            const actionId = yield* proposeAction({ communityId, tgUserId: admin, action: announce, summary });
            const before = countOfCalls('sendPoll');
            const shorter = yield* proposeAction({
                communityId,
                tgUserId: admin,
                action: announce,
                summary: summary.replace('\n\n', '\n\nMore\n\n')
            });
            const prefixed = yield* decide(shorter);
            yield* db.update(session).set({ capacityMax: 9 }).where(eq(session.id, sessionId));
            const changed = yield* decide(actionId);
            const sentChanged = countOfCalls('sendPoll') - before;
            const first = yield* confirm(communityId, announce);
            const second = yield* confirm(communityId, announce);

            expect(reasonIn(prefixed)).toContain('changed after the preview');
            expect(reasonIn(changed)).toContain('changed after the preview');
            expect(sentChanged).toBe(0);
            expect(first.outcome._tag).toBe('done');
            expect(reasonIn(second.outcome)).toContain('already has an open poll');
            expect(countOfCalls('sendPoll') - before).toBe(1);
        })
    );

    it.effect('keeps the poll open when the lost commit was saved', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedCommunity(seedConfig('publish-commit-fc'));
            const sessionId = yield* createSession(gameOf(communityId));
            const before = countOfCalls('stopPoll');
            const last = yield* confirm(communityId, { ...createAction, localTime: '11:00' });
            const messageId = Predicate.hasProperty(last.result, 'messageId') ? Number(last.result.messageId) + 2 : 0;
            yield* db.insert(telegramPoll).values({
                pollId: 'committed',
                chatId: group.chatId,
                messageId,
                sessionId,
                closedAt: new Date(),
                options: ['in', 'out']
            });
            const result = yield* publishPoll({
                communityId,
                group,
                note: null,
                approvedSummary: null,
                prepare: Effect.succeed(sessionId),
                settle: () => Effect.fail('the connection dropped')
            });

            expect(result).toEqual({ sessionId, messageId });
            expect(countOfCalls('stopPoll')).toBe(before);
        })
    );

    it.effect('keeps the posted teams when Telegram refuses new ones', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedCommunity(seedConfig('publish-teams-fc'));
            const sessionId = yield* createSession(gameOf(communityId));
            const teamsOf = (strength: number): Action => ({
                _tag: 'publish_teams',
                sessionId,
                teams: [{ ordinal: 1, players: [], strength }]
            });
            yield* confirm(communityId, teamsOf(5));
            const refused = refusal('sendMessage', 'Bad Request: not enough rights');
            const { outcome } = yield* failing('sendMessage', refused, confirm(communityId, teamsOf(6)));
            const stored = yield* db.select().from(team).where(eq(team.sessionId, sessionId));

            expect(outcome._tag).toBe('failed');
            expect(stored.map(row => Number(row.predictedStrength))).toEqual([5]);
            expect(stored[0]?.publishedAt).toBeInstanceOf(Date);
        })
    );

    it.effect('keeps the poll when it cannot be pinned', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedCommunity(seedConfig('publish-pin-fc'));
            const refused = refusal('pinChatMessage', 'Bad Request: not enough rights to manage pinned messages in the chat');
            const { outcome, status, result } = yield* failing('pinChatMessage', refused, confirm(communityId, createAction));
            const [game] = yield* gamesOf(communityId);
            const [poll] = yield* db
                .select()
                .from(telegramPoll)
                .where(eq(telegramPoll.sessionId, game?.id ?? ''));

            expect(outcome._tag).toBe('done');
            expect(status).toBe('confirmed');
            expect(result).toEqual({ sessionId: game?.id, messageId: poll?.messageId });
            expect(poll?.options).toEqual(['in', 'out']);
        })
    );

    it.effect('reports a confirmation that was cut off instead of running it again', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedCommunity(seedConfig('publish-cut-fc'));
            const actionId = yield* proposeAction({ communityId, tgUserId: admin, action: createAction, summary: 'create' });
            yield* db
                .update(pendingAction)
                .set({ status: 'confirmed', decidedAt: new Date(0) })
                .where(eq(pendingAction.id, actionId));
            const running = yield* decide(actionId);
            yield* db
                .update(pendingAction)
                .set({ decidedAt: new Date(-66_000) })
                .where(eq(pendingAction.id, actionId));
            const outcome = yield* decide(actionId);
            const [stored] = yield* db.select().from(pendingAction).where(eq(pendingAction.id, actionId));

            expect(running._tag).toBe('missing');
            expect(outcome._tag).toBe('failed');
            expect(reasonIn(outcome)).toContain('uncertain, check the group');
            expect(stored?.status).toBe('failed');
            expect(yield* gamesOf(communityId)).toEqual([]);
        })
    );
});
