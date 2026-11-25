import { expect, layer } from '@effect/vitest';
import { isDefined } from '@rnw-community/shared';
import { person } from '@rondo/db/schema/identity.schema';
import { telegramChat } from '@rondo/db/schema/org.schema';
import { importedPoll, messageRef } from '@rondo/db/schema/platform.schema';
import { lineupDelivery, ratingEvent, team, teamDraft, teamMember } from '@rondo/db/schema/play.schema';
import { attendance, session, signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { testDbLayer } from '@rondo/db/testing/test-db.layer';
import { makeRecorder, recordingTelegramLayer, refusal } from '@rondo/telegram/testing/recording-telegram.layer';
import { and, eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import * as TestClock from 'effect/testing/TestClock';

import { Access } from '../src/access/admin-access';
import { describeAction } from '../src/actions/describe-action';
import { syncMember } from '../src/identity/telegram-user';
import { setColour, swapPlayers } from '../src/teams/draft-state';
import { planLineup } from '../src/teams/lineup-plan';
import { publishLineup } from '../src/teams/publish-lineup';
import { changeDraft, openDraft } from '../src/teams/team-draft.service';
import { recordResult } from '../src/teams/team-result';
import { confirmAsOwner, teamsActionAsOwner } from '../src/testing/confirm-action';

import { ownerApproval, publishPlanned, publishWhile, twoGroupGame } from './support/two-group-game';

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

const swapFirsts = Effect.fn('test.swapFirsts')(function* (game: { readonly communityId: string; readonly sessionId: string }) {
    const { row } = yield* openDraft(game.communityId, game.sessionId, null);
    const [first = '', second = ''] = row.state.teams.map(members => members[0] ?? '');
    yield* changeDraft({ sessionId: game.sessionId, version: row.version, key: 'w', actorPersonId: null }, state =>
        Effect.succeed(swapPlayers(state, first, second))
    );
});

// A recorded result, then the first players of the two teams swapped
const resultThenSwap = Effect.fn('test.resultThenSwap')(function* (game: { readonly communityId: string; readonly sessionId: string }) {
    yield* recordResult({ ...game, winner: 1, actorPersonId: null, now: new Date('2026-12-04T20:30:00Z') });
    yield* swapFirsts(game);
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
            const input = {
                ...game,
                locale: 'uk' as const,
                actorPersonId: null,
                approval: ownerApproval,
                privateChatId: null,
                fallback: Option.none()
            };
            const plan = yield* planLineup(input);
            yield* db.update(telegramChat).set({ topicId: 9 }).where(eq(telegramChat.chatId, -7302n));
            const moved = yield* publishLineup({ ...input, version: plan.version, fingerprint: plan.fingerprint }).pipe(Effect.flip);
            const fresh = yield* planLineup(input);
            yield* db.update(person).set({ displayName: 'Renamed' }).where(eq(person.displayName, 'Player0'));
            const renamed = yield* publishLineup({ ...input, version: fresh.version, fingerprint: fresh.fingerprint }).pipe(Effect.flip);
            const current = yield* planLineup(input);
            const sent = yield* publishLineup({ ...input, version: current.version, fingerprint: current.fingerprint });

            expect(moved).toMatchObject({ failure: { code: 'lineup_changed' } });
            expect(renamed).toMatchObject({ failure: { code: 'lineup_changed' } });
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

    it.effect('refuses the assistant post when someone joined after the confirmation was shown', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const game = yield* twoGroupGame('delivery-assistant-joiner', [-7961, -7962], 79_600);
            const action = yield* teamsActionAsOwner(game.communityId, game.sessionId, null);
            const newcomer = yield* syncMember(game.communityId, { id: 79_699n, firstName: 'Newcomer' }, 'active');
            yield* db.insert(signup).values({ sessionId: game.sessionId, personId: newcomer, status: 'in' });
            const done = yield* confirmAsOwner(game.communityId, action);

            expect(done).toMatchObject({ _tag: 'failed' });
            expect(sendsTo(-7961)).toEqual([]);
        })
    );

    it.effect('plans the line-up for the admin when the poll is in a chat the bot does not have', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const game = yield* twoGroupGame('delivery-unlinked', [-7971, -7972], 79_700);
            yield* db.delete(telegramChat).where(eq(telegramChat.communityId, game.communityId));
            const plan = yield* planLineup({ ...game, locale: 'uk', privateChatId: 4242, fallback: Option.none() });

            expect(plan.deliveries.map(delivery => delivery.chatId)).toEqual([4242n]);
        })
    );

    it.effect('plans an imported poll for its own chat, and for the admin when that chat is not linked', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const game = yield* twoGroupGame('delivery-imported', [-7981, -7982], 79_800);
            yield* db.delete(messageRef).where(eq(messageRef.entityId, game.sessionId));
            yield* db.insert(importedPoll).values({
                pollId: 'imported-elsewhere',
                communityId: game.communityId,
                sessionId: game.sessionId,
                chatId: -7989,
                messageId: 1,
                postedAt: new Date('2026-12-01T10:00:00Z'),
                kind: 'participation',
                answers: 2
            });
            const fallback = Option.some({ chatId: -7981n, topicId: null });
            const unlinked = yield* planLineup({ ...game, locale: 'uk', privateChatId: 4244, fallback });
            yield* db.update(importedPoll).set({ chatId: -7982 }).where(eq(importedPoll.pollId, 'imported-elsewhere'));
            const linked = yield* planLineup({ ...game, locale: 'uk', privateChatId: 4244, fallback });

            yield* db.insert(importedPoll).values({
                pollId: 'imported-second',
                communityId: game.communityId,
                sessionId: game.sessionId,
                chatId: -7981,
                messageId: 2,
                postedAt: new Date('2026-12-01T09:00:00Z'),
                kind: 'participation',
                answers: 2
            });
            const both = yield* planLineup({ ...game, locale: 'uk', privateChatId: 4244, fallback });

            expect(new Set(both.deliveries.map(delivery => delivery.chatId))).toEqual(new Set([-7981n, -7982n]));
            expect(unlinked.deliveries.map(delivery => delivery.chatId)).toEqual([4244n]);
            expect(linked.deliveries.map(delivery => delivery.chatId)).toEqual([-7982n]);
        })
    );

    it.effect('refuses before any send a changed squad whose result can no longer be reverted', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const game = yield* twoGroupGame('delivery-not-revertible', [-7991, -7992], 79_900);
            const later = yield* twoGroupGame('delivery-not-revertible-later', [-79_931, -79_932], 799_300);
            yield* publishPlanned(game);
            yield* resultThenSwap(game);
            const [event] = yield* db.select().from(ratingEvent).where(eq(ratingEvent.sessionId, game.sessionId));
            yield* db.insert(ratingEvent).values({
                personId: event?.personId ?? '',
                activityId: event?.activityId ?? '',
                model: 'openskill_pl',
                sessionId: later.sessionId,
                muBefore: 25,
                muAfter: 26,
                sigmaBefore: 8,
                sigmaAfter: 7,
                at: new Date('2027-01-01T00:00:00Z')
            });
            const refused = yield* publishPlanned(game).pipe(Effect.flip);

            expect(refused).toMatchObject({ failure: { code: 'result_recorded' } });
            expect(sendsTo(-7991)).toEqual(['sendMessage']);
        })
    );

    it.effect('recounts the same winner after an attendance correction', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const game = yield* twoGroupGame('delivery-recount', [-8001, -8002], 80_000);
            yield* publishPlanned(game);
            const evening = new Date('2026-12-04T20:30:00Z');
            yield* recordResult({ ...game, winner: 1, actorPersonId: null, now: evening });
            const [missing] = yield* db
                .select({ personId: teamMember.personId })
                .from(teamMember)
                .where(eq(teamMember.sessionId, game.sessionId));
            yield* db
                .insert(attendance)
                .values({ sessionId: game.sessionId, personId: missing?.personId ?? '', outcome: 'no_show', source: 'manual' });
            yield* recordResult({ ...game, winner: 1, actorPersonId: null, now: evening });
            const rated = yield* db.select().from(ratingEvent).where(eq(ratingEvent.sessionId, game.sessionId));

            expect(rated).toHaveLength(7);
        })
    );

    it.effect('keeps the old message id when a new message instead of the refused edit is refused too', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const game = yield* twoGroupGame('delivery-new-refused', [-8011, -8012], 80_100);
            yield* publishPlanned(game);
            const [before] = yield* db.select().from(lineupDelivery).where(eq(lineupDelivery.chatId, -8011n));
            yield* swapFirsts(game);
            blocked.set(-8011, refusal('sendMessage', 'Bad Request: not enough rights'));
            const input = {
                ...game,
                locale: 'uk' as const,
                actorPersonId: null,
                approval: ownerApproval,
                privateChatId: null,
                fallback: Option.none(),
                asNewMessage: true
            };
            const plan = yield* planLineup(input);
            yield* publishLineup({ ...input, version: plan.version, fingerprint: plan.fingerprint });
            blocked.delete(-8011);
            const [after] = yield* db.select().from(lineupDelivery).where(eq(lineupDelivery.chatId, -8011n));

            expect(after?.messageId).toBe(before?.messageId);
        })
    );

    it.effect('keeps the recorded result when the changed squad could not be delivered', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const game = yield* twoGroupGame('delivery-result-kept', [-7601, -7602], 76_000);
            yield* publishPlanned(game);
            yield* resultThenSwap(game);
            blocked.set(-7601, refusal('editMessageText', 'Bad Request: message can not be edited'));
            blocked.set(-7602, refusal('editMessageText', 'Bad Request: message can not be edited'));
            yield* publishPlanned(game);
            blocked.delete(-7601);
            blocked.delete(-7602);
            const ranks = yield* db.select({ rank: team.rank }).from(team).where(eq(team.sessionId, game.sessionId)).orderBy(team.ordinal);
            const events = yield* db.select().from(ratingEvent).where(eq(ratingEvent.sessionId, game.sessionId));

            yield* publishPlanned(game);
            const cleared = yield* db.select({ rank: team.rank }).from(team).where(eq(team.sessionId, game.sessionId));
            const left = yield* db.select().from(ratingEvent).where(eq(ratingEvent.sessionId, game.sessionId));

            expect(ranks.map(entry => entry.rank)).toEqual([1, 2]);
            expect(events).toHaveLength(8);
            expect(cleared.map(entry => entry.rank)).toEqual([null, null]);
            expect(left).toEqual([]);
        })
    );

    it.effect('stops a publish that a newer one took over and never stores its squad over the newer one', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const game = yield* twoGroupGame('delivery-taken-over', [-7901, -7902], 79_000);
            const newer = '00000000-0000-4000-8000-000000000002';
            const takeOver = db
                .update(teamDraft)
                .set({ publishToken: newer, publishAt: new Date(0) })
                .where(eq(teamDraft.sessionId, game.sessionId));
            const { published } = yield* publishWhile(game, takeOver);
            const [draft] = yield* db.select().from(teamDraft).where(eq(teamDraft.sessionId, game.sessionId));
            const members = yield* db.select().from(teamMember).where(eq(teamMember.sessionId, game.sessionId));

            expect(published).toMatchObject({ _tag: 'Success', success: { deliveries: [{ status: 'sent' }, { status: 'busy' }] } });
            expect(sendsTo(-7902)).toEqual([]);
            expect(draft?.publishToken).toBe(newer);
            expect(draft?.publishedAt).toBeNull();
            expect(members).toEqual([]);
        })
    );

    it.effect('sends nothing more once the game is cancelled between two sends', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const game = yield* twoGroupGame('delivery-cancelled-midway', [-7911, -7912], 79_100);
            const cancel = db.update(session).set({ status: 'cancelled' }).where(eq(session.id, game.sessionId));
            const { published } = yield* publishWhile(game, cancel);

            expect(published).toMatchObject({
                _tag: 'Success',
                success: { deliveries: [{ status: 'sent' }, { status: 'refused', failure: { code: 'game_over' } }] }
            });
            expect(sendsTo(-7912)).toEqual([]);
        })
    );

    it.effect('keeps the recorded result and the stored squad when the changed squad may not have arrived', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const game = yield* twoGroupGame('delivery-result-uncertain', [-7931, -7932], 79_300);
            yield* publishPlanned(game);
            const before = yield* db
                .select({ personId: teamMember.personId, teamId: teamMember.teamId })
                .from(teamMember)
                .where(eq(teamMember.sessionId, game.sessionId));
            yield* resultThenSwap(game);
            blocked.set(-7931, new Error('socket hang up'));
            blocked.set(-7932, new Error('socket hang up'));
            const published = yield* publishPlanned(game);
            blocked.delete(-7931);
            blocked.delete(-7932);
            const ranks = yield* db.select({ rank: team.rank }).from(team).where(eq(team.sessionId, game.sessionId)).orderBy(team.ordinal);
            const after = yield* db
                .select({ personId: teamMember.personId, teamId: teamMember.teamId })
                .from(teamMember)
                .where(eq(teamMember.sessionId, game.sessionId));

            expect(published.deliveries.map(delivery => delivery.status)).toEqual(['uncertain', 'uncertain']);
            expect(ranks.map(entry => entry.rank)).toEqual([1, 2]);
            expect(after.toSorted((a, b) => a.personId.localeCompare(b.personId))).toEqual(
                before.toSorted((a, b) => a.personId.localeCompare(b.personId))
            );
        })
    );

    it.effect('sends a new message instead of editing when the group moved the line-up to another topic', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const game = yield* twoGroupGame('delivery-topic', [-7941, -7942], 79_400);
            yield* publishPlanned(game);
            yield* db.update(telegramChat).set({ topicId: 7 }).where(eq(telegramChat.chatId, -7941n));
            const plan = yield* planLineup({ ...game, locale: 'uk', privateChatId: null, fallback: Option.none() });
            yield* publishPlanned(game);
            const last = recorder.calls.findLast(call => call.payload.chat_id === -7941);

            expect(plan.deliveries[0]?.messageId).toBeNull();
            expect(sendsTo(-7941)).toEqual(['sendMessage', 'sendMessage']);
            expect(last?.payload.message_thread_id).toBe(7);
        })
    );

    it.effect('rates only who played: not a sign-up that is out and not a marked no-show', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const game = yield* twoGroupGame('delivery-result-roster', [-7951, -7952], 79_500);
            yield* publishPlanned(game);
            const { row } = yield* openDraft(game.communityId, game.sessionId, null);
            const [out = '', missing = ''] = row.state.teams.map(members => members[1] ?? '');
            yield* db
                .update(signup)
                .set({ status: 'out' })
                .where(and(eq(signup.sessionId, game.sessionId), eq(signup.personId, out)));
            yield* db.insert(attendance).values({ sessionId: game.sessionId, personId: missing, outcome: 'no_show', source: 'manual' });
            yield* recordResult({ ...game, winner: 1, actorPersonId: null, now: new Date('2026-12-04T20:30:00Z') });
            const rated = yield* db
                .select({ personId: ratingEvent.personId })
                .from(ratingEvent)
                .where(eq(ratingEvent.sessionId, game.sessionId));

            expect(rated).toHaveLength(6);
            expect(rated.map(entry => entry.personId)).not.toContain(out);
            expect(rated.map(entry => entry.personId)).not.toContain(missing);
        })
    );

    it.effect('treats a fresh claim as busy without a retry, runs one publish of a game at a time and refuses a cancelled game', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const game = yield* twoGroupGame('delivery-busy', [-7701, -7702], 77_000);
            yield* db
                .update(teamDraft)
                .set({ publishToken: '00000000-0000-4000-8000-000000000001', publishAt: new Date(0) })
                .where(eq(teamDraft.sessionId, game.sessionId));
            const held = yield* publishPlanned(game);
            yield* TestClock.adjust('61 seconds');
            blocked.set(-7702, new Error('socket hang up'));
            yield* publishPlanned(game);
            blocked.delete(-7702);
            yield* db
                .update(lineupDelivery)
                .set({ status: 'claimed', updatedAt: new Date(61_000) })
                .where(eq(lineupDelivery.chatId, -7702n));
            const plan = yield* planLineup({ ...game, locale: 'uk', privateChatId: null, fallback: Option.none() });
            const ticket = (plan.deliveries.find(delivery => delivery.chatId === -7702n)?.token ?? '').slice(0, 8);
            const busy = yield* publishPlanned(game, ticket);
            yield* TestClock.adjust('61 seconds');
            const retried = yield* publishPlanned(game, ticket);
            yield* db.update(session).set({ status: 'cancelled' }).where(eq(session.id, game.sessionId));
            const cancelled = yield* publishPlanned(game).pipe(Effect.flip);

            expect(held.deliveries.map(delivery => delivery.status)).toEqual(['busy', 'busy']);
            expect(plan.deliveries.map(delivery => delivery.stored)).toEqual(['sent', 'busy']);
            expect(busy.deliveries.map(delivery => delivery.status)).toEqual(['unchanged', 'busy']);
            expect(retried.deliveries.map(delivery => delivery.status)).toEqual(['unchanged', 'sent']);
            expect(sendsTo(-7701)).toEqual(['sendMessage']);
            expect(cancelled).toMatchObject({ failure: { code: 'game_over' } });
        })
    );

    it.effect('shows in the assistant confirmation every destination, the exact post and that the result will be cleared', () =>
        Effect.gen(function* () {
            const game = yield* twoGroupGame('delivery-assistant-preview', [-7801, -7802], 78_000);
            yield* publishPlanned(game);
            yield* recordResult({ ...game, winner: 1, actorPersonId: null, now: new Date('2026-12-04T20:30:00Z') });
            const { row } = yield* openDraft(game.communityId, game.sessionId, null);
            const { teams } = row.state;
            const action = yield* teamsActionAsOwner(game.communityId, game.sessionId, [
                { ordinal: 1, players: [...(teams[1] ?? [])].map(personId => ({ personId, displayName: '', isGk: false })) },
                { ordinal: 2, players: [...(teams[0] ?? [])].map(personId => ({ personId, displayName: '', isGk: false })) }
            ]);
            const summary = yield* describeAction(action, 'uk', game.communityId);

            expect(summary).toContain('Надішлю в «Group 1» і в «Group 2»:');
            expect(summary).toContain('Player0');
            expect(summary).not.toContain('<');
            expect(summary).toContain('⚠️ Склади змінилися після результату: результат вечора скинеться.');
        })
    );
});
