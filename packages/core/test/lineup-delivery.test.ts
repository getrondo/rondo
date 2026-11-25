import { expect, layer } from '@effect/vitest';
import { isDefined } from '@rnw-community/shared';
import { person } from '@rondo/db/schema/identity.schema';
import { telegramChat } from '@rondo/db/schema/org.schema';
import { messageRef } from '@rondo/db/schema/platform.schema';
import { lineupDelivery, ratingEvent, team, teamDraft, teamMember } from '@rondo/db/schema/play.schema';
import { signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { testDbLayer } from '@rondo/db/testing/test-db.layer';
import { makeRecorder, recordingTelegramLayer, refusal } from '@rondo/telegram/testing/recording-telegram.layer';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';

import { Access } from '../src/access/admin-access';
import { syncMember } from '../src/identity/telegram-user';
import { setColour, swapPlayers } from '../src/teams/draft-state';
import { planLineup } from '../src/teams/lineup-plan';
import { lineupChanged, publishLineup } from '../src/teams/publish-lineup';
import { changeDraft, openDraft } from '../src/teams/team-draft.service';
import { recordResult } from '../src/teams/team-result';
import { confirmAsOwner, teamsActionAsOwner } from '../src/testing/confirm-action';
import { seedGame } from '../src/testing/seed-game';

const blocked = new Map<number, Error>();
let messageId = 50_000;
const recorder = makeRecorder((method, payload) => {
    const failure = blocked.get(Number(payload.chat_id));

    if (isDefined(failure)) {
        throw failure;
    }

    messageId += 1;

    return method === 'sendMessage' ? { message_id: messageId, date: 0, chat: { id: payload.chat_id, type: 'supergroup' } } : true;
});
const sendsTo = (chatId: number) => recorder.calls.filter(call => call.payload.chat_id === chatId).map(call => call.method);

const twoGroupGame = Effect.fn('test.twoGroupGame')(function* (slug: string, chats: readonly [number, number], base: number) {
    const db = yield* Db;
    const { communityId, sessionId } = yield* seedGame(slug);

    for (const [index, chatId] of chats.entries()) {
        yield* db.insert(telegramChat).values({ chatId: BigInt(chatId), communityId, kind: 'supergroup', title: `Group ${index + 1}` });
        yield* db
            .insert(messageRef)
            .values({ chatId: BigInt(chatId), messageId: index + 1, purpose: 'poll', entityType: 'session', entityId: sessionId });
    }

    for (let index = 0; index < 8; index += 1) {
        const personId = yield* syncMember(communityId, { id: BigInt(base + index), firstName: `Player${index}` }, 'active');
        yield* db.insert(signup).values({ sessionId, personId, status: 'in' });
    }

    yield* openDraft(communityId, sessionId, null);

    return { communityId, sessionId };
});

const publishPlanned = Effect.fn('test.publishPlanned')(function* (
    game: { readonly communityId: string; readonly sessionId: string },
    retryToken: string | null = null
) {
    const input = { ...game, locale: 'uk' as const, actorPersonId: null, privateChatId: null, fallback: Option.none(), retryToken };
    const plan = yield* planLineup(input);

    return yield* publishLineup({ ...input, version: plan.version, fingerprint: plan.fingerprint });
});

const statusesOf = (game: { readonly sessionId: string }) =>
    Db.use(db =>
        db
            .select({ chatId: lineupDelivery.chatId, status: lineupDelivery.status })
            .from(lineupDelivery)
            .where(eq(lineupDelivery.sessionId, game.sessionId))
    ).pipe(Effect.map(rows => new Map(rows.map(row => [Number(row.chatId), row.status]))));

const testLayer = Layer.mergeAll(testDbLayer, recordingTelegramLayer(recorder), Access.layerFor([42n]));

layer(testLayer, { timeout: 60_000 })('line-up delivery per destination', it => {
    it.effect('keeps the receipt of one group when another times out, never resends by itself and resends once on its ticket', () =>
        Effect.gen(function* () {
            const game = yield* twoGroupGame('delivery-uncertain', [-7101, -7102], 71_000);
            blocked.set(-7102, new Error('socket hang up'));
            const first = yield* publishPlanned(game);
            blocked.delete(-7102);
            const afterTimeout = yield* statusesOf(game);
            const quiet = yield* publishPlanned(game);
            const plan = yield* planLineup({ ...game, locale: 'uk', privateChatId: null, fallback: Option.none() });
            const ticket = (plan.deliveries.find(delivery => delivery.chatId === -7102n)?.token ?? '').slice(0, 8);
            const retried = yield* publishPlanned(game, ticket);
            const again = yield* publishPlanned(game, ticket);

            expect(first.deliveries.map(delivery => delivery.status)).toEqual(['sent', 'uncertain']);
            expect(afterTimeout.get(-7101)).toBe('sent');
            expect(afterTimeout.get(-7102)).toBe('uncertain');
            expect(quiet.deliveries.map(delivery => delivery.status)).toEqual(['unchanged', 'uncertain']);
            expect(retried.deliveries.map(delivery => delivery.status)).toEqual(['unchanged', 'sent']);
            expect(again.deliveries.map(delivery => delivery.status)).toEqual(['unchanged', 'unchanged']);
            expect(sendsTo(-7101)).toEqual(['sendMessage']);
            expect(sendsTo(-7102)).toEqual(['sendMessage']);
        })
    );

    it.effect('sends again only to a group that refused the send, and edits only when the posted text changed', () =>
        Effect.gen(function* () {
            const game = yield* twoGroupGame('delivery-refused', [-7201, -7202], 72_000);
            blocked.set(-7202, refusal('sendMessage', 'Forbidden: bot was kicked from the supergroup chat', 403));
            const first = yield* publishPlanned(game);
            blocked.delete(-7202);
            const second = yield* publishPlanned(game);
            const unchanged = yield* publishPlanned(game);
            const db = yield* Db;
            const [row] = yield* db.select().from(teamDraft).where(eq(teamDraft.sessionId, game.sessionId));
            const recoloured = yield* changeDraft(
                { sessionId: game.sessionId, version: row?.version ?? 0, key: 'c', actorPersonId: null },
                state => Effect.succeed(setColour(state, 0, 'green'))
            );
            const edited = yield* publishPlanned(game);
            blocked.set(-7201, refusal('editMessageText', 'Bad Request: message can not be edited'));
            const [first0 = '', first1 = ''] = recoloured.row.state.teams.map(members => members[0] ?? '');
            yield* changeDraft({ sessionId: game.sessionId, version: recoloured.row.version, key: 'w', actorPersonId: null }, state =>
                Effect.succeed(swapPlayers(state, first0, first1))
            );
            const refusedEdit = yield* publishPlanned(game);
            const kept = yield* statusesOf(game);
            blocked.delete(-7201);
            const retriedEdit = yield* publishPlanned(game);

            expect(first.deliveries.map(delivery => delivery.status)).toEqual(['sent', 'refused']);
            expect(second.deliveries.map(delivery => delivery.status)).toEqual(['unchanged', 'sent']);
            expect(unchanged.deliveries.map(delivery => delivery.status)).toEqual(['unchanged', 'unchanged']);
            expect(edited.deliveries.map(delivery => delivery.status)).toEqual(['edited', 'edited']);
            expect(refusedEdit.deliveries.map(delivery => delivery.status)).toEqual(['refused', 'edited']);
            expect(kept.get(-7201)).toBe('sent');
            expect(retriedEdit.deliveries.map(delivery => delivery.status)).toEqual(['edited', 'unchanged']);
            expect(sendsTo(-7201).filter(method => method === 'sendMessage')).toHaveLength(1);
        })
    );

    it.effect('refuses a ✅ whose groups, topic or text changed after the preview and sends nothing', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const game = yield* twoGroupGame('delivery-bound', [-7301, -7302], 73_000);
            const input = { ...game, locale: 'uk' as const, actorPersonId: null, privateChatId: null, fallback: Option.none() };
            const plan = yield* planLineup(input);
            yield* db.update(telegramChat).set({ topicId: 9 }).where(eq(telegramChat.chatId, -7302n));
            const moved = yield* publishLineup({ ...input, version: plan.version, fingerprint: plan.fingerprint }).pipe(Effect.flip);
            const fresh = yield* planLineup(input);
            yield* db.update(person).set({ displayName: 'Renamed' }).where(eq(person.displayName, 'Player0'));
            const renamed = yield* publishLineup({ ...input, version: fresh.version, fingerprint: fresh.fingerprint }).pipe(Effect.flip);
            const current = yield* planLineup(input);
            const sent = yield* publishLineup({ ...input, version: current.version, fingerprint: current.fingerprint });

            expect(moved).toMatchObject({ reason: lineupChanged });
            expect(renamed).toMatchObject({ reason: lineupChanged });
            expect(sent.deliveries.map(delivery => delivery.status)).toEqual(['sent', 'sent']);
            expect(recorder.calls.filter(call => call.payload.chat_id === -7302).map(call => call.payload.message_thread_id)).toEqual([9]);
        })
    );

    it.effect('stores exactly the posted squad and keeps the result through a republish that does not change it', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const game = yield* twoGroupGame('delivery-squad', [-7401, -7402], 74_000);
            const posted = yield* publishPlanned(game);
            yield* recordResult({ ...game, winner: 1, actorPersonId: null, now: new Date('2026-12-04T20:30:00Z') });
            const [row] = yield* db.select().from(teamDraft).where(eq(teamDraft.sessionId, game.sessionId));
            const recoloured = yield* changeDraft(
                { sessionId: game.sessionId, version: row?.version ?? 0, key: 'c', actorPersonId: null },
                state => Effect.succeed(setColour(state, 1, 'yellow'))
            );
            const plan = yield* planLineup({ ...game, locale: 'uk', privateChatId: null, fallback: Option.none() });
            yield* publishPlanned(game);
            const ranks = yield* db.select({ rank: team.rank }).from(team).where(eq(team.sessionId, game.sessionId)).orderBy(team.ordinal);
            const members = yield* db
                .select({ personId: teamMember.personId, ordinal: team.ordinal })
                .from(teamMember)
                .innerJoin(team, eq(team.id, teamMember.teamId))
                .where(eq(teamMember.sessionId, game.sessionId));
            const events = yield* db.select().from(ratingEvent).where(eq(ratingEvent.sessionId, game.sessionId));

            expect(posted.deliveries.map(delivery => delivery.status)).toEqual(['sent', 'sent']);
            expect(plan.clearsResult).toBe(false);
            expect(ranks.map(entry => entry.rank)).toEqual([1, 2]);
            expect(events).toHaveLength(8);
            expect(
                members.toSorted((left, right) => left.personId.localeCompare(right.personId)).map(entry => [entry.personId, entry.ordinal])
            ).toEqual(
                recoloured.row.state.teams
                    .flatMap((personIds, index) => personIds.map(personId => [personId, index + 1]))
                    .toSorted((left, right) => String(left[0]).localeCompare(String(right[0])))
            );
        })
    );

    it.effect('posts the assistant proposal only over the draft it showed and only with the players still in the game', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const game = yield* twoGroupGame('delivery-assistant', [-7501, -7502], 75_000);
            const action = yield* teamsActionAsOwner(game.communityId, game.sessionId, null);
            const [row] = yield* db.select().from(teamDraft).where(eq(teamDraft.sessionId, game.sessionId));
            const [first = '', second = ''] = action.teams.map(entry => entry.players[0]?.personId);
            yield* changeDraft({ sessionId: game.sessionId, version: row?.version ?? 0, key: 'w', actorPersonId: null }, state =>
                Effect.succeed(swapPlayers(state, first, second))
            );
            const stale = yield* confirmAsOwner(game.communityId, action);
            const fresh = yield* teamsActionAsOwner(game.communityId, game.sessionId, null);
            const done = yield* confirmAsOwner(game.communityId, fresh);

            expect(stale).toMatchObject({ _tag: 'failed' });
            expect(done).toMatchObject({ _tag: 'done' });
            expect(sendsTo(-7501)).toEqual(['sendMessage']);
        })
    );
});
