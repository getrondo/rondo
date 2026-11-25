import { expect, layer } from '@effect/vitest';
import { telegramAccount } from '@rondo/db/schema/identity.schema';
import { community, telegramChat } from '@rondo/db/schema/org.schema';
import { messageRef, pendingAction, telegramPoll } from '@rondo/db/schema/platform.schema';
import { session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { refusal } from '@rondo/telegram/testing/recording-telegram.layer';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import * as TestClock from 'effect/testing/TestClock';

import { grantAdmin } from '../src/access/admin-access';
import { takeExpiredRequests } from '../src/actions/pending-action.service';
import { linkChat, setChatSwitch } from '../src/community/chat-links';
import { isApproverOf, knownChatsOf, loadGroups } from '../src/community/group-settings';
import { syncMember } from '../src/identity/telegram-user';
import { mergePeople } from '../src/people/people.service';
import { createSession } from '../src/sessions/session.service';
import { closeFinishedPolls } from '../src/signups/signup.service';
import { writeToChat } from '../src/telegram/write-to-chat';
import { confirmAsOwner, decideAs, proposeAs } from '../src/testing/confirm-action';
import { linkGroup, ownerApproval } from '../src/testing/link-group';
import { recordedTelegramDbLayer, recorder } from '../src/testing/recorded-telegram.layer';
import { seedCommunity, seedConfig } from '../src/testing/seed-community';

import type { Action } from '../src/actions/action.model';

const sentTo = (chatId: number, method: string) =>
    recorder.calls.filter(call => call.payload.chat_id === chatId && call.method === method).length;

const decide = (actionId: string, tgUserId: bigint, now = new Date('2026-12-01T10:00:00Z')) => decideAs(actionId, tgUserId, now);

const helped = Effect.fn('test.helped')(function* (slug: string, chatId: number, helper: number) {
    const { communityId } = yield* seedCommunity(seedConfig(slug));
    yield* linkGroup(communityId, { chatId });
    const personId = yield* syncMember(communityId, { id: BigInt(helper), firstName: 'Helper' }, 'active');
    yield* grantAdmin({ communityId, personId, grantedBy: null });
    const sessionId = yield* createSession({
        communityId,
        timezone: 'Europe/Vienna',
        localDate: '2026-12-04',
        localTime: '19:00',
        venueId: null,
        capacityMax: 10,
        title: null,
        actorPersonId: null
    });

    return {
        communityId,
        sessionId,
        ask: (action: Action) =>
            Effect.gen(function* () {
                const db = yield* Db;
                const actionId = yield* proposeAs(communityId, BigInt(helper), action);
                // The time of the test is not the time of the database
                yield* db
                    .update(pendingAction)
                    .set({ createdAt: new Date('2026-12-01T09:59:00Z'), expiresAt: new Date('2026-12-01T10:30:00Z') })
                    .where(eq(pendingAction.id, actionId));

                return actionId;
            })
    };
});

const actionRow = Effect.fn('test.actionRow')(function* (actionId: string) {
    const db = yield* Db;
    const [row] = yield* db.select().from(pendingAction).where(eq(pendingAction.id, actionId));

    return row;
});

layer(recordedTelegramDbLayer, { timeout: 60_000 })('the approver', it => {
    it.effect('is one account, not its person, and nobody else may merge that person', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedCommunity(seedConfig('guard-merge'));
            const approver = yield* syncMember(communityId, { id: 9001n, firstName: 'Approver' }, 'active');
            const twin = yield* syncMember(communityId, { id: 9002n, firstName: 'Twin' }, 'active');
            yield* grantAdmin({ communityId, personId: approver, grantedBy: null });
            yield* loadGroups({ slug: 'guard-merge', approverTgUserId: 9001, chats: [] });
            const merge = { communityId, fromPersonId: twin, intoPersonId: approver, actorPersonId: null };
            const refused = yield* mergePeople({ ...merge, decidedBy: 9002n }).pipe(Effect.flip);
            yield* mergePeople({ ...merge, decidedBy: 9001n });
            const [account] = yield* db.select().from(telegramAccount).where(eq(telegramAccount.tgUserId, 9002n));

            expect(refused).toMatchObject({ failure: { code: 'approver_merge' } });
            expect(account?.personId).toBe(approver);
            expect(yield* isApproverOf(9001n, communityId)).toBe(true);
            expect(yield* isApproverOf(9002n, communityId)).toBe(false);
        })
    );

    it.effect('who was replaced can no longer decide what was passed on before', () =>
        Effect.gen(function* () {
            const { communityId, sessionId, ask } = yield* helped('guard-replaced', -9011, 9011);
            yield* syncMember(communityId, { id: 42n, firstName: 'Owner' }, 'active');
            const first = yield* ask({ _tag: 'announce_session', sessionId });
            const second = yield* ask({ _tag: 'announce_session', sessionId });
            yield* decide(first, 9011n);
            yield* decide(second, 9011n);
            yield* loadGroups({ slug: 'guard-replaced', approverTgUserId: 9011, chats: [] });
            const row = yield* actionRow(first);
            yield* loadGroups({ slug: 'guard-replaced', approverTgUserId: 42, chats: [] });
            const back = yield* decide(second, 42n);
            const told = yield* takeExpiredRequests();

            expect(row?.status).toBe('expired');
            expect(back._tag).toBe('expired');
            expect(told.map(({ requestedBy }) => requestedBy)).toEqual([9011n, 9011n]);
            expect(yield* takeExpiredRequests()).toEqual([]);
            expect(sentTo(-9011, 'sendPoll')).toBe(0);
        })
    );

    it.effect('is validated before anything is stored, and a chat of another community is refused', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedCommunity(seedConfig('guard-load'));
            const { communityId: foreignId } = yield* seedCommunity(seedConfig('guard-load-other'));
            yield* syncMember(communityId, { id: 9021n, firstName: 'Approver' }, 'active');
            yield* syncMember(foreignId, { id: 9022n, firstName: 'Other' }, 'active');
            const chat = (chatId: number) => ({ chatId, title: 'G', purpose: 'main' as const, weekdays: [] });
            const unknown = yield* loadGroups({ slug: 'guard-load', approverTgUserId: 777_777, chats: [chat(-9021)] }).pipe(Effect.flip);
            const outsider = yield* loadGroups({ slug: 'guard-load', approverTgUserId: 9022, chats: [chat(-9021)] }).pipe(Effect.flip);
            yield* loadGroups({ slug: 'guard-load-other', approverTgUserId: 9022, chats: [chat(-9022)] });
            yield* linkGroup(foreignId, { chatId: -9023 }, 9022);
            const known = yield* loadGroups({ slug: 'guard-load', approverTgUserId: 9021, chats: [chat(-9022)] }).pipe(Effect.flip);
            const linked = yield* loadGroups({ slug: 'guard-load', approverTgUserId: 9021, chats: [chat(-9023)] }).pipe(Effect.flip);
            const [row] = yield* db.select().from(community).where(eq(community.id, communityId));
            yield* loadGroups({ slug: 'guard-load', approverTgUserId: 9021, chats: [chat(-9024)] });
            yield* linkGroup(foreignId, { chatId: -9024 }, 9022);
            const stolen = yield* linkChat({ communityId, chatId: -9024n, title: 'G', actorPersonId: null }).pipe(Effect.flip);
            const [after] = yield* db.select().from(community).where(eq(community.id, communityId));

            expect([unknown, outsider].map(error => 'failure' in error && error.failure.code)).toEqual([
                'person_not_found',
                'person_not_found'
            ]);
            expect([known, linked].map(error => 'failure' in error && error.failure.code)).toEqual(['chat_not_linked', 'chat_not_linked']);
            expect(row).toMatchObject({ approverTgUserId: null });
            expect(row?.settings).not.toHaveProperty('groups');
            expect(stolen).toMatchObject({ failure: { code: 'chat_not_linked' } });
            expect(after?.liveSince).toBeNull();
            expect(yield* knownChatsOf(communityId)).toHaveLength(1);
        })
    );
});

