import { randomUUID } from 'node:crypto';

import { expect, layer } from '@effect/vitest';
import { isEmptyString } from '@rnw-community/shared';
import { community, telegramChat } from '@rondo/db/schema/org.schema';
import { pendingAction, telegramPoll } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder, recordingTelegramLayer } from '@rondo/telegram/testing/recording-telegram.layer';
import { and, eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Random from 'effect/Random';

import { Access, grantAdmin } from '../src/access/admin-access';
import { linkChat, setChatSwitch } from '../src/community/chat-links';
import { loadGroups } from '../src/community/group-settings';
import { syncMember } from '../src/identity/telegram-user';
import { createSession } from '../src/sessions/session.service';
import { decideAs, proposeAs } from '../src/testing/confirm-action';
import { linkGroup } from '../src/testing/link-group';
import { localPostgresLayer, raceDatabaseUrl } from '../src/testing/local-postgres.layer';
import { seedCommunity, seedConfig } from '../src/testing/seed-community';

// The database outlives a run, so the ids of its polls must too
const recorder = makeRecorder((method, { chat_id: chatId }) => ({
    message_id: 1,
    date: 0,
    chat: { id: chatId, type: 'supergroup' },
    ...(method === 'sendPoll' ? { poll: { id: randomUUID() } } : {})
}));
const racers = 8;
const withoutPostgres = isEmptyString(raceDatabaseUrl);
const postgresLayer = Layer.mergeAll(localPostgresLayer(raceDatabaseUrl), recordingTelegramLayer(recorder), Access.layerFor([42n]));

const gameOf = (communityId: string) =>
    createSession({
        communityId,
        timezone: 'Europe/Vienna',
        localDate: '2030-12-04',
        localTime: '19:00',
        venueId: null,
        capacityMax: null,
        title: null,
        actorPersonId: null
    });

const atOnce = <Value, Failure, Requirements>(effect: (index: number) => Effect.Effect<Value, Failure, Requirements>) =>
    Effect.all(
        Array.from({ length: racers }, (_, index) => effect(index)),
        { concurrency: 'unbounded' }
    );

layer(postgresLayer, { timeout: 120_000, excludeTestServices: true })('approvals on a real Postgres', it => {
    it.effect.skipIf(withoutPostgres)('posts once for many taps of the approver, and passes a request on once', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const base = yield* Random.nextIntBetween(1_000_000_000, 2_000_000_000);
            const chatId = -94_000_000 - base;
            const { communityId } = yield* seedCommunity(seedConfig(`race-approve-${base}`));
            yield* linkGroup(communityId, { chatId });
            const personId = yield* syncMember(communityId, { id: BigInt(base), firstName: 'Helper' }, 'active');
            yield* grantAdmin({ communityId, personId, grantedBy: null });
            const sessionId = yield* gameOf(communityId);
            const actionId = yield* proposeAs(communityId, BigInt(base), { _tag: 'announce_session', sessionId });
            const other = yield* proposeAs(communityId, BigInt(base), { _tag: 'announce_session', sessionId });
            const asked = yield* atOnce(() => decideAs(actionId, BigInt(base)));
            yield* decideAs(other, BigInt(base));
            const taps = yield* atOnce(index => decideAs(index % 2 === 0 ? actionId : other, 42n));
            const polls = recorder.calls.filter(call => call.method === 'sendPoll' && call.payload.chat_id === chatId);
            const stored = yield* db.select().from(telegramPoll).where(eq(telegramPoll.sessionId, sessionId));

            expect(asked.filter(outcome => outcome._tag === 'awaiting')).toHaveLength(1);
            expect(taps.filter(outcome => outcome._tag === 'done')).toHaveLength(1);
            expect(polls).toHaveLength(1);
            expect(stored).toHaveLength(1);
        })
    );

    it.effect.skipIf(withoutPostgres)('links one main group, whatever is linked at the same time, and drops every open proposal', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const base = yield* Random.nextIntBetween(1_000_000_000, 2_000_000_000);
            const slug = `race-link-${base}`;
            const { communityId } = yield* seedCommunity(seedConfig(slug));
            const personId = yield* syncMember(communityId, { id: BigInt(base), firstName: 'Approver' }, 'active');
            yield* grantAdmin({ communityId, personId, grantedBy: null });
            const ids = Array.from({ length: racers }, (_, index) => -95_000_000 - base * 10 - index);
            yield* atOnce(index =>
                loadGroups({
                    slug,
                    approverTgUserId: base,
                    chats: [{ chatId: ids[index] ?? 0, title: `Group ${index}`, purpose: 'main', weekdays: [] }]
                }).pipe(
                    Effect.andThen(linkChat({ communityId, chatId: BigInt(ids[index] ?? 0), title: 'Main', actorPersonId: null })),
                    Effect.ignore
                )
            );
            const linked = yield* db.select().from(telegramChat).where(eq(telegramChat.communityId, communityId));
            const mains = linked.filter(chat => chat.purpose === 'main');
            const [row] = yield* db.select({ since: community.liveSince }).from(community).where(eq(community.id, communityId));
            const sessionId = yield* gameOf(communityId);
            const proposals = yield* atOnce(() =>
                proposeAs(communityId, 42n, { _tag: 'announce_session', sessionId, chatId: String(mains[0]?.chatId) })
            );
            yield* atOnce(() => setChatSwitch({ communityId, chatId: mains[0]?.chatId ?? 0n, actorPersonId: null }, { isPosting: true }));
            const open = yield* db
                .select()
                .from(pendingAction)
                .where(and(eq(pendingAction.communityId, communityId), eq(pendingAction.status, 'proposed')));

            expect(mains).toHaveLength(1);
            expect(row?.since).toBeInstanceOf(Date);
            expect(proposals).toHaveLength(racers);
            expect(open).toEqual([]);
        })
    );
});
