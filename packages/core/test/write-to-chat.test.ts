import { expect, layer } from '@effect/vitest';
import { person } from '@rondo/db/schema/identity.schema';
import { community, membership, telegramChat } from '@rondo/db/schema/org.schema';
import { noticeDelivery, pendingAction, telegramPoll } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { refusal } from '@rondo/telegram/testing/recording-telegram.layer';
import { eq, inArray } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { grantAdmin } from '../src/access/admin-access';
import { decideAction, proposeAction } from '../src/actions/pending-action.service';
import { linkChat, setChatSwitch, unlinkChat } from '../src/community/chat-links';
import { linkedChatsOf, mainGroupOf, moveChat } from '../src/community/community.repository';
import { approverOf, knownChatsOf, loadGroups } from '../src/community/group-settings';
import { syncMember, upsertTelegramUser } from '../src/identity/telegram-user';
import { createSession } from '../src/sessions/session.service';
import { writeToChat, type Approval } from '../src/telegram/write-to-chat';
import { confirmAsOwner, proposeAs } from '../src/testing/confirm-action';
import { linkGroup, ownerApproval } from '../src/testing/link-group';
import { recordedTelegramDbLayer, recorder } from '../src/testing/recorded-telegram.layer';
import { seedCommunity, seedConfig } from '../src/testing/seed-community';

const text = { _tag: 'text', html: 'hello', hasLinkPreview: false } as const;
const contents = [
    text,
    { _tag: 'edit', messageId: 1, html: 'hello' },
    { _tag: 'forward', fromChatId: 42n, messageId: 1 },
    { _tag: 'pin', messageId: 1 },
    { _tag: 'stop_poll', messageId: 1 },
    { _tag: 'poll', poll: { question: 'q', answers: ['a', 'b'], place: null, route: null, description: null, descriptionText: null } }
] as const;

const sentTo = (chatId: number) => recorder.calls.filter(call => call.payload.chat_id === chatId);

const write = (chatId: number, approval: Approval | null, content: (typeof contents)[number] = text, topicId: number | null = null) =>
    writeToChat({ target: { chatId: BigInt(chatId), topicId }, approval, content }).pipe(
        Effect.as('sent'),
        Effect.catchTag('ActionFailedError', ({ failure }) => Effect.succeed(failure.code))
    );

const gameOf = (communityId: string, localDate: string) =>
    createSession({
        communityId,
        timezone: 'Europe/Vienna',
        localDate,
        localTime: '19:00',
        venueId: null,
        capacityMax: 10,
        title: null,
        actorPersonId: null
    });