layer(recordedTelegramDbLayer, { timeout: 60_000 })('closing a poll', it => {
    it.effect('needs the approver when a copy is in a linked group, and the nightly job needs that stored', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { sessionId, ask } = yield* helped('guard-close', -9031, 9031);
            const other = yield* helped('guard-close-private', -9032, 9032);
            yield* db.insert(telegramPoll).values([
                { pollId: 'guard-copied', chatId: 9031n, messageId: 31, sessionId, options: ['in', 'out'] },
                { pollId: 'guard-private', chatId: 9032n, messageId: 32, sessionId: other.sessionId, options: ['in', 'out'] }
            ]);
            yield* db
                .insert(messageRef)
                .values({ chatId: -9031n, messageId: 310, purpose: 'poll', entityType: 'session', entityId: sessionId });
            const cancel = (id: string): Action => ({ _tag: 'cancel_session', sessionId: id, reason: 'weather', notify: false });
            const copied = yield* ask(cancel(sessionId));
            const awaiting = yield* decide(copied, 9031n);
            const alone = yield* decide(yield* other.ask(cancel(other.sessionId)), 9032n);
            yield* db.update(session).set({ status: 'played' }).where(eq(session.id, sessionId));
            yield* closeFinishedPolls();
            const unapproved = sentTo(9031, 'stopPoll');
            yield* db.update(session).set({ status: 'open' }).where(eq(session.id, sessionId));
            recorder.failures.set('stopPoll', refusal('stopPoll', 'Bad Gateway', 502));
            yield* decide(copied, 42n);
            recorder.failures.delete('stopPoll');
            const tried = sentTo(9031, 'stopPoll');
            yield* closeFinishedPolls();

            expect(awaiting).toMatchObject({ _tag: 'awaiting', request: { groups: ['Main'] } });
            expect(awaiting._tag === 'awaiting' ? awaiting.request.summary : '').toContain('Опитування закриється і в пересланих копіях');
            expect(alone._tag).toBe('done');
            expect(sentTo(9032, 'stopPoll')).toBe(1);
            expect(unapproved).toBe(0);
            expect(tried).toBe(1);
            expect(sentTo(9031, 'stopPoll')).toBe(2);
        })
    );

    it.effect('leaves the poll of a switched off group open and says where', () =>
        Effect.gen(function* () {
            const { communityId, sessionId } = yield* helped('guard-off', -9041, 9041);
            yield* confirmAsOwner(communityId, { _tag: 'announce_session', sessionId });
            yield* linkGroup(communityId, { chatId: -9041, isPosting: false });
            const done = yield* confirmAsOwner(communityId, { _tag: 'cancel_session', sessionId, reason: 'weather', notify: false });

            expect(done).toMatchObject({ _tag: 'done', openIn: '«Main»' });
            expect(sentTo(-9041, 'stopPoll')).toBe(0);
        })
    );
});

