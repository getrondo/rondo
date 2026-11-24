import { expect, layer } from '@effect/vitest';
import { isDefined, isNotEmptyString } from '@rnw-community/shared';
import { AiGateway } from '@rondo/assistant/service/ai-gateway.service';
import { Access } from '@rondo/core/access/admin-access';
import { proposeAction } from '@rondo/core/actions/pending-action.service';
import { createSession } from '@rondo/core/sessions/session.service';
import { seedCommunity, seedConfig } from '@rondo/core/testing/seed-community';
import { telegramAccount } from '@rondo/db/schema/identity.schema';
import { membership, telegramChat } from '@rondo/db/schema/org.schema';
import { processedUpdate, telegramPoll } from '@rondo/db/schema/platform.schema';
import { session, signup } from '@rondo/db/schema/scheduling.schema';
import { venue } from '@rondo/db/schema/venue.schema';
import { Db } from '@rondo/db/service/db.service';
import { testDbLayer } from '@rondo/db/testing/test-db.layer';
import { makeRecorder, recordingTelegramLayer } from '@rondo/telegram/testing/recording-telegram.layer';
import { MockLanguageModelV4 } from 'ai/test';
import { eq } from 'drizzle-orm';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';

import { handleUpdate } from '../src/handle-update';

import type { Action } from '@rondo/core/actions/action.model';
import type { Message, Poll, Update } from 'grammy/types';

const owner = { id: 42, is_bot: false, first_name: 'Alex', language_code: 'uk' };
const player = { id: 77, is_bot: false, first_name: 'Ivan', language_code: 'ru' };
const groupChat = { id: -100_500, type: 'supergroup' as const, title: 'Football' };
const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } };

let modelCalls = 0;
let place = '';
const model = new MockLanguageModelV4({
    doGenerate: async () => {
        modelCalls += 1;

        return await Promise.resolve(
            modelCalls === 1
                ? {
                      content: [
                          {
                              type: 'tool-call' as const,
                              toolCallId: 'call-1',
                              toolName: 'propose_create_session',
                              input: JSON.stringify({ localDate: '2026-12-04', localTime: '19:30', capacityMax: 14, announce: true })
                          }
                      ],
                      finishReason: { unified: 'tool-calls' as const, raw: 'tool_use' },
                      usage,
                      warnings: []
                  }
                : {
                      content: [{ type: 'text' as const, text: isNotEmptyString(place) ? place : 'Гра готова до підтвердження.' }],
                      finishReason: { unified: 'stop' as const, raw: 'end_turn' },
                      usage,
                      warnings: []
                  }
        );
    }
});

const recorder = makeRecorder();
let updateId = 1;
const nextUpdate = (body: Omit<Update, 'update_id'>): Update => {
    updateId += 1;

    return { update_id: updateId, ...body };
};
const message = (
    from: typeof owner,
    chat: { readonly id: number; readonly type: 'private' | 'supergroup'; readonly title?: string },
    text: string
) => nextUpdate({ message: { message_id: updateId, date: 1_764_500_000, chat: chat as never, from, text } });

const confirm = (data: string) =>
    handleUpdate(
        nextUpdate({
            callback_query: {
                id: `cb-${data}`,
                from: owner,
                chat_instance: 'x',
                data,
                message: { message_id: 9, date: 0, chat: { id: owner.id, type: 'private', first_name: 'Alex' } }
            }
        })
    );
const confirmAction = (communityId: string, action: Action) =>
    proposeAction({ communityId, tgUserId: BigInt(owner.id), action, summary: action._tag }).pipe(
        Effect.flatMap(actionId => confirm(`act:${actionId}:y`))
    );
const groupUpdate = (from: typeof owner, chatId: number, body: Partial<Message>) =>
    nextUpdate({
        message: {
            message_id: updateId,
            date: 1_777_831_200,
            chat: { id: chatId, type: 'supergroup', title: 'Forum' } as never,
            from,
            ...body
        } as NonNullable<Update['message']>
    });
