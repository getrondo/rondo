import { expect, layer } from '@effect/vitest';
import { syncMember } from '@rondo/core/identity/telegram-user';
import { createSession } from '@rondo/core/sessions/session.service';
import { recordedTelegramDbLayer, recorder } from '@rondo/core/testing/recorded-telegram.layer';
import { seedCommunity, seedConfig } from '@rondo/core/testing/seed-community';
import { telegramPoll } from '@rondo/db/schema/platform.schema';
import { lineupEntry, team, teamMember } from '@rondo/db/schema/play.schema';
import { attendance, session, signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { refusal } from '@rondo/telegram/testing/recording-telegram.layer';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { runMaintenance } from '../src/jobs/maintenance.job';

const afterTheGame = new Date('2026-12-04T22:00:00Z');

const seedGame = Effect.fn('test.seedGame')(function* (slug: string) {
    const db = yield* Db;
    const { communityId } = yield* seedCommunity(seedConfig(slug));
    const sessionId = yield* createSession({
        communityId,
        timezone: 'Europe/Vienna',
        localDate: '2026-12-04',
        localTime: '19:30',
        venueId: null,
        capacityMax: null,
        title: null,
        actorPersonId: null
    });
    const people = yield* Effect.all([1n, 2n, 3n].map(id => syncMember(communityId, { id, firstName: `P${id}` }, 'active')));
    const [first = '', second = '', third = ''] = people;
    yield* db.insert(signup).values([
        { sessionId, personId: first, status: 'in' },
        { sessionId, personId: second, status: 'in' },
        { sessionId, personId: third, status: 'waitlisted' }
    ]);

    return { sessionId, first, second, third };
});

const outcomesOf = Effect.fn('test.outcomesOf')(function* (sessionId: string) {
    const db = yield* Db;
    const rows = yield* db.select().from(attendance).where(eq(attendance.sessionId, sessionId));

    return new Map(rows.map(row => [row.personId, row.outcome]));
});

const addPoll = Effect.fn('test.addPoll')(function* (sessionId: string, pollId: string, messageId: number) {
    const db = yield* Db;
    yield* db.insert(telegramPoll).values({ pollId, chatId: -100n, messageId, sessionId, options: ['in', 'out'] });
});

const isClosed = Effect.fn('test.isClosed')(function* (pollId: string) {
    const db = yield* Db;
    const [poll] = yield* db.select().from(telegramPoll).where(eq(telegramPoll.pollId, pollId));

    return poll?.closedAt instanceof Date;
});

const stopsOf = (messageId: number) =>
    recorder.calls.filter(call => call.method === 'stopPoll' && call.payload.message_id === messageId).length;

layer(recordedTelegramDbLayer, { timeout: 60_000 })('nightly maintenance', it => {
    it.effect('fills sign-ups player by player when there is no line-up, and a manual outcome wins', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { sessionId, first, second } = yield* seedGame('finish-signups-fc');
            yield* db.insert(attendance).values({ sessionId, personId: first, outcome: 'no_show', source: 'manual' });
            yield* runMaintenance(afterTheGame);
            yield* runMaintenance(afterTheGame);
            const [game] = yield* db.select().from(session).where(eq(session.id, sessionId));
            const outcomes = yield* outcomesOf(sessionId);

            expect(game?.status).toBe('played');
            expect(outcomes).toEqual(
                new Map([
                    [first, 'no_show'],
                    [second, 'attended']
                ])
            );
        })
    );

    it.effect('lets the line-up decide, also with a player it could not name', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const posted = yield* seedGame('finish-lineup-fc');
            const unnamed = yield* seedGame('finish-unnamed-fc');
            const entry = { messageId: 5, teamOrdinal: 1, position: 1, resolvedBy: 'account' as const };
            yield* db.insert(lineupEntry).values([
                { ...entry, sessionId: posted.sessionId, personId: posted.third },
                { ...entry, sessionId: posted.sessionId, position: 2, personId: posted.first },
                { ...entry, sessionId: unnamed.sessionId, personId: null }
            ]);
            yield* db.insert(attendance).values({
                sessionId: posted.sessionId,
                personId: posted.first,
                outcome: 'late',
                source: 'manual'
            });
            yield* runMaintenance(afterTheGame);
            const outcomes = yield* outcomesOf(posted.sessionId);
            const none = yield* outcomesOf(unnamed.sessionId);

            expect(outcomes).toEqual(
                new Map([
                    [posted.first, 'late'],
                    [posted.third, 'attended']
                ])
            );
            expect(none.size).toBe(0);
        })
    );

    it.effect('takes the published teams as the line-up and ignores guests counted from chat', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const published = yield* seedGame('finish-teams-fc');
            const guests = yield* seedGame('finish-guests-fc');
            const refused = yield* seedGame('finish-refused-fc');
            const [draft] = yield* db.insert(team).values({ sessionId: refused.sessionId, ordinal: 1 }).returning();
            yield* db.insert(teamMember).values({
                teamId: draft?.id ?? '',
                sessionId: refused.sessionId,
                personId: refused.third,
                assignedBy: 'balancer'
            });
            const [stored] = yield* db
                .insert(team)
                .values({ sessionId: published.sessionId, ordinal: 1, publishedAt: afterTheGame })
                .returning();
            yield* db.insert(teamMember).values({
                teamId: stored?.id ?? '',
                sessionId: published.sessionId,
                personId: published.third,
                assignedBy: 'balancer'
            });
            yield* db.insert(lineupEntry).values({
                sessionId: guests.sessionId,
                messageId: 6,
                teamOrdinal: 0,
                position: 1,
                resolvedBy: 'guest',
                isGuest: true,
                guestOfPersonId: guests.first
            });
            yield* runMaintenance(afterTheGame);
            const teams = yield* outcomesOf(published.sessionId);
            const signups = yield* outcomesOf(guests.sessionId);

            expect([...teams.keys()]).toEqual([published.third]);
            expect(new Set((yield* outcomesOf(refused.sessionId)).keys())).toEqual(new Set([refused.first, refused.second]));
            expect(new Set(signups.keys())).toEqual(new Set([guests.first, guests.second]));
        })
    );

    it.effect('finishes only games that are over, and no cancelled one', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const running = yield* seedGame('finish-running-fc');
            const cancelled = yield* seedGame('finish-cancelled-fc');
            yield* db.update(session).set({ status: 'cancelled' }).where(eq(session.id, cancelled.sessionId));
            const before = yield* runMaintenance(new Date('2026-12-04T19:30:00Z'));
            const after = yield* runMaintenance(afterTheGame);
            const outcomes = yield* outcomesOf(cancelled.sessionId);
            const filled = yield* outcomesOf(running.sessionId);

            expect(before.finished).toBe(0);
            expect(after.finished).toBe(1);
            expect(outcomes.size).toBe(0);
            expect(filled.size).toBe(2);
        })
    );

    it.effect('tries again to close the polls of finished and cancelled games', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const played = yield* seedGame('close-played-fc');
            const cancelled = yield* seedGame('close-cancelled-fc');
            const later = yield* seedGame('close-later-fc');
            yield* db.update(session).set({ status: 'cancelled' }).where(eq(session.id, cancelled.sessionId));
            yield* db
                .update(session)
                .set({ startsAt: new Date('2027-01-01T18:00:00Z'), endsAt: null })
                .where(eq(session.id, later.sessionId));
            yield* addPoll(played.sessionId, 'close-played', 901);
            yield* addPoll(cancelled.sessionId, 'close-cancelled', 902);
            yield* addPoll(later.sessionId, 'close-later', 903);
            recorder.failures.set('stopPoll', refusal('stopPoll', 'Too Many Requests: retry after 5', 429));
            yield* runMaintenance(afterTheGame);
            const afterFailure = yield* isClosed('close-played');
            recorder.failures.set('stopPoll', refusal('stopPoll', 'Bad Request: poll has already been closed'));
            yield* runMaintenance(afterTheGame);
            recorder.failures.delete('stopPoll');
            yield* runMaintenance(afterTheGame);
            const closed = yield* Effect.all(['close-played', 'close-cancelled', 'close-later'].map(pollId => isClosed(pollId)));

            expect(afterFailure).toBe(false);
            expect(closed).toEqual([true, true, false]);
            expect([stopsOf(901), stopsOf(902), stopsOf(903)]).toEqual([2, 2, 0]);
        })
    );
});