layer(recordedTelegramDbLayer, { timeout: 60_000 })('a group write in progress', it => {
    it.effect('stops when the group is switched off while a rate limit is waited out', () =>
        Effect.gen(function* () {
            const { communityId } = yield* seedCommunity(seedConfig('guard-wait'));
            yield* linkGroup(communityId, { chatId: -9051 });
            recorder.failures.set('sendMessage', refusal('sendMessage', 'Too Many Requests: retry after 2', 429, 2));
            const fiber = yield* Effect.forkChild(
                writeToChat({
                    target: { chatId: -9051n, topicId: null },
                    approval: ownerApproval,
                    content: { _tag: 'text', html: 'x', hasLinkPreview: false }
                }).pipe(Effect.flip)
            );
            while (sentTo(-9051, 'sendMessage') === 0) {
                yield* Effect.promise(
                    async () =>
                        await new Promise<void>(resolve => {
                            setImmediate(resolve);
                        })
                );
            }
            recorder.failures.delete('sendMessage');
            yield* linkGroup(communityId, { chatId: -9051, isPosting: false });
            yield* TestClock.adjust('3 seconds');
            const stopped = yield* Fiber.join(fiber);

            expect(stopped).toMatchObject({ failure: { code: 'group_off' } });
            expect(sentTo(-9051, 'sendMessage')).toBe(1);
        })
    );

    it.effect('forwards the previewed poll and never one that took its place', () =>
        Effect.gen(function* () {
            const { communityId, sessionId } = yield* helped('guard-forward', -9061, 9061);
            yield* linkGroup(communityId, { chatId: -9062, title: 'Second', purpose: 'other' });
            yield* confirmAsOwner(communityId, { _tag: 'announce_session', sessionId });
            const other = yield* confirmAsOwner(communityId, { _tag: 'forward_poll', sessionId, chatId: '-9062', pollId: 'another' });

            expect(other).toMatchObject({ failure: { code: 'preview_changed' } });
            expect(sentTo(-9062, 'forwardMessage')).toBe(0);
        })
    );
});

