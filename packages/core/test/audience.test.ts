import { expect, layer } from '@effect/vitest';
import { extraction, importedPoll, ingestRun, messageRef, sourceRef } from '@rondo/db/schema/platform.schema';
import { signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { refusal } from '@rondo/telegram/testing/recording-telegram.layer';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { bindChat, linkedChatsOf, mainGroupOf } from '../src/community/community.repository';
import { syncMember } from '../src/identity/telegram-user';
import { footballHistory, plannedFootball } from '../src/menu/game-history.repository';
import { createSession } from '../src/sessions/session.service';
import { audienceOf } from '../src/signups/audience';
import { confirmAsOwner } from '../src/testing/confirm-action';
import { recordedTelegramDbLayer, recorder } from '../src/testing/recorded-telegram.layer';
import { seedCommunity, seedConfig } from '../src/testing/seed-community';

const main = -7001;
const second = -7002;

const link = (communityId: string, chatId: number, title: string, topicId: number | null = null) =>
    bindChat({ communityId, chatId: BigInt(chatId), topicId, kind: 'supergroup', title });

const callsTo = (chatId: number, since: number) => recorder.calls.slice(since).filter(call => call.payload.chat_id === chatId);

layer(recordedTelegramDbLayer, { timeout: 60_000 })('one game, one poll, several chats', it => {
    it.effect('adds a second chat on /link and keeps the first as the default', () =>
        Effect.gen(function* () {
            const { communityId } = yield* seedCommunity(seedConfig('audience-link'));
            yield* link(communityId, main, 'Main');
            yield* link(communityId, second, 'Second');
            yield* link(communityId, main, 'Main', 9);
            const chats = yield* linkedChatsOf(communityId);
            const fallback = yield* mainGroupOf(communityId);

            expect(chats.map(chat => [chat.chatId, chat.topicId, chat.title])).toEqual([
                [BigInt(main), 9, 'Main'],
                [BigInt(second), null, 'Second']
            ]);
            expect(Option.getOrNull(fallback)?.chatId).toBe(BigInt(main));
        })
    );

    it.effect('posts the poll to the chosen chat, forwards it to another and sends notices where the poll is', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, venueIdByName } = yield* seedCommunity(seedConfig('audience-forward'));
            yield* link(communityId, main, 'Main');
            yield* link(communityId, second, 'Second');
            const start = recorder.calls.length;
            const created = yield* confirmAsOwner(communityId, {
                _tag: 'create_session',
                localDate: '2026-12-02',
                localTime: '19:00',
                venueId: venueIdByName.get('Park Field') ?? null,
                capacityMax: 2,
                title: null,
                announce: true,
                chatId: String(second)
            });
            const [ref] = yield* db
                .select()
                .from(messageRef)
                .where(eq(messageRef.chatId, BigInt(second)));
            const sessionId = ref?.entityId ?? '';
            const forwarded = yield* confirmAsOwner(communityId, { _tag: 'forward_poll', sessionId, chatId: String(main) });
            const again = yield* confirmAsOwner(communityId, { _tag: 'forward_poll', sessionId, chatId: String(main) });
            const audience = yield* audienceOf(sessionId);
            const personId = yield* syncMember(communityId, { id: 8101n, firstName: 'Voter' }, 'active');
            yield* db.insert(signup).values({ sessionId, personId, role: 'field', status: 'in' });
            const beforeNotice = recorder.calls.length;
            yield* confirmAsOwner(communityId, { _tag: 'update_session', sessionId, localTime: '20:00', notify: true });
            yield* confirmAsOwner(communityId, { _tag: 'publish_teams', sessionId, teams: [] });

            expect(created._tag).toBe('done');
            expect(
                callsTo(second, start)
                    .slice(0, 2)
                    .map(call => call.method)
            ).toEqual(['sendPoll', 'pinChatMessage']);
            expect(forwarded._tag).toBe('done');
            expect(
                callsTo(main, start)
                    .slice(0, 2)
                    .map(call => call.method)
            ).toEqual(['forwardMessage', 'pinChatMessage']);
            expect(callsTo(main, start)[0]?.payload).toMatchObject({ from_chat_id: second });
            expect(again).toMatchObject({ _tag: 'failed', reason: 'the poll is already in this chat' });
            expect(audience.map(target => target.chatId)).toEqual([BigInt(second), BigInt(main)]);
            expect(callsTo(main, beforeNotice).map(call => call.method)).toEqual(['sendMessage', 'sendMessage']);
            expect(callsTo(second, beforeNotice).map(call => call.method)).toEqual(['sendMessage', 'sendMessage']);
        })
    );

    it.effect('reports a refused forward and never sends a second poll', () =>
        Effect.gen(function* () {
            const { communityId } = yield* seedCommunity(seedConfig('audience-refused'));
            yield* link(communityId, main, 'Main');
            yield* link(communityId, second, 'Second');
            const sessionId = yield* createSession({
                communityId,
                timezone: 'Europe/Vienna',
                localDate: '2026-12-03',
                localTime: '19:00',
                venueId: null,
                capacityMax: 10,
                title: null,
                actorPersonId: null
            });
            const noPoll = yield* confirmAsOwner(communityId, { _tag: 'forward_poll', sessionId, chatId: String(second) });
            yield* confirmAsOwner(communityId, { _tag: 'announce_session', sessionId });
            const start = recorder.calls.length;
            recorder.failures.set('forwardMessage', refusal('forwardMessage', 'Bad Request: chat not found'));
            const refused = yield* confirmAsOwner(communityId, { _tag: 'forward_poll', sessionId, chatId: String(second) });
            recorder.failures.delete('forwardMessage');
            const stranger = yield* confirmAsOwner(communityId, { _tag: 'forward_poll', sessionId, chatId: '-999' });
            const audience = yield* audienceOf(sessionId);

            expect(noPoll).toMatchObject({ _tag: 'failed', reason: 'the game has no open poll' });
            expect(refused).toMatchObject({
                _tag: 'failed',
                reason: "Telegram refused: Call to 'forwardMessage' failed! (400: Bad Request: chat not found)"
            });
            expect(recorder.calls.slice(start).filter(call => call.method === 'sendPoll')).toHaveLength(0);
            expect(stranger).toMatchObject({ _tag: 'failed', reason: 'this chat is not linked to the community' });
            expect(audience.map(target => target.chatId)).toEqual([BigInt(main)]);
        })
    );

    it.effect('sends notices only to chats still linked to the game community or the admin chat, and never to a stand-in', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedCommunity(seedConfig('audience-filter'));
            const { communityId: other } = yield* seedCommunity(seedConfig('audience-filter-other'));
            yield* link(communityId, -7101, 'Main');
            yield* link(other, -7102, 'Foreign');
            const base = {
                communityId,
                timezone: 'Europe/Vienna',
                localTime: '19:00',
                venueId: null,
                capacityMax: 10,
                title: null,
                actorPersonId: null
            };
            const mixed = yield* createSession({ ...base, localDate: '2026-12-03' });
            const foreignOnly = yield* createSession({ ...base, localDate: '2026-12-04' });
            const ref = (chatId: bigint, messageId: number, entityId: string) =>
                ({ chatId, messageId, entityId, purpose: 'poll', entityType: 'session' }) as const;
            yield* db
                .insert(messageRef)
                .values([
                    ref(-7101n, 1, mixed),
                    ref(-7102n, 2, mixed),
                    ref(7103n, 3, mixed),
                    ref(-7104n, 4, mixed),
                    ref(-7102n, 5, foreignOnly)
                ]);
            const audience = yield* audienceOf(mixed);
            const start = recorder.calls.length;
            yield* confirmAsOwner(communityId, { _tag: 'update_session', sessionId: foreignOnly, localTime: '20:00', notify: true });

            expect(audience.map(target => target.chatId)).toEqual([-7101n, 7103n]);
            expect(recorder.calls.slice(start).filter(call => call.method === 'sendMessage')).toEqual([]);
        })
    );

    it.effect('knows the chats in which the poll of an imported game was posted', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, venueIdByName } = yield* seedCommunity(seedConfig('audience-import'));
            const venueId = venueIdByName.get('Park Field') ?? null;
            const game = {
                communityId,
                timezone: 'Europe/Vienna',
                localTime: '19:00',
                venueId,
                capacityMax: null,
                title: null,
                actorPersonId: null
            };
            const sessionIds = yield* Effect.all(
                ['2026-11-16', '2026-11-18', '2026-11-20'].map(localDate => createSession({ ...game, localDate }))
            );
            const [run] = yield* db
                .insert(ingestRun)
                .values({ communityId, source: 'telegram_json', fileSha256: 'sha', parserVersion: '2' })
                .returning();
            const posts = [
                { session: 0, chatId: null },
                { session: 1, chatId: second },
                { session: 2, chatId: second },
                { session: 2, chatId: null }
            ];
            const refs = yield* db
                .insert(sourceRef)
                .values(
                    posts.map(({ chatId }, index) => ({
                        runId: run?.id ?? '',
                        communityId,
                        chatId,
                        messageId: index,
                        sentAt: new Date('2026-11-16T10:00:00Z'),
                        kind: 'poll' as const
                    }))
                )
                .returning();
            yield* db.insert(extraction).values(
                posts.map((post, index) => ({
                    sourceRefId: refs[index]?.id ?? '',
                    entityType: 'scheduling.session',
                    entityId: sessionIds[post.session] ?? ''
                }))
            );
            const chatsOf = () =>
                footballHistory(communityId, '2026-11-01', ['training']).pipe(
                    Effect.map(history =>
                        history.toSorted((left, right) => left.localDate.localeCompare(right.localDate)).map(past => past.chatIds)
                    )
                );
            const unlinked = yield* chatsOf();
            yield* link(communityId, main - 20, 'Main');
            yield* link(communityId, second - 10, 'Second');
            const linked = yield* chatsOf();

            expect(unlinked).toEqual([[], [String(second)], [String(second)]]);
            expect(linked).toEqual([[String(main - 20)], [String(second)], [String(main - 20), String(second)]]);
        })
    );

    it.effect('does not offer to post an imported game that already has an organizer poll', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedCommunity(seedConfig('audience-planned'));
            const game = {
                communityId,
                timezone: 'Europe/Vienna',
                localTime: '19:00',
                venueId: null,
                capacityMax: null,
                title: null,
                actorPersonId: null
            };
            const sessionIds = yield* Effect.all(
                ['2026-12-02', '2026-12-04', '2026-12-07'].map(localDate => createSession({ ...game, localDate }))
            );
            const poll = { communityId, messageId: 1, postedAt: new Date('2026-12-01T10:00:00Z'), answers: 2 };
            yield* db.insert(importedPoll).values([
                { ...poll, pollId: 'planned-1', sessionId: sessionIds[0] ?? '', kind: 'participation' },
                { ...poll, pollId: 'planned-2', sessionId: sessionIds[1] ?? '', kind: 'reserve' }
            ]);
            const planned = yield* plannedFootball(communityId, '2026-12-01');

            expect(planned.map(({ localDate, hasPoll }) => [localDate, hasPoll])).toEqual([
                ['2026-12-02', true],
                ['2026-12-04', false],
                ['2026-12-07', false]
            ]);
        })
    );
});
