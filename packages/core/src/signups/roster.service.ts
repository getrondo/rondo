import { isDefined, isNotEmptyArray, isNotEmptyString } from '@rnw-community/shared';
import { person } from '@rondo/db/schema/identity.schema';
import { attendance, signup, signupEvent } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

import { recordAudit } from '../audit/record-audit';
import { ActionFailedError } from '../error/action-failed.error';
import { arePeopleOf } from '../people/people.service';
import { requireSession } from '../sessions/session.service';

import { fieldPlayersIn, fillFreeSeats, lockSession } from './signup.service';

const CandidatesSchema = Schema.Struct({ rows: Schema.Array(Schema.Struct({ person_id: Schema.String, display_name: Schema.String })) });

interface RosterChange {
    readonly communityId: string;
    readonly sessionId: string;
    readonly actorPersonId: string | null;
}

const lockedGame = Effect.fn('Core.lockedGame')(function* (change: RosterChange) {
    yield* requireSession(change.communityId, change.sessionId);
    const locked = yield* lockSession(change.sessionId);

    return Option.isSome(locked) ? locked.value : yield* ActionFailedError.make({ reason: 'the game is already over or cancelled' });
});

const setStatus = Effect.fn('Core.setRosterStatus')(function* (
    change: RosterChange,
    personId: string,
    status: 'in' | 'out' | 'waitlisted'
) {
    const db = yield* Db;
    const [previous] = yield* db
        .select({ id: signup.id, status: signup.status })
        .from(signup)
        .where(and(eq(signup.sessionId, change.sessionId), eq(signup.personId, personId)));
    const [stored] = yield* db
        .insert(signup)
        .values({ sessionId: change.sessionId, personId, status })
        .onConflictDoUpdate({ target: [signup.sessionId, signup.personId], set: { status } })
        .returning({ id: signup.id });

    if (previous?.status !== status) {
        yield* db.insert(signupEvent).values({
            signupId: stored?.id ?? '',
            fromStatus: previous?.status ?? null,
            toStatus: status,
            actorPersonId: change.actorPersonId
        });
    }
});

export const addGuests = Effect.fn('Core.addGuests')(function* (
    change: RosterChange,
    guest: { readonly hostPersonId: string | null; readonly count: number; readonly name: string | null; readonly isOverLimit?: boolean }
) {
    const db = yield* Db;

    return yield* db.transaction(() =>
        Effect.gen(function* () {
            const game = yield* lockedGame(change);
            const [host] = isDefined(guest.hostPersonId)
                ? yield* db
                      .select({ displayName: person.displayName })
                      .from(signup)
                      .innerJoin(person, eq(person.id, signup.personId))
                      .where(and(eq(signup.sessionId, change.sessionId), eq(signup.personId, guest.hostPersonId), eq(signup.status, 'in')))
                : [];

            if (isDefined(guest.hostPersonId) && !isDefined(host)) {
                return yield* ActionFailedError.make({ reason: 'the host does not play in this game' });
            }

            const existing = yield* db
                .select({ personId: signup.personId })
                .from(signup)
                .where(and(eq(signup.sessionId, change.sessionId), eq(signup.isGuest, true)));
            const added: { readonly personId: string; readonly status: 'in' | 'waitlisted' }[] = [];

            for (let index = 0; index < Math.max(1, Math.min(guest.count, 9)); index += 1) {
                const numbered = `${isDefined(host) ? `${host.displayName} ` : ''}+${existing.length + index + 1}`;
                const typed = guest.name?.trim() ?? '';
                const displayName = isNotEmptyString(typed) && guest.count === 1 ? typed : numbered;
                const [created] = yield* db.insert(person).values({ displayName, source: 'manual' }).returning({ id: person.id });
                const personId = created?.id ?? '';
                const taken = yield* fieldPlayersIn(change.sessionId, null);
                const status = guest.isOverLimit === true || !isDefined(game.capacityMax) || taken < game.capacityMax ? 'in' : 'waitlisted';
                const [stored] = yield* db
                    .insert(signup)
                    .values({ sessionId: change.sessionId, personId, status, isGuest: true, guestOfPersonId: guest.hostPersonId })
                    .returning({ id: signup.id });
                yield* db.insert(signupEvent).values({ signupId: stored?.id ?? '', toStatus: status, actorPersonId: change.actorPersonId });
                added.push({ personId, status });
            }

            yield* fillFreeSeats(change.sessionId, game.capacityMax);
            yield* recordAudit({
                communityId: change.communityId,
                actorPersonId: change.actorPersonId,
                action: 'signup.guest',
                entityType: 'session',
                entityId: change.sessionId,
                diff: { host: guest.hostPersonId, count: added.length }
            });

            return added;
        })
    );
});

export const guestsOf = Effect.fn('Core.guestsOf')(function* (sessionId: string, hostPersonId: string) {
    const db = yield* Db;

    return yield* db
        .select({ personId: signup.personId })
        .from(signup)
        .where(
            and(
                eq(signup.sessionId, sessionId),
                eq(signup.guestOfPersonId, hostPersonId),
                eq(signup.isGuest, true),
                inArray(signup.status, ['in', 'waitlisted'])
            )
        );
});