layer(recordedTelegramDbLayer, { timeout: 60_000 })('a request', it => {
    it.effect('ends 30 minutes later after the kick-off, and at a kick-off that was moved forward', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { sessionId, ask } = yield* helped('guard-time', -9071, 9071);
            const action: Action = { _tag: 'cancel_session', sessionId, reason: 'weather', notify: false };
            yield* db.insert(telegramPoll).values({ pollId: 'guard-time', chatId: -9071n, messageId: 71, sessionId, options: ['in'] });
            const moved = yield* ask(action);
            yield* decide(moved, 9071n);
            const atKickoff = yield* actionRow(moved);
            yield* db
                .update(session)
                .set({ startsAt: new Date('2026-12-01T12:00:00Z') })
                .where(eq(session.id, sessionId));
            const late = yield* decide(moved, 42n, new Date('2026-12-01T12:30:00Z'));
            yield* db
                .update(session)
                .set({ startsAt: new Date('2026-12-01T08:00:00Z') })
                .where(eq(session.id, sessionId));
            const started = yield* ask(action);
            yield* decide(started, 9071n);
            const afterKickoff = yield* actionRow(started);
            const intime = yield* decide(started, 42n, new Date('2026-12-01T10:20:00Z'));

            expect(atKickoff?.expiresAt.toISOString()).toBe('2026-12-04T18:00:00.000Z');
            expect(late._tag).toBe('expired');
            expect(afterKickoff?.expiresAt.toISOString()).toBe('2026-12-01T10:30:00.000Z');
            expect(intime._tag).toBe('done');
        })
    );

    it.effect('for another group survives the opening of this one', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, sessionId } = yield* helped('guard-drain', -9081, 9081);
            yield* linkGroup(communityId, { chatId: -9082, title: 'Second', purpose: 'other' });
            const here = yield* proposeAs(communityId, 42n, { _tag: 'announce_session', sessionId, chatId: '-9082' });
            const there = yield* proposeAs(communityId, 42n, { _tag: 'announce_session', sessionId, chatId: '-9081' });
            const person = yield* proposeAs(communityId, 42n, { _tag: 'create_person', displayName: 'X' });
            yield* setChatSwitch({ communityId, chatId: -9082n, actorPersonId: null }, { isPosting: true });
            const rows = yield* Effect.all([here, there, person].map(id => actionRow(id)));
            const [second] = yield* db.select().from(telegramChat).where(eq(telegramChat.chatId, -9082n));

            expect(second?.isPosting).toBe(true);
            expect(rows.map(row => row?.status)).toEqual(['expired', 'proposed', 'proposed']);
        })
    );
});
