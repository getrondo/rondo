import { expect, layer } from '@effect/vitest';
import { community, telegramChat } from '@rondo/db/schema/org.schema';
import { messageRef, telegramPoll } from '@rondo/db/schema/platform.schema';
import { session, signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { refusal } from '@rondo/telegram/testing/recording-telegram.layer';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as TestClock from 'effect/testing/TestClock';

import { grantAdmin } from '../src/access/admin-access';
import { describeAction } from '../src/actions/describe-action';
import { groupsTouched } from '../src/actions/groups-touched';
import { linkChat } from '../src/community/chat-links';
import { loadGroups } from '../src/community/group-settings';
import { syncMember } from '../src/identity/telegram-user';
import { closeFinishedPolls } from '../src/signups/signup.service';
import { writeToChat } from '../src/telegram/write-to-chat';
import { withdrawAs } from '../src/testing/confirm-action';
import { seedCommunity, seedConfig } from '../src/testing/seed-community';

import {
    actionRow,
    confirmAsOwner,
    decide,
    helped,
    linkGroup,
    ownerApproval,
    proposeAs,
    recordedTelegramDbLayer,
    recorder,
    sentTo,
    untilSent
} from './support/helped-group';

import type { Action } from '../src/actions/action.model';

const decidedAt = new Date('2026-12-01T10:00:00Z');

const cancelOf = (sessionId: string, notify = false): Action => ({ _tag: 'cancel_session', sessionId, reason: 'weather', notify });

const copyIn = Effect.fn('test.copyIn')(function* (sessionId: string, chatId: number) {
    const db = yield* Db;
    yield* db
        .insert(messageRef)
        .values({ chatId: BigInt(chatId), messageId: 900, purpose: 'poll', entityType: 'session', entityId: sessionId });
});

const gameStatus = Effect.fn('test.gameStatus')(function* (sessionId: string) {
    const db = yield* Db;
    const [row] = yield* db.select({ status: session.status }).from(session).where(eq(session.id, sessionId));

    return row?.status;
});

layer(recordedTelegramDbLayer, { timeout: 60_000 })('the terms of a closure', it => {
    it.effect('refuse a poll whose copy is in a group that is not linked any more, and say it stays open', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, sessionId } = yield* helped('terms-unlinked', -9201, 9201);
            yield* db.insert(telegramPoll).values({ pollId: 'terms-unlinked', chatId: 42n, messageId: 1, sessionId, options: ['in'] });
            yield* copyIn(sessionId, -9201);
            yield* db.delete(telegramChat).where(eq(telegramChat.chatId, -9201n));
            const before = sentTo(42, 'stopPoll');
            const done = yield* confirmAsOwner(communityId, cancelOf(sessionId));

            expect(done).toMatchObject({ _tag: 'done', openIn: '❓' });
            expect(sentTo(42, 'stopPoll')).toBe(before);
        })
    );

    it.effect('are the poll and the groups that were shown, for the ✅ and for the nightly job', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, sessionId } = yield* helped('terms-shown', -9211, 9211);
            yield* linkGroup(communityId, { chatId: -9212, title: 'Second', purpose: 'other' });
            yield* confirmAsOwner(communityId, { _tag: 'announce_session', sessionId, chatId: '-9211' });
            const shown = yield* proposeAs(communityId, 42n, cancelOf(sessionId));
            const row = yield* actionRow(shown);
            yield* copyIn(sessionId, -9212);
            const changed = yield* decide(shown, 42n, new Date(0));
            const status = yield* gameStatus(sessionId);
            yield* db.delete(messageRef).where(eq(messageRef.chatId, -9212n));
            recorder.failures.set('stopPoll', refusal('stopPoll', 'Bad Gateway', 502));
            yield* confirmAsOwner(communityId, cancelOf(sessionId));
            recorder.failures.delete('stopPoll');
            const tried = sentTo(-9211, 'stopPoll');
            yield* copyIn(sessionId, -9212);
            yield* closeFinishedPolls();

            expect(row?.payload).toMatchObject({ closes: { chatIds: ['-9211'] } });
            expect(row?.summary).toContain('в пересланих копіях: «Main»');
            expect(changed).toMatchObject({ failure: { code: 'preview_changed' } });
            expect(status).toBe('open');
            expect(tried).toBe(1);
            expect(sentTo(-9211, 'stopPoll')).toBe(1);
        })
    );

    it.effect('of a played game are those of the very poll that got the ✅', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, sessionId } = yield* helped('terms-poll', -9221, 9221);
            yield* confirmAsOwner(communityId, { _tag: 'announce_session', sessionId, chatId: '-9221' });
            yield* db.update(telegramPoll).set({ closedAt: new Date() }).where(eq(telegramPoll.sessionId, sessionId));
            yield* db.insert(telegramPoll).values({ pollId: 'terms-other', chatId: -9221n, messageId: 99, sessionId, options: ['in'] });
            yield* db.update(session).set({ status: 'played' }).where(eq(session.id, sessionId));
            yield* closeFinishedPolls();

            expect(sentTo(-9221, 'stopPoll')).toBe(0);
        })
    );
});

