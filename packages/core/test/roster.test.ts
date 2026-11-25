import { expect, layer } from '@effect/vitest';
import { telegramAccount } from '@rondo/db/schema/identity.schema';
import { auditLog } from '@rondo/db/schema/platform.schema';
import { signup, signupEvent } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, asc, eq, inArray } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';

import { syncMember } from '../src/identity/telegram-user';
import { arePeopleOf } from '../src/people/people.service';
import { addGuests, joinGame, removeFromGame } from '../src/signups/roster.service';
import { recordedTelegramDbLayer } from '../src/testing/recorded-telegram.layer';
import { seedGame } from '../src/testing/seed-game';

const gameWith = Effect.fn('test.gameWith')(function* (slug: string, capacityMax: number, players: number) {
    const db = yield* Db;
    const { communityId, sessionId } = yield* seedGame(slug, capacityMax);
    const people: string[] = [];

    for (let index = 0; index < players; index += 1) {
        const personId = yield* syncMember(
            communityId,
            { id: BigInt(70_000 + index + capacityMax * 100), firstName: `Roster ${index}` },
            'active'
        );
        yield* db.insert(signup).values({ sessionId, personId, status: 'in' });
        people.push(personId);
    }

    return { communityId, sessionId, people, change: { communityId, sessionId, actorPersonId: null } };
});

const statusOf = Effect.fn('test.statusOf')(function* (sessionId: string) {
    const db = yield* Db;

    return yield* db
        .select({ personId: signup.personId, status: signup.status, isGuest: signup.isGuest, hostId: signup.guestOfPersonId })
        .from(signup)
        .where(eq(signup.sessionId, sessionId))
        .orderBy(asc(signup.createdAt));
});

layer(recordedTelegramDbLayer, { timeout: 60_000 })('roster changes by an admin', it => {
    it.effect('adds guests of a host into the limit as one-game people without Telegram, waitlisting over it', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, sessionId, people, change } = yield* gameWith('roster-guests', 4, 2);
            const [host = ''] = people;
            const added = yield* addGuests(change, { hostPersonId: host, count: 3, name: null });
            const named = yield* addGuests(change, { hostPersonId: null, count: 1, name: 'Friend Ivan' });
            const outsider = yield* addGuests(change, { hostPersonId: '00000000-0000-7000-8000-000000000000', count: 1, name: null }).pipe(
                Effect.exit
            );
            const accounts = yield* db
                .select()
                .from(telegramAccount)
                .where(
                    inArray(
                        telegramAccount.personId,
                        [...added, ...named].map(({ personId }) => personId)
                    )
                );

            expect(added.map(({ status }) => status)).toEqual(['in', 'in', 'waitlisted']);
            expect(named.map(({ status }) => status)).toEqual(['waitlisted']);
            expect((yield* statusOf(sessionId)).filter(({ isGuest }) => isGuest).map(({ hostId }) => hostId)).toEqual([
                host,
                host,
                host,
                null
            ]);
            expect(accounts).toEqual([]);
            expect(Exit.isFailure(outsider)).toBe(true);
            expect(
                yield* arePeopleOf(
                    communityId,
                    added.map(({ personId }) => personId)
                )
            ).toBe(false);
        })
    );

    it.effect('removes a host with or without the guests and promotes the earliest waiting with events and audit', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { sessionId, people, change } = yield* gameWith('roster-remove', 3, 3);
            const [host = '', second = '', third = ''] = people;
            const guests = yield* addGuests(change, { hostPersonId: host, count: 2, name: null });
            const alone = yield* removeFromGame(change, { personId: second, withGuests: false, isNoShow: true });
            const removed = yield* removeFromGame(change, { personId: host, withGuests: true, isNoShow: false });
            const events = yield* db
                .select({ toStatus: signupEvent.toStatus })
                .from(signupEvent)
                .innerJoin(signup, eq(signup.id, signupEvent.signupId))
                .where(and(eq(signup.sessionId, sessionId), eq(signup.personId, guests[0]?.personId ?? '')));
            const audits = yield* db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.entityId, sessionId));
            const rejoined = yield* joinGame(change, [host, third]);

            expect(guests.map(({ status }) => status)).toEqual(['waitlisted', 'waitlisted']);
            expect(alone.promoted.map(({ personId }) => personId)).toEqual([guests[0]?.personId]);
            expect(removed.removed).toHaveLength(3);
            expect(removed.promoted).toEqual([]);
            expect(events.map(({ toStatus }) => toStatus)).toEqual(['waitlisted', 'in', 'out']);
            expect(audits.map(({ action }) => action)).toEqual(['session.create', 'signup.guest', 'signup.no_show', 'signup.remove']);
            expect(rejoined).toEqual({ joined: [host], waiting: [] });
        })
    );
});
