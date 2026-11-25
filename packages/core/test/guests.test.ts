import { expect, layer } from '@effect/vitest';
import { lineupEntry, team, teamMember } from '@rondo/db/schema/play.schema';
import { attendance, signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { syncMember } from '../src/identity/telegram-user';
import { arePeopleOf, searchPeople } from '../src/people/people.service';
import { finishPastSessions } from '../src/sessions/finish-session';
import { createSession } from '../src/sessions/session.service';
import { addGuests, joinCandidates, joinGame } from '../src/signups/roster.service';
import { recordedTelegramDbLayer } from '../src/testing/recorded-telegram.layer';
import { seedGame } from '../src/testing/seed-game';

const attendedAfterFinishing = Effect.fn('test.attendedAfterFinishing')(function* (sessionId: string) {
    const db = yield* Db;
    yield* finishPastSessions(new Date('2026-12-05T00:00:00Z'));

    return yield* db.select({ personId: attendance.personId }).from(attendance).where(eq(attendance.sessionId, sessionId));
});

layer(recordedTelegramDbLayer, { timeout: 60_000 })('guests of one game', it => {
    it.effect('keeps a guest queued while a typed squad without a poll holds every seat', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, sessionId } = yield* seedGame('guests-typed-seats', 2);
            const squad = yield* Effect.all(
                [1, 2].map(index => syncMember(communityId, { id: BigInt(88_400 + index), firstName: `Seat${index}` }, 'active'))
            );
            yield* db.insert(team).values({ sessionId, ordinal: 1, publishedAt: new Date('2026-12-04T17:00:00Z') });
            yield* db.insert(lineupEntry).values(
                squad.map((personId, index) => ({
                    sessionId,
                    messageId: 1,
                    teamOrdinal: 1,
                    position: index + 1,
                    personId,
                    resolvedBy: 'manual' as const
                }))
            );
            const [guest] = yield* addGuests(
                { communityId, sessionId, actorPersonId: null },
                { hostPersonId: squad[0] ?? '', count: 1, name: null }
            );
            const [stored] = yield* db
                .select({ status: signup.status })
                .from(signup)
                .where(eq(signup.personId, guest?.personId ?? ''));

            expect(guest?.status).toBe('waitlisted');
            expect(stored?.status).toBe('waitlisted');
        })
    );

    it.effect('counts a typed squad member whose «no» is older than the squad and keeps the attendance of the undecided', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, sessionId } = yield* seedGame('guests-older-no');
            const [stayed = '', early = '', late = '', undecided = ''] = yield* Effect.all(
                [1, 2, 3, 4].map(index => syncMember(communityId, { id: BigInt(88_300 + index), firstName: `Typed${index}` }, 'active'))
            );
            yield* db.insert(signup).values([
                { sessionId, personId: stayed, status: 'in' },
                { sessionId, personId: early, status: 'out', updatedAt: new Date('2026-12-04T16:00:00Z') },
                { sessionId, personId: late, status: 'out', updatedAt: new Date('2026-12-04T18:00:00Z') }
            ]);
            yield* db.insert(team).values({ sessionId, ordinal: 1, publishedAt: new Date('2026-12-04T17:00:00Z') });
            yield* db.insert(lineupEntry).values(
                [stayed, early, late].map((personId, index) => ({
                    sessionId,
                    messageId: 1,
                    teamOrdinal: 1,
                    position: index + 1,
                    personId,
                    resolvedBy: 'manual' as const
                }))
            );
            yield* db.insert(attendance).values([
                { sessionId, personId: late, outcome: 'attended', source: 'bot' },
                { sessionId, personId: undecided, outcome: 'attended', source: 'bot' }
            ]);
            const attended = yield* attendedAfterFinishing(sessionId);

            expect(attended.map(row => row.personId).toSorted()).toEqual([stayed, early, undecided].toSorted());
        })
    );

    it.effect('reconciles the automatic attendance with the final roster and keeps what an admin marked', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, sessionId } = yield* seedGame('guests-reconciled');
            const [stayed = '', gone = '', marked = ''] = yield* Effect.all(
                [1, 2, 3].map(index => syncMember(communityId, { id: BigInt(88_200 + index), firstName: `Final${index}` }, 'active'))
            );
            yield* db.insert(signup).values([
                { sessionId, personId: stayed, status: 'in' },
                { sessionId, personId: gone, status: 'out' },
                { sessionId, personId: marked, status: 'in' }
            ]);
            yield* db.insert(attendance).values([
                { sessionId, personId: gone, outcome: 'attended', source: 'bot' },
                { sessionId, personId: marked, outcome: 'no_show', source: 'manual' }
            ]);
            yield* finishPastSessions(new Date('2026-12-05T00:00:00Z'));
            const rows = yield* db
                .select({ personId: attendance.personId, outcome: attendance.outcome })
                .from(attendance)
                .where(eq(attendance.sessionId, sessionId));

            expect(rows.toSorted((a, b) => a.personId.localeCompare(b.personId))).toEqual(
                [
                    { personId: stayed, outcome: 'attended' },
                    { personId: marked, outcome: 'no_show' }
                ].toSorted((a, b) => a.personId.localeCompare(b.personId))
            );
        })
    );

    it.effect('keeps a guest inside his game: not found, not joinable elsewhere and never counted as attended', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, sessionId } = yield* seedGame('guests-one-game');
            const host = yield* syncMember(communityId, { id: 88_001n, firstName: 'Hostname' }, 'active');
            yield* db.insert(signup).values({ sessionId, personId: host, status: 'in' });
            const change = { communityId, sessionId, actorPersonId: null };
            const [guest] = yield* addGuests(change, { hostPersonId: host, count: 1, name: 'Visitor' });
            const guestId = guest?.personId ?? '';
            const other = yield* createSession({
                communityId,
                timezone: 'Europe/Vienna',
                localDate: '2026-12-11',
                localTime: '19:30',
                venueId: null,
                capacityMax: null,
                title: null,
                actorPersonId: null
            });
            const found = yield* searchPeople(communityId, 'Visitor', 10);
            const inScope = yield* arePeopleOf(communityId, [guestId]);
            const candidates = yield* joinCandidates(communityId, other, 50);
            const elsewhere = yield* joinGame({ communityId, sessionId: other, actorPersonId: null }, [guestId]).pipe(Effect.flip);
            const again = yield* joinGame(change, [guestId, host]);
            const attended = yield* attendedAfterFinishing(sessionId);

            expect(found).toEqual([]);
            expect(inScope).toBe(false);
            expect(candidates.map(entry => entry.personId)).not.toContain(guestId);
            expect(elsewhere).toMatchObject({ failure: { code: 'person_not_found' } });
            expect(again).toEqual({ joined: [], waiting: [] });
            expect(attended.map(row => row.personId)).toEqual([host]);
        })
    );

    it.effect('counts the bot-posted squad first, never a guest of any status and never someone who left', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, sessionId } = yield* seedGame('guests-attended');
            const people = yield* Effect.all(
                [1, 2, 3, 4].map(index => syncMember(communityId, { id: BigInt(88_100 + index), firstName: `Played${index}` }, 'active'))
            );
            const [stayed = '', left = '', imported = '', guest = ''] = people;
            yield* db.insert(signup).values([
                { sessionId, personId: stayed, status: 'in' },
                { sessionId, personId: left, status: 'out', updatedAt: new Date('2026-12-04T18:00:00Z') },
                { sessionId, personId: guest, status: 'waitlisted', isGuest: true }
            ]);
            const [squad] = yield* db
                .insert(team)
                .values({ sessionId, ordinal: 1, publishedAt: new Date('2026-12-04T17:00:00Z') })
                .returning({ id: team.id });
            yield* db.insert(teamMember).values([stayed, left, guest].map(personId => ({ teamId: squad?.id ?? '', sessionId, personId })));
            yield* db
                .insert(lineupEntry)
                .values({ sessionId, messageId: 1, teamOrdinal: 1, position: 1, personId: imported, resolvedBy: 'manual' });
            const attended = yield* attendedAfterFinishing(sessionId);

            expect(attended.map(row => row.personId)).toEqual([stayed]);
        })
    );
});