layer(recordedTelegramDbLayer, { timeout: 60_000 })('the terms of a write', it => {
    it.effect('are its deadline and the kick-off of now, also after a rate limit', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { sessionId } = yield* helped('terms-late', -9231, 9231);
            const target = { chatId: -9231n, topicId: null };
            const forward = { _tag: 'forward', fromChatId: 42n, messageId: 1, sessionId } as const;
            const late = yield* writeToChat({
                target,
                approval: { ...ownerApproval, expiresAt: new Date(-1) },
                content: { _tag: 'text', html: 'x', hasLinkPreview: false }
            }).pipe(Effect.flip);
            recorder.failures.set('forwardMessage', refusal('forwardMessage', 'Too Many Requests: retry after 2', 429, 2));
            const write = writeToChat({ target, approval: ownerApproval, content: forward }).pipe(Effect.flip);
            const start = Effect.gen(function* () {
                yield* untilSent(-9231, 'forwardMessage');
                recorder.failures.delete('forwardMessage');
                yield* db
                    .update(session)
                    .set({ startsAt: new Date(-1) })
                    .where(eq(session.id, sessionId));
                yield* TestClock.adjust('3 seconds');
            });
            const [started] = yield* Effect.all([write, start], { concurrency: 'unbounded' });
            const poll = { question: 'q', answers: ['a', 'b'], place: null, route: null, description: null, descriptionText: null };
            const asked = yield* writeToChat({ target, approval: ownerApproval, content: { _tag: 'poll', poll, sessionId } }).pipe(
                Effect.flip
            );

            expect(late).toMatchObject({ failure: { code: 'not_approved' } });
            expect(started).toMatchObject({ failure: { code: 'time_passed' } });
            expect(asked).toMatchObject({ failure: { code: 'time_passed' } });
            expect(sentTo(-9231, 'forwardMessage')).toBe(1);
        })
    );

    it.effect('come from the proposal: a ✅ whose time ran out before the send posts nothing', () =>
        Effect.gen(function* () {
            const { communityId, sessionId } = yield* helped('terms-deadline', -9261, 9261);
            const actionId = yield* proposeAs(communityId, 42n, { _tag: 'announce_session', sessionId, chatId: '-9261' });
            yield* TestClock.adjust('31 minutes');
            const late = yield* decide(actionId, 42n, new Date(0));

            expect(late).toMatchObject({ _tag: 'failed', failure: { code: 'not_approved' } });
            expect(sentTo(-9261, 'sendPoll')).toBe(0);
        })
    );
});

layer(recordedTelegramDbLayer, { timeout: 60_000 })('the settings of the groups', it => {
    it.effect('name an organizer or owner as the approver, and a reconnected group keeps its topic', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedCommunity(seedConfig('terms-load'));
            const personId = yield* syncMember(communityId, { id: 9241n, firstName: 'Member' }, 'active');
            const file = {
                slug: 'terms-load',
                approverTgUserId: 9241,
                chats: [{ chatId: -9241, title: 'G', purpose: 'main' as const, weekdays: [], topicId: 3 }]
            };
            const member = yield* loadGroups(file).pipe(Effect.flip);
            const [before] = yield* db.select().from(community).where(eq(community.id, communityId));
            yield* grantAdmin({ communityId, personId, grantedBy: null });
            yield* loadGroups(file);
            const link = { communityId, chatId: -9241n, title: 'G', type: 'supergroup', actorPersonId: null };
            yield* linkChat(link);
            const [first] = yield* db.select().from(telegramChat).where(eq(telegramChat.chatId, -9241n));
            yield* linkChat({ ...link, topicId: 8 });
            yield* linkChat({ ...link, type: 'group' });
            const [again] = yield* db.select().from(telegramChat).where(eq(telegramChat.chatId, -9241n));

            expect(member).toMatchObject({ failure: { code: 'not_admin' } });
            expect(before?.approverTgUserId).toBeNull();
            expect(before?.settings).not.toHaveProperty('groups');
            expect([first?.topicId, again?.topicId]).toEqual([3, 8]);
            expect([first?.kind, again?.kind]).toEqual(['supergroup', 'group']);
        })
    );
});