const organizerPoll = (question: string) => ({
    poll: { question, options: ['+', '-'].map(option => ({ text: option, persistent_id: option, voter_count: 0 })) } as Poll
});
const inTopic = (topicId: number) => ({ message_thread_id: topicId, is_topic_message: true });
const replyThread = { message_thread_id: 55 };
const chatRow = Effect.fn('test.chatRow')(function* (chatId: number) {
    const db = yield* Db;
    const [row] = yield* db
        .select()
        .from(telegramChat)
        .where(eq(telegramChat.chatId, BigInt(chatId)));

    return row;
});
const callsTo = (chatId: number) => recorder.calls.filter(call => call.payload.chat_id === chatId);

const testLayer = Layer.mergeAll(
    testDbLayer,
    recordingTelegramLayer(recorder),
    AiGateway.layerFor(model),
    Access.layerFor([BigInt(owner.id)])
);

layer(testLayer, { timeout: 60_000 })('telegram webhook updates', it => {
    it.effect('lets the owner link the group, create a game through the assistant, confirm it and collect sign-ups', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedCommunity(seedConfig('e2e-fc'));

            yield* handleUpdate(message(owner, groupChat, '/link e2e-fc'));
            yield* handleUpdate(
                message(owner, { id: owner.id, type: 'private' }, 'створи гру в пʼятницю 4 грудня о 19:30 на 14 людей і оголоси')
            );
            const proposal = recorder.calls.find(call => call.method === 'sendMessage' && isDefined(call.payload.reply_markup));
            const keyboard = proposal?.payload.reply_markup as { inline_keyboard: { callback_data: string }[][] } | undefined;
            const confirmData = keyboard?.inline_keyboard[0]?.[0]?.callback_data ?? '';

            yield* confirm(confirmData);
            const [created] = yield* db.select().from(session).where(eq(session.communityId, communityId));
            const poll = recorder.calls.find(call => call.method === 'sendPoll');
            const [stored] = yield* db
                .select({ pollId: telegramPoll.pollId })
                .from(telegramPoll)
                .where(eq(telegramPoll.sessionId, created?.id ?? ''));
            const answer = nextUpdate({
                poll_answer: { poll_id: stored?.pollId ?? '', user: player, option_ids: [0], option_persistent_ids: ['in'] }
            });
            yield* handleUpdate(answer);
            yield* handleUpdate(answer);
            const signups = yield* db
                .select()
                .from(signup)
                .where(eq(signup.sessionId, created?.id ?? ''));

            expect(
                recorder.calls.some(call => call.method === 'sendMessage' && String(call.payload.text).includes('Групу підключено'))
            ).toBe(true);
            expect(String(proposal?.payload.text)).toContain('➕ Нова гра: Пт 04.12 19:30, 14 місць');
            expect(confirmData).toMatch(/^act:[\da-f-]{36}:y$/u);
            expect(created).toMatchObject({ localDate: '2026-12-04', capacityMax: 14, status: 'open' });
            expect(poll?.payload).toMatchObject({ chat_id: groupChat.id });
            expect(recorder.calls.some(call => call.method === 'editMessageText' && String(call.payload.text).includes('Виконано'))).toBe(
                true
            );
            expect(signups.map(row => row.status)).toEqual(['in']);
        })
    );

    it.effect('answers members who are not admins without calling the model', () =>
        Effect.gen(function* () {
            const before = modelCalls;

            yield* handleUpdate(message(player, { id: player.id, type: 'private' }, 'привет'));
            const reply = recorder.calls.at(-1);

            expect(modelCalls).toBe(before);
            expect(String(reply?.payload.text)).toContain('Пока я работаю с администраторами');
        })
    );

    it.effect('retries a failed update up to three times and ignores confirmations outside a private chat', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const failing = message({ ...owner, id: Number.NaN }, groupChat, 'boom');
            const exits = yield* Effect.all(Array.from({ length: 4 }, () => Effect.exit(handleUpdate(failing))));
            const [stored] = yield* db.select().from(processedUpdate).where(eq(processedUpdate.updateId, failing.update_id));
            const edits = recorder.calls.filter(call => call.method === 'editMessageText').length;
            yield* handleUpdate(
                nextUpdate({
                    callback_query: {
                        id: 'cb-2',
                        from: owner,
                        chat_instance: 'x',
                        data: 'act:00000000-0000-7000-8000-000000000000:y',
                        message: { message_id: 9, date: 0, chat: groupChat }
                    }
                })
            );

            expect(exits.map(exit => exit._tag)).toEqual(['Failure', 'Failure', 'Failure', 'Success']);
            expect(stored).toMatchObject({ attempts: 3, doneAt: null });
            expect(recorder.calls.filter(call => call.method === 'editMessageText')).toHaveLength(edits);
        })
    );

    it.effect('does not run an update that another attempt is still handling', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const update = message(player, { id: player.id, type: 'private' }, 'привет');
            const at = yield* DateTime.nowAsDate;
            yield* db.insert(processedUpdate).values({ updateId: update.update_id, at });
            const calls = recorder.calls.length;
            const error = yield* Effect.flip(handleUpdate(update));

            expect(error).toMatchObject({ _tag: 'UpdateInProgressError' });
            expect(recorder.calls).toHaveLength(calls);
        })
    );

    it.effect('asks the admin privately before a cancellation written in the group is applied', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const group = { id: -100_700, type: 'supergroup' as const, title: 'Third' };
            const { communityId } = yield* seedCommunity(seedConfig('cancel-fc'));
            const sessionId = yield* createSession({
                communityId,
                timezone: 'Europe/Vienna',
                localDate: '2025-11-30',
                localTime: '19:00',
                venueId: null,
                capacityMax: null,
                title: null,
                actorPersonId: null
            });
            yield* handleUpdate(message(owner, group, '/link cancel-fc'));
            const before = recorder.calls.length;
            yield* handleUpdate(message(player, group, 'Сегодня отмена, дождь'));
            const ignored = recorder.calls.length;
            yield* handleUpdate(message(owner, group, 'Сегодня отмена, дождь'));
            const proposal = recorder.calls.at(-1);
            const [open] = yield* db.select().from(session).where(eq(session.id, sessionId));
            const keyboard = proposal?.payload.reply_markup as { inline_keyboard: { callback_data: string }[][] } | undefined;
            yield* confirm(keyboard?.inline_keyboard[0]?.[0]?.callback_data ?? '');
            const [done] = yield* db.select().from(session).where(eq(session.id, sessionId));

            expect(ignored).toBe(before);
            expect(proposal?.payload.chat_id).toBe(owner.id);
            expect(open?.status).toBe('open');
            expect(done).toMatchObject({ status: 'cancelled', cancelReason: 'weather' });
        })
    );

    it.effect('syncs members and proposes an unknown venue to the admin who posted the poll', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const group = { id: -100_600, type: 'supergroup' as const, title: 'Second' };
            const { communityId } = yield* seedCommunity(seedConfig('directory-fc'));
            const newcomer = { id: 88, is_bot: false, first_name: 'New' };
            const service = { message_id: 60, date: 1_777_831_200, chat: group, from: player };
            const pollOf = (from: typeof owner, question: string) =>
                nextUpdate({
                    message: {
                        ...service,
                        from,
                        ...organizerPoll(question)
                    }
                });
            yield* handleUpdate(message(owner, group, '/link directory-fc'));
            yield* handleUpdate(
                nextUpdate({ message: { ...service, new_chat_members: [newcomer, { ...newcomer, id: 89, is_bot: true }] } })
            );
            yield* handleUpdate(nextUpdate({ message: { ...service, left_chat_member: newcomer } }));
            yield* handleUpdate(
                nextUpdate({
                    message: { ...service, venue: { title: 'Fake', address: 'x', location: { latitude: 1, longitude: 1 } } }
                })
            );
            place = 'Stadlau';
            yield* handleUpdate(pollOf(player, 'Понедельник, 4 мая, 19.00 Stadlau. 18 чел'));
            const beforeAdmin = recorder.calls.length;
            yield* handleUpdate(pollOf(owner, 'Понедельник, 4 мая, 19.00 Stadlau. 18 чел'));
            const proposal = recorder.calls.slice(beforeAdmin).find(call => call.method === 'sendMessage');
            const keyboard = proposal?.payload.reply_markup as { inline_keyboard: { callback_data: string }[][] } | undefined;
            yield* confirm(keyboard?.inline_keyboard[0]?.[0]?.callback_data ?? '');
            place = 'Invented Arena';
            yield* handleUpdate(pollOf(owner, 'Вторник, 5 мая, 19.00 Aspern. 18 чел'));
            const venues = yield* db.select().from(venue).where(eq(venue.communityId, communityId));
            const games = yield* db.select().from(session).where(eq(session.communityId, communityId)).orderBy(session.localDate);
            const members = yield* db
                .select({ tgUserId: telegramAccount.tgUserId, status: membership.status })
                .from(membership)
                .innerJoin(telegramAccount, eq(telegramAccount.personId, membership.personId))
                .where(eq(membership.communityId, communityId));

            expect(proposal?.payload.chat_id).toBe(owner.id);
            expect(venues.map(row => row.name).toSorted()).toEqual(['North Arena', 'Park Field', 'Stadlau']);
            expect(games.map(game => game.venueId)).toEqual([venues.find(row => row.name === 'Stadlau')?.id, null]);
            expect(members.find(row => row.tgUserId === 88n)?.status).toBe('left');
            expect(members.some(row => row.tgUserId === 89n)).toBe(false);
        })
    );

    it.effect('follows joins and kicks from member updates and ignores bots', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const group = { id: -100_800, type: 'supergroup' as const, title: 'Fourth' };
            const { communityId } = yield* seedCommunity(seedConfig('presence-fc'));
            yield* handleUpdate(message(owner, group, '/link presence-fc'));
            const change = (id: number, status: 'member' | 'kicked', isBot = false) => {
                const user = { id, is_bot: isBot, first_name: 'U' };
                const member = status === 'kicked' ? { status, user, until_date: 0 } : { status, user };

                return nextUpdate({
                    chat_member: { chat: group, from: owner, date: 1, old_chat_member: { status: 'left', user }, new_chat_member: member }
                });
            };
            yield* handleUpdate(change(301, 'member'));
            yield* handleUpdate(change(302, 'member'));
            yield* handleUpdate(change(302, 'kicked'));
            yield* handleUpdate(change(303, 'member', true));
            const rows = yield* db
                .select({ id: telegramAccount.tgUserId, status: membership.status })
                .from(membership)
                .innerJoin(telegramAccount, eq(telegramAccount.personId, membership.personId))
                .where(eq(membership.communityId, communityId))
                .orderBy(telegramAccount.tgUserId);

            expect(rows).toEqual([
                { id: 301n, status: 'active' },
                { id: 302n, status: 'removed' }
            ]);
        })
    );

    it.effect('binds the topic of /link, reads games only there and posts there', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const chatId = -100_901;
            const { communityId, venueIdByName } = yield* seedCommunity(seedConfig('topic-fc'));
            yield* handleUpdate(groupUpdate(owner, chatId, { text: '/link topic-fc', ...inTopic(7) }));
            yield* handleUpdate(groupUpdate(owner, chatId, organizerPoll('Понедельник, 4 мая, 19.00 Park')));
            yield* handleUpdate(groupUpdate(owner, chatId, { ...organizerPoll('Вторник, 5 мая, 19.00 Park'), ...replyThread }));
            yield* handleUpdate(groupUpdate(owner, chatId, { ...organizerPoll('Среда, 6 мая, 19.00 Park'), ...inTopic(9) }));
            const pin = { location: { latitude: 1, longitude: 1 }, address: 'x' };
            yield* handleUpdate(groupUpdate(owner, chatId, { venue: { title: 'Off topic', ...pin }, ...inTopic(9) }));
            yield* handleUpdate(groupUpdate(owner, chatId, { venue: { title: 'Games', ...pin }, ...inTopic(7) }));
            yield* handleUpdate(groupUpdate(player, chatId, { text: 'привет', ...inTopic(9) }));
            yield* handleUpdate(groupUpdate(owner, chatId, { ...organizerPoll('Четверг, 7 мая, 19.00 Park'), ...inTopic(7) }));
            const chat = yield* chatRow(chatId);
            const read = yield* db.select().from(session).where(eq(session.communityId, communityId));
            const members = yield* db.select().from(membership).where(eq(membership.communityId, communityId));
            const venues = yield* db.select().from(venue).where(eq(venue.communityId, communityId));

            const venueId = venueIdByName.get('Park Field') ?? null;
            const game = { localDate: '2026-12-04', localTime: '19:30', venueId, capacityMax: 1, title: null, announce: true };
            yield* confirmAction(communityId, { _tag: 'create_session', ...game });
            const [poll] = yield* db
                .select()
                .from(telegramPoll)
                .where(eq(telegramPoll.chatId, BigInt(chatId)));
            const vote = (user: typeof owner, optionIds: number[]) =>
                handleUpdate(
                    nextUpdate({ poll_answer: { poll_id: poll?.pollId ?? '', user, option_ids: optionIds, option_persistent_ids: [] } })
                );
            yield* vote(owner, [0]);
            yield* vote(player, [0]);
            yield* vote(owner, []);
            const sessionId = poll?.sessionId ?? '';
            yield* confirmAction(communityId, { _tag: 'update_session', sessionId, localTime: '20:00', notify: true });
            yield* confirmAction(communityId, { _tag: 'publish_teams', sessionId, teams: [] });
            yield* confirmAction(communityId, { _tag: 'cancel_session', sessionId, reason: 'weather', notify: true });
            const posts = callsTo(chatId).filter(call => call.method.startsWith('send'));

            expect(chat?.topicId).toBe(7);
            expect(read.map(row => row.localDate)).toEqual(['2026-05-07']);
            expect(members).toHaveLength(2);
            expect(venues.map(row => row.name).toSorted()).toEqual(['Games', 'North Arena', 'Park Field']);
            expect(posts.map(call => call.method)).toEqual(['sendMessage', 'sendPoll', ...Array.from({ length: 4 }, () => 'sendMessage')]);
            expect(posts.every(call => call.payload.message_thread_id === 7)).toBe(true);
        })
    );

    it.effect('addresses General, and a group without topics, without a topic id', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const chatId = -100_902;
            const { communityId } = yield* seedCommunity(seedConfig('general-fc'));
            yield* handleUpdate(groupUpdate(owner, chatId, { text: '/link general-fc', ...inTopic(7) }));
            yield* handleUpdate(groupUpdate(owner, chatId, { text: '/link general-fc', ...replyThread }));
            const before = callsTo(chatId).length;
            yield* handleUpdate(groupUpdate(owner, chatId, { ...organizerPoll('Понедельник, 4 мая, 19.00 Park'), ...inTopic(7) }));
            yield* handleUpdate(groupUpdate(owner, chatId, { ...organizerPoll('Вторник, 5 мая, 19.00 Park'), ...replyThread }));
            yield* handleUpdate(groupUpdate(owner, chatId, organizerPoll('Среда, 6 мая, 19.00 Park')));
            const chat = yield* chatRow(chatId);
            const read = yield* db.select().from(session).where(eq(session.communityId, communityId)).orderBy(session.localDate);
            yield* confirmAction(communityId, { _tag: 'announce_session', sessionId: read[0]?.id ?? '' });
            const posts = callsTo(chatId).slice(before - 1);

            expect(chat?.topicId).toBe(null);
            expect(read.map(row => row.localDate)).toEqual(['2026-05-05', '2026-05-06']);
            expect(posts.map(call => call.method)).toContain('sendPoll');
            expect(posts.some(call => 'message_thread_id' in call.payload)).toBe(false);
        })
    );
});
