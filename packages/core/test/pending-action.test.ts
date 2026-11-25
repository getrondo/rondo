import { expect, layer } from '@effect/vitest';
import { person } from '@rondo/db/schema/identity.schema';
import { attendance, session, signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { describeAction } from '../src/actions/describe-action';
import { decideAction, proposeAction } from '../src/actions/pending-action.service';
import { mergePeople } from '../src/people/people.service';
import { createSession } from '../src/sessions/session.service';
import { recordedTelegramDbLayer, recorder } from '../src/testing/recorded-telegram.layer';
import { seedCommunity, seedConfig } from '../src/testing/seed-community';

import type { Action } from '../src/actions/action.model';

const admin = 42n;

const contextFor = (chatId: bigint | null) => (communityId: string) =>
    Effect.succeed({
        communityId,
        timezone: 'Europe/Vienna',
        group: Option.fromNullishOr(chatId).pipe(Option.map(id => ({ chatId: id, topicId: null }))),
        groupLocale: 'uk' as const,
        actorPersonId: null
    });

layer(recordedTelegramDbLayer, { timeout: 60_000 })('confirmed admin actions', it => {
    it.effect('runs a proposal only after its requester confirms it', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, venueIdByName } = yield* seedCommunity(seedConfig('actions-fc'));
            const action: Action = {
                _tag: 'create_session',
                localDate: '2026-12-05',
                localTime: '10:00',
                venueId: venueIdByName.get('Park Field') ?? null,
                capacityMax: 16,
                fieldsPlanned: 2,
                title: null,
                announce: true
            };
            const summary = yield* describeAction(action, 'uk', communityId);
            const actionId = yield* proposeAction({ communityId, tgUserId: admin, action, summary });
            const before = yield* db.select().from(session).where(eq(session.communityId, communityId));
            const stranger = yield* decideAction({ actionId, tgUserId: 7n, confirm: true, context: contextFor(-100n) });
            const confirmed = yield* decideAction({ actionId, tgUserId: admin, confirm: true, context: contextFor(-100n) });
            const again = yield* decideAction({ actionId, tgUserId: admin, confirm: true, context: contextFor(-100n) });
            const after = yield* db.select().from(session).where(eq(session.communityId, communityId));

            const sent = recorder.calls.find(call => call.method === 'sendPoll')?.payload;

            expect(summary).toBe(
                `➕ Нова гра: Сб 05.12 10:00 · Park Field, 2 поля, 16 місць і опублікувати опитування в групі:\n\n${String(sent?.question)}\n\n▫️ ✅ Граю\n▫️ ❌ Не граю`
            );
            expect(recorder.calls.at(-1)).toMatchObject({ method: 'pinChatMessage', payload: { chat_id: -100 } });
            expect(sent).toMatchObject({ options: [{ text: '✅ Граю' }, { text: '❌ Не граю' }] });
            expect(before).toHaveLength(0);
            expect(stranger._tag).toBe('missing');
            expect(confirmed._tag).toBe('done');
            expect(again._tag).toBe('missing');
            expect(after).toMatchObject([{ fieldsPlanned: 2 }]);
            expect(recorder.calls.filter(call => call.method === 'sendPoll')).toHaveLength(1);
        })
    );

    it.effect('reports a failed action and expires stale ones', () =>
        Effect.gen(function* () {
            const { communityId } = yield* seedCommunity(seedConfig('actions-fail-fc'));
            const db = yield* Db;
            const unlinked: Action = {
                _tag: 'create_session',
                localDate: '2026-12-05',
                localTime: '10:00',
                venueId: null,
                capacityMax: null,
                title: null,
                announce: true
            };
            const create = yield* proposeAction({ communityId, tgUserId: admin, action: unlinked, summary: 'create' });
            const notCreated = yield* decideAction({ actionId: create, tgUserId: admin, confirm: true, context: contextFor(null) });
            const sessions = yield* db.select().from(session).where(eq(session.communityId, communityId));
            const announce: Action = { _tag: 'announce_session', sessionId: '00000000-0000-7000-8000-000000000000' };
            const failing = yield* proposeAction({ communityId, tgUserId: admin, action: announce, summary: 'announce' });
            const stale = yield* proposeAction({
                communityId,
                tgUserId: admin,
                action: announce,
                summary: 'stale',
                now: new Date('2026-01-01T00:00:00Z')
            });
            const rejected = yield* proposeAction({ communityId, tgUserId: admin, action: announce, summary: 'rejected' });

            const failed = yield* decideAction({ actionId: failing, tgUserId: admin, confirm: true, context: contextFor(null) });
            const expired = yield* decideAction({
                actionId: stale,
                tgUserId: admin,
                confirm: true,
                context: contextFor(null),
                now: new Date('2026-06-01T00:00:00Z')
            });
            const lateTap = yield* decideAction({ actionId: stale, tgUserId: admin, confirm: true, context: contextFor(null) });
            const declined = yield* decideAction({ actionId: rejected, tgUserId: admin, confirm: false, context: contextFor(null) });

            expect(notCreated).toMatchObject({ _tag: 'failed', failure: { code: 'no_group' } });
            expect(sessions).toEqual([]);
            expect(failed).toMatchObject({ _tag: 'failed' });
            expect([expired._tag, lateTap._tag]).toEqual(['expired', 'expired']);
            expect(declined._tag).toBe('rejected');
        })
    );

    it.effect('refuses to merge two records that played one game, and merges them once they share none', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedCommunity(seedConfig('merge-fc'));
            const [nickname, fullName] = yield* db
                .insert(person)
                .values([{ displayName: 'Ваня' }, { displayName: 'Іван Петренко' }])
                .returning({ id: person.id });
            const nicknameId = nickname?.id ?? '';
            const fullNameId = fullName?.id ?? '';
            const sessionIds = yield* Effect.all(
                ['2026-11-01', '2026-11-02'].map(localDate =>
                    createSession({
                        communityId,
                        timezone: 'Europe/Vienna',
                        localDate,
                        localTime: '19:00',
                        venueId: null,
                        capacityMax: null,
                        title: null,
                        actorPersonId: null
                    })
                )
            );
            yield* db.insert(attendance).values([
                { sessionId: sessionIds[0] ?? '', personId: nicknameId, outcome: 'attended' },
                { sessionId: sessionIds[1] ?? '', personId: nicknameId, outcome: 'attended' },
                { sessionId: sessionIds[1] ?? '', personId: fullNameId, outcome: 'attended' }
            ]);

            const merge = mergePeople({ communityId, fromPersonId: nicknameId, intoPersonId: fullNameId, actorPersonId: null });
            const refused = yield* Effect.flip(merge);
            const untouched = yield* db.select().from(attendance).where(eq(attendance.personId, nicknameId));
            yield* db.delete(attendance).where(and(eq(attendance.personId, fullNameId), eq(attendance.sessionId, sessionIds[1] ?? '')));
            yield* merge;
            const games = yield* db.select().from(attendance).where(eq(attendance.personId, fullNameId));
            const [tombstone] = yield* db.select().from(person).where(eq(person.id, nicknameId));

            expect(refused._tag).toBe('ActionFailedError');
            expect(untouched).toHaveLength(2);
            expect(games).toHaveLength(2);
            expect(tombstone?.mergedIntoPersonId).toBe(fullNameId);
        })
    );

    it.effect('refuses former admins, other communities and games that are over', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const own = yield* seedCommunity(seedConfig('scope-own-fc'));
            const foreign = yield* seedCommunity(seedConfig('scope-foreign-fc'));
            const game = (communityId: string) =>
                createSession({
                    communityId,
                    timezone: 'Europe/Vienna',
                    localDate: '2026-11-03',
                    localTime: '19:00',
                    venueId: null,
                    capacityMax: null,
                    title: null,
                    actorPersonId: null
                });
            const ownId = yield* game(own.communityId);
            const foreignId = yield* game(foreign.communityId);
            const decide = Effect.fn('test.decide')(function* (sessionId: string, tgUserId: bigint) {
                const action: Action = { _tag: 'cancel_session', sessionId, reason: 'weather', notify: false };
                const actionId = yield* proposeAction({ communityId: own.communityId, tgUserId, action, summary: 'cancel' });

                return yield* decideAction({ actionId, tgUserId, confirm: true, context: contextFor(null) });
            });
            const formerAdmin = yield* decide(ownId, 7n);
            const otherCommunity = yield* decide(foreignId, admin);
            yield* db.update(session).set({ status: 'played' }).where(eq(session.id, ownId));
            const over = yield* decide(ownId, admin);
            const statuses = yield* db.select({ status: session.status }).from(session).where(eq(session.id, foreignId));

            expect(formerAdmin).toMatchObject({ _tag: 'failed', failure: { code: 'not_admin' } });
            expect(otherCommunity).toMatchObject({ _tag: 'failed' });
            expect(over).toMatchObject({ _tag: 'failed', failure: { code: 'game_over' } });
            expect(statuses).toEqual([{ status: 'open' }]);
        })
    );

    it.effect('refuses to merge two people who signed up for the same game', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedCommunity(seedConfig('merge-signup-fc'));
            const people = yield* db
                .insert(person)
                .values([{ displayName: 'One' }, { displayName: 'Two' }])
                .returning({ id: person.id });
            const sessionId = yield* createSession({
                communityId,
                timezone: 'Europe/Vienna',
                localDate: '2026-11-04',
                localTime: '19:00',
                venueId: null,
                capacityMax: null,
                title: null,
                actorPersonId: null
            });
            yield* db.insert(signup).values(people.map(({ id }) => ({ sessionId, personId: id, status: 'in' as const })));
            const [from, into] = people;
            const error = yield* Effect.flip(
                mergePeople({ communityId, fromPersonId: from?.id ?? '', intoPersonId: into?.id ?? '', actorPersonId: null })
            );

            expect(error._tag).toBe('ActionFailedError');
        })
    );
});
