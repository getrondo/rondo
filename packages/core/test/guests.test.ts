import { expect, layer } from '@effect/vitest';
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

layer(recordedTelegramDbLayer, { timeout: 60_000 })('guests of one game', it => {
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
            yield* finishPastSessions(new Date('2026-12-05T00:00:00Z'));
            const attended = yield* db
                .select({ personId: attendance.personId })
                .from(attendance)
                .where(eq(attendance.sessionId, sessionId));

            expect(found).toEqual([]);
            expect(inScope).toBe(false);
            expect(candidates.map(entry => entry.personId)).not.toContain(guestId);
            expect(elsewhere).toMatchObject({ reason: 'player not found in this community' });
            expect(again).toEqual({ joined: [], waiting: [] });
            expect(attended.map(row => row.personId)).toEqual([host]);
        })
    );
});