layer(recordedTelegramDbLayer, { timeout: 60_000 })('a passed-on notice', it => {
    it.effect('whose mentions changed comes back refreshed, and only the fresh one is sent', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, sessionId, ask } = yield* helped('terms-fresh', -9251, 9251);
            yield* confirmAsOwner(communityId, { _tag: 'announce_session', sessionId, chatId: '-9251' });
            const old = yield* ask(cancelOf(sessionId, true));
            yield* decide(old, 9251n);
            const personId = yield* syncMember(communityId, { id: 9252n, firstName: 'Newcomer' }, 'active');
            yield* db.insert(signup).values({ sessionId, personId, status: 'in' });
            const fresh = yield* decide(old, 42n);
            const request = fresh._tag === 'awaiting' ? fresh.request : null;
            const replaced = yield* actionRow(old);
            const early = sentTo(-9251, 'sendMessage');
            const stale = yield* decide(old, 42n);
            const mine = yield* decide(request?.actionId ?? old, 9251n);
            const done = yield* decide(request?.actionId ?? old, 42n);

            expect(request).toMatchObject({ requestedBy: 9251n, approver: { tgUserId: 42n } });
            expect(request?.summary).toContain('Newcomer');
            expect(replaced?.status).toBe('expired');
            expect(early).toBe(0);
            expect([stale._tag, mine._tag]).toEqual(['expired', 'missing']);
            expect(done).toMatchObject({ _tag: 'done', requestedBy: 9251n });
            expect(sentTo(-9251, 'sendMessage')).toBe(1);
        })
    );
});

layer(recordedTelegramDbLayer, { timeout: 60_000 })('a closure of its own', it => {
    it.effect('opens a switched off group for the closing of the shown poll only', () =>
        Effect.gen(function* () {
            const { communityId, sessionId } = yield* helped('terms-own', -9271, 9271);
            yield* confirmAsOwner(communityId, { _tag: 'announce_session', sessionId, chatId: '-9271' });
            const quiet = yield* describeAction({ _tag: 'delete_session', sessionId }, 'uk', communityId);
            yield* linkGroup(communityId, { chatId: -9271, isPosting: false });
            const closed = cancelOf(sessionId);
            const row = yield* proposeAs(communityId, 42n, closed).pipe(Effect.flatMap(actionId => actionRow(actionId)));
            const target = { chatId: -9271n, topicId: null };
            const approval = { ...ownerApproval, isClosure: true, closes: { pollIds: ['x'], chatIds: ['-9271'] } };
            const text = { _tag: 'text', html: 'x', hasLinkPreview: false } as const;
            const refusals = yield* Effect.all([
                writeToChat({ target, approval, content: text }).pipe(Effect.flip),
                writeToChat({ target, approval, content: { _tag: 'pin', messageId: 1 } }).pipe(Effect.flip),
                writeToChat({ target, approval: { ...approval, tgUserId: 9271n }, content: { _tag: 'stop_poll', messageId: 1 } }).pipe(
                    Effect.flip
                )
            ]);

            expect(refusals).toMatchObject([
                { failure: { code: 'group_off' } },
                { failure: { code: 'group_off' } },
                { failure: { code: 'not_approved' } }
            ]);
            expect(quiet).not.toMatch(/опитування/iu);
            expect(row?.summary).toContain('Опитування лишиться відкритим: «Main»');
        })
    );

    it.effect('and line-ups are matched to their groups by id, also when two groups have one name', () =>
        Effect.gen(function* () {
            const { communityId, sessionId } = yield* helped('terms-names', -9281, 9281);
            yield* linkGroup(communityId, { chatId: -9282, purpose: 'other' });
            const action: Action = {
                _tag: 'publish_teams',
                sessionId,
                teams: [],
                version: 1,
                fingerprint: '',
                preview: { text: '', to: ['Main'], chatIds: ['-9282'], clearsResult: false }
            };
            const touched = yield* groupsTouched(action, { communityId, group: Option.none() });

            expect(touched.map(({ chatId }) => chatId)).toEqual([-9282n]);
        })
    );

    it.effect('and a request that was refreshed can still be withdrawn, by who asked only', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, sessionId, ask } = yield* helped('terms-withdraw', -9291, 9291);
            yield* confirmAsOwner(communityId, { _tag: 'announce_session', sessionId, chatId: '-9291' });
            const old = yield* ask(cancelOf(sessionId, true));
            yield* decide(old, 9291n);
            const personId = yield* syncMember(communityId, { id: 9292n, firstName: 'Newcomer' }, 'active');
            yield* db.insert(signup).values({ sessionId, personId, status: 'in' });
            const fresh = yield* decide(old, 42n);
            const again = fresh._tag === 'awaiting' ? fresh.request.actionId : old;
            const guest = yield* syncMember(communityId, { id: 9293n, firstName: 'Second' }, 'active');
            yield* db.insert(signup).values({ sessionId, personId: guest, status: 'in' });
            const latest = yield* decide(again, 42n);
            const foreign = yield* withdrawAs(old, 9292n, decidedAt);
            const own = yield* withdrawAs(old, 9291n, decidedAt);
            const late = yield* decide(latest._tag === 'awaiting' ? latest.request.actionId : old, 42n);

            expect([fresh._tag, latest._tag, foreign._tag, late._tag]).toEqual(['awaiting', 'awaiting', 'missing', 'missing']);
            expect(own).toMatchObject({ _tag: 'rejected', requestedBy: 9291n });
            expect(sentTo(-9291, 'sendMessage')).toBe(0);
        })
    );
});