layer(recordedTelegramDbLayer, { timeout: 60_000 })('every write to a group', it => {
    it.effect('is refused unless the group is linked, switched on and the approver allowed it', () =>
        Effect.gen(function* () {
            const { communityId } = yield* seedCommunity(seedConfig('gate-fc'));
            const foreign = yield* seedCommunity(seedConfig('gate-foreign-fc'));
            yield* linkGroup(communityId, { chatId: -8801, isPosting: false, isMentioning: false });
            const unlinked = yield* Effect.all(contents.map(content => write(-8800, ownerApproval, content)));
            const off = yield* Effect.all(contents.map(content => write(-8801, ownerApproval, content)));
            yield* linkGroup(communityId, { chatId: -8801, isMentioning: false, topicId: 5 });
            const nobody = yield* Effect.all(contents.map(content => write(-8801, null, content)));
            const stranger = yield* Effect.all(contents.map(content => write(-8801, { _tag: 'approver', tgUserId: 7n }, content)));
            const switches = yield* Effect.all(contents.map(content => write(-8801, { _tag: 'mention' }, content)));
            const early = sentTo(-8800).length + sentTo(-8801).length;
            const topic = yield* write(-8801, ownerApproval, text);
            const upkeep = yield* Effect.all(contents.map(content => write(-8801, { _tag: 'upkeep' }, content)));
            const approved = yield* Effect.all(contents.map(content => write(-8801, ownerApproval, content, 5)));
            yield* linkGroup(foreign.communityId, { chatId: -8802 }, 4242);
            const elsewhere = yield* write(-8802, ownerApproval);
            const privately = yield* write(42, null);

            expect(new Set([...unlinked, ...off])).toEqual(new Set(['group_off']));
            expect(new Set([...nobody, ...stranger, ...switches])).toEqual(new Set(['not_approved']));
            expect(early).toBe(0);
            expect(topic).toBe('preview_changed');
            expect(upkeep.filter(code => code === 'sent')).toHaveLength(1);
            expect(new Set(approved)).toEqual(new Set(['sent']));
            expect(elsewhere).toBe('not_approved');
            expect(privately).toBe('sent');
        })
    );

    it.effect('needs an approver who is still an admin and was not erased', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedCommunity(seedConfig('gate-approver-fc'));
            yield* linkGroup(communityId, { chatId: -8811 }, 8811);
            const approval = { _tag: 'approver', tgUserId: 8811n } as const;
            const notAdmin = yield* write(-8811, approval);
            const personId = yield* upsertTelegramUser({ id: 8811n, firstName: 'Approver' });
            yield* grantAdmin({ communityId, personId, grantedBy: null });
            const admin = yield* write(-8811, approval);
            yield* db.update(person).set({ anonymizedAt: new Date() }).where(eq(person.id, personId));
            const erased = yield* write(-8811, approval);

            expect([notAdmin, admin, erased]).toEqual(['not_approved', 'sent', 'not_approved']);
            expect(Option.isNone(yield* approverOf(communityId))).toBe(true);
        })
    );

    it.effect('sends exactly the approved notice once to each destination and keeps a receipt of each', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedCommunity(seedConfig('gate-notice-fc'));
            yield* linkGroup(communityId, { chatId: -8821, title: 'First' });
            yield* linkGroup(communityId, { chatId: -8822, title: 'Second', purpose: 'other' });
            const sessionId = yield* gameOf(communityId, '2026-12-04');
            yield* confirmAsOwner(communityId, { _tag: 'announce_session', sessionId });
            yield* confirmAsOwner(communityId, { _tag: 'forward_poll', sessionId, chatId: '-8822' });
            const actionId = yield* proposeAs(communityId, 42n, { _tag: 'update_session', sessionId, localTime: '20:00', notify: true });
            const [proposed] = yield* db.select().from(pendingAction).where(eq(pendingAction.id, actionId));
            recorder.failures.set('sendMessage', refusal('sendMessage', 'Forbidden: bot was kicked', 403));
            const refused = yield* confirmAsOwner(communityId, { _tag: 'update_session', sessionId, localTime: '19:30', notify: true });
            recorder.failures.delete('sendMessage');
            const before = recorder.calls.length;
            const stale = yield* decideAction({
                actionId,
                tgUserId: 42n,
                confirm: true,
                context: id =>
                    Effect.succeed({
                        communityId: id,
                        timezone: 'Europe/Vienna',
                        group: Option.none(),
                        groupLocale: 'uk',
                        actorPersonId: null
                    })
            });
            const afterStale = recorder.calls.length;
            const done = yield* confirmAsOwner(communityId, { _tag: 'update_session', sessionId, localTime: '20:30', notify: true });
            const notices = recorder.calls.slice(before).filter(call => call.method === 'sendMessage');
            const receipts = yield* db
                .select({ chatId: noticeDelivery.chatId, status: noticeDelivery.status, payload: pendingAction.payload })
                .from(noticeDelivery)
                .innerJoin(pendingAction, eq(pendingAction.id, noticeDelivery.actionId))
                .where(inArray(noticeDelivery.chatId, [-8821n, -8822n]))
                .orderBy(pendingAction.createdAt);
            const html = JSON.stringify(receipts.at(-1)?.payload);

            expect(proposed?.summary).toContain('🕐 Час: 19:00 → 20:00');
            expect(refused).toMatchObject({ _tag: 'failed', failure: { code: 'notice_missed', chats: '«First», «Second»' } });
            expect(stale).toMatchObject({ _tag: 'failed', failure: { code: 'preview_changed' } });
            expect(afterStale).toBe(before);
            expect(done._tag).toBe('done');
            expect(notices.map(call => call.payload.chat_id)).toEqual([-8821, -8822]);
            expect(notices.every(call => html.includes(JSON.stringify(call.payload.text).slice(1, -1)))).toBe(true);
            expect(receipts.map(row => row.status)).toEqual(['refused', 'refused', 'sent', 'sent']);
        })
    );
});

