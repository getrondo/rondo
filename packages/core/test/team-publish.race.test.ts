import { expect, layer } from '@effect/vitest';
import { isEmptyString } from '@rnw-community/shared';
import { person } from '@rondo/db/schema/identity.schema';
import { lineupDelivery, team, teamDraft, teamMember } from '@rondo/db/schema/play.schema';
import { session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { Telegram } from '@rondo/telegram/service/telegram.service';
import { makeRecorder, recordingTelegramLayer } from '@rondo/telegram/testing/recording-telegram.layer';
import { eq } from 'drizzle-orm';
import * as Deferred from 'effect/Deferred';
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import * as Random from 'effect/Random';

import { erasePerson } from '../src/people/erase-person';
import { finishPastSessions } from '../src/sessions/finish-session';
import { swapPlayers } from '../src/teams/draft-state';
import { planLineup } from '../src/teams/lineup-plan';
import { changeDraft, openDraft } from '../src/teams/team-draft.service';
import { recordResult } from '../src/teams/team-result';
import { localPostgresLayer, raceDatabaseUrl } from '../src/testing/local-postgres.layer';

import { publishPlanned, publishWhile, twoGroupGame } from './support/two-group-game';

const recorder = makeRecorder();
const postgresLayer = Layer.mergeAll(localPostgresLayer(raceDatabaseUrl), recordingTelegramLayer(recorder));
const afterKickoff = new Date('2026-12-04T20:30:00Z');

interface Game {
    readonly communityId: string;
    readonly sessionId: string;
}

const game = Effect.fn('test.game')(function* (slug: string) {
    const base = yield* Random.nextIntBetween(1_000_000_000, 2_000_000_000);

    return yield* twoGroupGame(`${slug}-${base}`, [-96_000_000 - base, -97_000_000 - base], base);
});

const swapped = Effect.fn('test.swapped')(function* (target: Game) {
    const { row } = yield* openDraft(target.communityId, target.sessionId, null);
    const [first = '', second = ''] = row.state.teams.map(members => members[0] ?? '');
    yield* changeDraft({ sessionId: target.sessionId, version: row.version, key: 'w', actorPersonId: null }, state =>
        Effect.succeed(swapPlayers(state, first, second))
    );

    return second;
});

const resultOf = (target: Game) => recordResult({ ...target, winner: 1, actorPersonId: null, now: afterKickoff });

const teamOfPlayer = Effect.fn('test.teamOfPlayer')(function* (target: Game, personId: string) {
    const db = yield* Db;
    const rows = yield* db
        .select({ ordinal: team.ordinal, personId: teamMember.personId })
        .from(teamMember)
        .innerJoin(team, eq(team.id, teamMember.teamId))
        .where(eq(teamMember.sessionId, target.sessionId));

    return rows.find(row => row.personId === personId)?.ordinal ?? null;
});

const statusOf = Effect.fn('test.statusOf')(function* (target: Game) {
    const db = yield* Db;
    const [row] = yield* db.select({ status: session.status }).from(session).where(eq(session.id, target.sessionId));

    return row?.status;
});

layer(postgresLayer, { timeout: 120_000, excludeTestServices: true })('a line-up publish on a real Postgres', it => {
    it.effect.skipIf(isEmptyString(raceDatabaseUrl))('makes a result and the end of the game wait for the line-up that is being sent', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const target = yield* game('publish-defer');
            yield* publishPlanned(target);
            const moved = yield* swapped(target);
            yield* db
                .update(session)
                .set({ startsAt: new Date('2020-01-01T18:00:00Z') })
                .where(eq(session.id, target.sessionId));
            const result = yield* publishWhile(target, Effect.flip(resultOf(target)));
            const finish = yield* swapped(target).pipe(
                Effect.andThen(publishWhile(target, finishPastSessions(new Date('2021-01-01T00:00:00Z'))))
            );
            const status = yield* statusOf(target);
            const later = yield* finishPastSessions(new Date('2021-01-01T00:00:00Z'));

            expect(result.during).toMatchObject({ _tag: 'Success', value: { failure: { code: 'publish_busy' } } });
            expect(result.published._tag).toBe('Success');
            expect(finish.during).toMatchObject({ _tag: 'Success', value: { finished: 0, failed: 0 } });
            expect(status).toBe('open');
            expect(later.finished).toBeGreaterThanOrEqual(1);
            expect(yield* teamOfPlayer(target, moved)).toBe(2);
        })
    );

    it.effect.skipIf(isEmptyString(raceDatabaseUrl))('never replaces the squad of a result recorded after the claim ran out', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const target = yield* game('publish-result');
            yield* publishPlanned(target);
            const moved = yield* swapped(target);
            const expireAndRecord = db
                .update(teamDraft)
                .set({ publishAt: new Date(0) })
                .where(eq(teamDraft.sessionId, target.sessionId))
                .pipe(Effect.andThen(resultOf(target)));
            const raced = yield* publishWhile(target, expireAndRecord);
            const kept = yield* teamOfPlayer(target, moved);
            const ranks = yield* db
                .select({ rank: team.rank })
                .from(team)
                .where(eq(team.sessionId, target.sessionId))
                .orderBy(team.ordinal);
            const plan = yield* planLineup({ ...target, locale: 'uk', privateChatId: null, fallback: Option.none() });

            expect(raced.during._tag).toBe('Success');
            expect(raced.published).toMatchObject({ _tag: 'Failure', failure: { failure: { code: 'teams_unsaved' } } });
            expect(kept).toBe(2);
            expect(ranks.map(row => row.rank)).toEqual([1, 2]);
            expect(plan.clearsResult).toBe(true);
            expect(plan.deliveries.map(delivery => delivery.isDue)).toEqual([true, true]);
        })
    );

    it.effect.skipIf(isEmptyString(raceDatabaseUrl))('stores no squad of a game cancelled during the send', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const target = yield* game('publish-cancel');
            const { row } = yield* openDraft(target.communityId, target.sessionId, null);
            const cancel = db.update(session).set({ status: 'cancelled' }).where(eq(session.id, target.sessionId));
            const raced = yield* publishWhile(target, cancel);

            expect(raced.published).toMatchObject({
                _tag: 'Success',
                success: { deliveries: [{ status: 'sent' }, { status: 'refused', failure: { code: 'game_over' } }] }
            });
            expect(yield* teamOfPlayer(target, row.state.teams[0]?.[0] ?? '')).toBeNull();
        })
    );

    it.effect.skipIf(isEmptyString(raceDatabaseUrl))(
        'stores the squad with the first receipt, so an interrupted publish is never without it',
        () =>
            Effect.gen(function* () {
                const db = yield* Db;
                const telegram = yield* Telegram;
                const target = yield* game('publish-cut');
                const { row } = yield* openDraft(target.communityId, target.sessionId, null);
                const isSecond = yield* Deferred.make<boolean>();
                let sends = 0;
                const fiber = yield* Effect.forkChild(
                    publishPlanned(target).pipe(
                        Effect.provideService(Telegram, {
                            ...telegram,
                            call: (method, request) => {
                                sends += 1;

                                return sends === 1
                                    ? telegram.call(method, request)
                                    : Deferred.succeed(isSecond, true).pipe(Effect.andThen(Effect.never));
                            }
                        })
                    )
                );
                yield* Deferred.await(isSecond);
                const ordinal = yield* teamOfPlayer(target, row.state.teams[0]?.[0] ?? '');
                yield* Fiber.interrupt(fiber);
                yield* db
                    .update(teamDraft)
                    .set({ publishAt: new Date(0) })
                    .where(eq(teamDraft.sessionId, target.sessionId));
                const retried = yield* publishPlanned(target);

                expect(ordinal).toBe(1);
                expect(retried.deliveries[0]?.status).toBe('unchanged');
                expect(yield* teamOfPlayer(target, row.state.teams[0]?.[0] ?? '')).toBe(1);
            })
    );

    it.effect.skipIf(isEmptyString(raceDatabaseUrl))('never answers unchanged for a receipt whose squad is not stored', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const target = yield* game('publish-orphan');
            const { row } = yield* openDraft(target.communityId, target.sessionId, null);
            yield* publishPlanned(target);
            yield* db.delete(team).where(eq(team.sessionId, target.sessionId));
            const retried = yield* publishPlanned(target);
            const receipts = yield* db.select().from(lineupDelivery).where(eq(lineupDelivery.sessionId, target.sessionId));

            expect(retried.deliveries.map(delivery => delivery.status)).toEqual(['edited', 'edited']);
            expect(receipts.map(receipt => receipt.status)).toEqual(['sent', 'sent']);
            expect(yield* teamOfPlayer(target, row.state.teams[1]?.[0] ?? '')).toBe(2);
        })
    );

    it.effect.skipIf(isEmptyString(raceDatabaseUrl))(
        'stops at an erasure during the send: nothing more is posted and no name is stored',
        () =>
            Effect.gen(function* () {
                const db = yield* Db;
                const target = yield* game('publish-erase');
                const { row } = yield* openDraft(target.communityId, target.sessionId, null);
                const personId = row.state.teams[0]?.[0] ?? '';
                const [erasedPlayer] = yield* db.select({ name: person.displayName }).from(person).where(eq(person.id, personId));
                const callsBefore = recorder.calls.length;
                const tokenOf = db
                    .select({ token: teamDraft.publishToken })
                    .from(teamDraft)
                    .where(eq(teamDraft.sessionId, target.sessionId));
                const raced = yield* publishWhile(
                    target,
                    erasePerson({ communityId: target.communityId, personId }).pipe(Effect.andThen(tokenOf))
                );
                const receipts = yield* db.select().from(lineupDelivery).where(eq(lineupDelivery.sessionId, target.sessionId));
                const posted = recorder.calls.length - callsBefore;

                expect(raced.during).toMatchObject({ _tag: 'Success', value: [{ token: null }] });
                expect(raced.published).toMatchObject({
                    _tag: 'Success',
                    success: { deliveries: [{ status: 'uncertain' }, { status: 'busy' }] }
                });
                expect(posted).toBe(1);
                expect(receipts.map(receipt => [receipt.status, receipt.text])).toEqual([
                    ['uncertain', null],
                    ['uncertain', null]
                ]);
                expect(yield* teamOfPlayer(target, personId)).toBeNull();

                const plan = yield* planLineup({ ...target, locale: 'uk', privateChatId: null, fallback: Option.none() });
                expect(plan.deliveries.map(({ html }) => html).join('\n')).not.toContain(erasedPlayer?.name ?? '');
                yield* publishPlanned(target, receipts[0]?.token ?? '');
                expect(yield* teamOfPlayer(target, personId)).toBe(1);
            })
    );
});