export const waitingOf = Effect.fn('Core.waitingOf')(function* (sessionId: string) {
    const db = yield* Db;
    const rows = yield* db
        .select({ personId: signup.personId, displayName: person.displayName })
        .from(signup)
        .innerJoin(person, eq(person.id, signup.personId))
        .where(and(eq(signup.sessionId, sessionId), eq(signup.status, 'waitlisted')))
        .orderBy(asc(signup.updatedAt));
    const taken = yield* fieldPlayersIn(sessionId, null);

    return { waiting: rows, taken };
});

export const removeFromGame = Effect.fn('Core.removeFromGame')(function* (
    change: RosterChange,
    removal: { readonly personId: string; readonly withGuests: boolean; readonly isNoShow: boolean }
) {
    const db = yield* Db;

    return yield* db.transaction(() =>
        Effect.gen(function* () {
            const game = yield* lockedGame(change);
            const guests = removal.withGuests ? yield* guestsOf(change.sessionId, removal.personId) : [];
            const removed = [removal.personId, ...guests.map(({ personId }) => personId)];

            for (const personId of removed) {
                yield* setStatus(change, personId, 'out');
            }

            if (removal.isNoShow) {
                yield* db
                    .insert(attendance)
                    .values({
                        sessionId: change.sessionId,
                        personId: removal.personId,
                        outcome: 'no_show',
                        source: 'manual',
                        recordedBy: change.actorPersonId
                    })
                    .onConflictDoUpdate({
                        target: [attendance.sessionId, attendance.personId],
                        set: { outcome: 'no_show', source: 'manual' }
                    });
            }

            const promoted = yield* fillFreeSeats(change.sessionId, game.capacityMax);
            yield* recordAudit({
                communityId: change.communityId,
                actorPersonId: change.actorPersonId,
                action: removal.isNoShow ? 'signup.no_show' : 'signup.remove',
                entityType: 'session',
                entityId: change.sessionId,
                diff: { removed, promoted: promoted.map(({ personId }) => personId) }
            });

            return { removed, promoted };
        })
    );
});

export const joinGame = Effect.fn('Core.joinGame')(function* (change: RosterChange, personIds: readonly string[], isOverLimit = false) {
    const db = yield* Db;

    if (!isNotEmptyArray(personIds)) {
        return { joined: [], waiting: [] };
    }

    return yield* db.transaction(() =>
        Effect.gen(function* () {
            const game = yield* lockedGame(change);
            const known = yield* db
                .select({ personId: signup.personId, status: signup.status })
                .from(signup)
                .where(and(eq(signup.sessionId, change.sessionId), inArray(signup.personId, [...personIds])));
            const coming = personIds.filter(personId => known.find(row => row.personId === personId)?.status !== 'in');

            if (!(yield* arePeopleOf(change.communityId, coming))) {
                return yield* ActionFailedError.make({ reason: 'player not found in this community' });
            }
            const free = isDefined(game.capacityMax) ? game.capacityMax - (yield* fieldPlayersIn(change.sessionId, null)) : coming.length;
            const joined = isOverLimit ? coming : coming.slice(0, Math.max(0, free));
            const waiting = coming.filter(personId => !joined.includes(personId));

            for (const personId of joined) {
                yield* setStatus(change, personId, 'in');
            }

            for (const personId of waiting) {
                yield* setStatus(change, personId, 'waitlisted');
            }

            if (isNotEmptyArray(joined)) {
                yield* db
                    .delete(attendance)
                    .where(
                        and(
                            eq(attendance.sessionId, change.sessionId),
                            inArray(attendance.personId, joined),
                            eq(attendance.outcome, 'no_show'),
                            eq(attendance.source, 'manual')
                        )
                    );
            }

            yield* fillFreeSeats(change.sessionId, game.capacityMax);

            yield* recordAudit({
                communityId: change.communityId,
                actorPersonId: change.actorPersonId,
                action: 'signup.join',
                entityType: 'session',
                entityId: change.sessionId,
                diff: { joined, waiting }
            });

            return { joined, waiting };
        })
    );
});

export const joinCandidates = Effect.fn('Core.joinCandidates')(function* (communityId: string, sessionId: string, limit: number) {
    const db = yield* Db;
    const result = yield* db.execute(sql`
        with game as (select local_date from scheduling.session where id = ${sessionId}::uuid and community_id = ${communityId}::uuid)
        select person.id as person_id, person.display_name, count(played.session_id)::int as games
        from identity.person person
        join org.membership member on member.person_id = person.id and member.community_id = ${communityId}::uuid and member.status = 'active'
        cross join game
        left join scheduling.attendance played on played.person_id = person.id and played.outcome = 'attended' and exists (
            select 1 from scheduling.session earlier where earlier.id = played.session_id and earlier.community_id = ${communityId}::uuid
                and extract(dow from earlier.local_date) = extract(dow from game.local_date)
                and earlier.local_date >= game.local_date - 84 and earlier.local_date < game.local_date
        )
        where person.merged_into_person_id is null and not exists (
            select 1 from scheduling.signup seat where seat.session_id = ${sessionId}::uuid and seat.person_id = person.id and seat.status = 'in'
        )
        group by person.id, person.display_name
        order by games desc, person.display_name
        limit ${limit}
    `);
    const { rows } = yield* Schema.decodeUnknownEffect(CandidatesSchema)(result).pipe(Effect.orDie);

    return rows.map(row => ({ personId: row.person_id, displayName: row.display_name }));
});