layer(recordedTelegramDbLayer, { timeout: 60_000 })('a request to the approver', it => {
    it.effect('passes a group action to the approver, who alone decides it, and two for one game post one poll', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedCommunity(seedConfig('request-fc'));
            yield* linkGroup(communityId, { chatId: -8831 });
            const personId = yield* upsertTelegramUser({ id: 8831n, firstName: 'Helper' });
            yield* grantAdmin({ communityId, personId, grantedBy: null });
            const sessionId = yield* gameOf(communityId, '2026-12-04');
            const decide = (actionId: string, tgUserId: bigint, now?: Date) =>
                decideAction({
                    actionId,
                    tgUserId,
                    confirm: true,
                    ...(now instanceof Date ? { now } : {}),
                    context: (id, requester) =>
                        mainGroupOf(id).pipe(
                            Effect.orDie,
                            Effect.map(group => ({
                                communityId: id,
                                timezone: 'Europe/Vienna',
                                group,
                                groupLocale: 'uk' as const,
                                actorPersonId: null,
                                requester
                            }))
                        )
                });
            const first = yield* proposeAs(communityId, 8831n, { _tag: 'announce_session', sessionId });
            const second = yield* proposeAs(communityId, 8831n, { _tag: 'announce_session', sessionId });
            const awaiting = yield* decide(first, 8831n);
            const again = yield* decide(first, 8831n);
            const [row] = yield* db.select().from(pendingAction).where(eq(pendingAction.id, first));
            const sentEarly = sentTo(-8831).length;
            yield* decide(second, 8831n);
            const done = yield* decide(first, 42n);
            const twice = yield* decide(first, 42n);
            const other = yield* decide(second, 42n);
            const late = yield* proposeAction({
                communityId,
                tgUserId: 8831n,
                action: { _tag: 'delete_session', sessionId },
                summary: 'late'
            });
            yield* decide(late, 8831n);
            const expired = yield* decide(late, 42n, new Date('2026-12-04T19:00:00Z'));

            expect(awaiting).toMatchObject({ _tag: 'awaiting', request: { groups: ['Main'], requestedBy: 8831n } });
            expect(again._tag).toBe('missing');
            expect(row).toMatchObject({ requestedByTgUserId: 8831n, approverTgUserId: 42n, status: 'proposed' });
            expect(row?.expiresAt.toISOString()).toBe('2026-12-04T18:00:00.000Z');
            expect(sentEarly).toBe(0);
            expect(done).toMatchObject({ _tag: 'done', requestedBy: 8831n });
            expect(twice._tag).toBe('missing');
            expect(other).toMatchObject({ _tag: 'failed', failure: { code: 'poll_open' } });
            expect(expired._tag).toBe('expired');
            expect(sentTo(-8831).filter(call => call.method === 'sendPoll')).toHaveLength(1);
            expect(yield* db.select().from(telegramPoll).where(eq(telegramPoll.sessionId, sessionId))).toHaveLength(1);
        })
    );
});

layer(recordedTelegramDbLayer, { timeout: 60_000 })('settings of the groups', it => {
    it.effect('are loaded by the owner, link one group without touching the other and name one main group', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const slug = 'settings-fc';
            const { communityId } = yield* seedCommunity(seedConfig(slug));
            const approverPersonId = yield* syncMember(communityId, { id: 8841n, firstName: 'Approver' }, 'active');
            const stranger = yield* upsertTelegramUser({ id: 8842n, firstName: 'Stranger' });
            const chats = [
                { chatId: -8841, title: 'Main', purpose: 'main' as const, weekdays: ['mon' as const] },
                { chatId: -8842, title: 'Second', purpose: 'other' as const, weekdays: ['wed' as const], topicId: 3 }
            ];
            const foreign = yield* loadGroups({ slug, approverPersonId: stranger, chats }).pipe(Effect.flip);
            yield* loadGroups({ slug, approverPersonId, chats });
            const link = (chatId: bigint) => linkChat({ communityId, chatId, actorPersonId: null });
            const unknown = yield* link(-8849n).pipe(Effect.flip);
            yield* link(-8842n);
            const [notLive] = yield* db.select({ since: community.liveSince }).from(community).where(eq(community.id, communityId));
            const withoutMain = yield* mainGroupOf(communityId);
            yield* link(-8841n);
            yield* setChatSwitch({ communityId, chatId: -8841n, actorPersonId: null }, { isPosting: true });
            const both = yield* linkedChatsOf(communityId);
            yield* unlinkChat({ communityId, chatId: -8841n, actorPersonId: null });
            const left = yield* linkedChatsOf(communityId);
            yield* moveChat(-8842n, -88_420n);
            const known = yield* knownChatsOf(communityId);
            const [live] = yield* db.select({ since: community.liveSince }).from(community).where(eq(community.id, communityId));

            expect(foreign).toMatchObject({ failure: { code: 'person_not_found' } });
            expect(unknown).toMatchObject({ failure: { code: 'chat_not_linked' } });
            expect(notLive?.since).toBeNull();
            expect(Option.isNone(withoutMain)).toBe(true);
            expect(both.map(chat => [chat.chatId, chat.purpose, chat.topicId, chat.isPosting])).toEqual([
                [-8841n, 'main', null, true],
                [-8842n, 'other', 3, false]
            ]);
            expect(left.map(chat => chat.chatId)).toEqual([-8842n]);
            expect(known.map(chat => chat.chatId)).toEqual([-8841, -88_420]);
            expect(live?.since).toBeInstanceOf(Date);
            expect((yield* db.select().from(telegramChat).where(eq(telegramChat.chatId, -88_420n))).length).toBe(1);
            expect((yield* db.select().from(membership).where(eq(membership.communityId, communityId))).length).toBe(1);
        })
    );
});
