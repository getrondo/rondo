import { expect, layer } from '@effect/vitest';
import { person, telegramAccount } from '@rondo/db/schema/identity.schema';
import { membership } from '@rondo/db/schema/org.schema';
import { team, teamMember } from '@rondo/db/schema/play.schema';
import { attendance, session } from '@rondo/db/schema/scheduling.schema';
import { venue } from '@rondo/db/schema/venue.schema';
import { Db } from '@rondo/db/service/db.service';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { syncMember, upsertTelegramUser } from '../src/identity/telegram-user';
import { ingestGroupMessage } from '../src/live/live-ingest';
import { createPerson, renamePerson } from '../src/people/people.service';
import { createSession } from '../src/sessions/session.service';
import { attendanceCoverage } from '../src/stats/stats.service';
import { recordedTelegramDbLayer } from '../src/testing/recorded-telegram.layer';
import { seedCommunity, seedConfig } from '../src/testing/seed-community';
import { createVenue, learnVenuePin, updateVenue } from '../src/venues/venue.service';

layer(recordedTelegramDbLayer, { timeout: 60_000 })('players and venues learned from activity', it => {
    it.effect('tracks joins, leaves and rejoins, and follows Telegram renames until an admin renames the player', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedCommunity(seedConfig('members-fc'));
            const user = { id: 501n, firstName: 'Ivan' };
            const personId = yield* syncMember(communityId, user, 'active');
            const statusOf = () => db.select({ status: membership.status }).from(membership).where(eq(membership.personId, personId));
            const nameOf = () => db.select({ name: person.displayName }).from(person).where(eq(person.id, personId));
            yield* syncMember(communityId, user, 'left');
            const left = yield* statusOf();
            yield* syncMember(communityId, { ...user, firstName: 'Ivan P' }, 'active');
            const back = yield* statusOf();
            const followed = yield* nameOf();
            yield* renamePerson({ communityId, personId, displayName: 'Captain', actorPersonId: null });
            yield* upsertTelegramUser({ ...user, firstName: 'Other' });
            const kept = yield* nameOf();

            expect(left).toEqual([{ status: 'left' }]);
            expect(back).toEqual([{ status: 'active' }]);
            expect(followed).toEqual([{ name: 'Ivan P' }]);
            expect(kept).toEqual([{ name: 'Captain' }]);
        })
    );

    it.effect('adds players without Telegram, even with the same name', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedCommunity(seedConfig('manual-fc'));
            const first = yield* createPerson({ communityId, displayName: 'Guest One', actorPersonId: null });
            const second = yield* createPerson({ communityId, displayName: 'Guest One', actorPersonId: null });
            const accounts = yield* db.select().from(telegramAccount).where(eq(telegramAccount.personId, first));

            expect(first).not.toBe(second);
            expect(accounts).toEqual([]);
        })
    );

    it.effect('creates, completes and renames venues, and recognizes them in later polls', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const config = seedConfig('venues-fc');
            const { communityId, venueIdByName } = yield* seedCommunity(config);
            const actorPersonId = yield* upsertTelegramUser({ id: 502n, firstName: 'Org' });
            const pin = { communityId, actorPersonId, title: 'Donau  Platz', address: 'Uferweg 1', lat: 48.2, lng: 16.4 };
            const pinned = yield* learnVenuePin(pin);
            const same = yield* learnVenuePin({ ...pin, title: 'donau  platz', address: 'Uferweg 2', lat: 1 });
            const parkId = venueIdByName.get('Park Field') ?? '';
            yield* updateVenue({ communityId, actorPersonId, venueId: parkId, patch: { name: 'City Park', alias: 'Grün' } });
            const duplicate = yield* Effect.flip(createVenue({ communityId, actorPersonId, name: 'PARK FIELD' }));
            const poll = (messageId: number, question: string) =>
                ingestGroupMessage(communityId, config, {
                    chatId: -102n,
                    messageId,
                    sentAt: new Date('2026-05-03T18:00:00Z'),
                    senderPersonId: actorPersonId,
                    senderTgUserId: 502n,
                    senderName: 'Org',
                    isTrusted: true,
                    poll: { question, answers: ['+', '-'] }
                });
            yield* poll(1, 'Понедельник, 4 мая, 19.00 Donau Platz. 18 чел');
            yield* poll(2, 'Вторник, 5 мая, 19.00 grün. 18 чел');
            yield* poll(3, 'Среда, 6 мая, 19.00 парк. 18 чел');
            const unknown = yield* poll(4, 'Четверг, 7 мая, 19.00 Stadlau. 18 чел');
            const games = yield* db
                .select({ venueId: session.venueId })
                .from(session)
                .where(eq(session.communityId, communityId))
                .orderBy(session.localDate);
            const [stored] = yield* db.select().from(venue).where(eq(venue.id, pinned));

            expect(same).toBe(pinned);
            expect(stored).toMatchObject({ name: 'Donau Platz', address: 'Uferweg 1', lat: 48.2 });
            expect(duplicate).toMatchObject({ failure: { code: 'venue_exists' } });
            expect(games.map(game => game.venueId)).toEqual([pinned, parkId, parkId, null]);
            expect(unknown.unknownPlace?.text).toContain('Stadlau');
        })
    );

    it.effect('reports how many played games have known players', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedCommunity(seedConfig('coverage-fc'));
            const personId = yield* syncMember(communityId, { id: 503n, firstName: 'Solo' }, 'active');
            const ids = yield* Effect.all(
                ['2026-10-01', '2026-10-02', '2026-11-02'].map(localDate =>
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
            yield* db.update(session).set({ status: 'played' }).where(eq(session.communityId, communityId));
            yield* db.insert(attendance).values({ sessionId: ids[2] ?? '', personId, outcome: 'attended' });
            const [side] = yield* db
                .insert(team)
                .values({ sessionId: ids[0] ?? '', ordinal: 1 })
                .returning({ id: team.id });
            yield* db.insert(teamMember).values({ teamId: side?.id ?? '', sessionId: ids[0] ?? '', personId });
            const all = yield* attendanceCoverage(communityId);
            const october = yield* attendanceCoverage(communityId, { from: '2026-10-01', to: '2026-10-31' });

            expect(all).toEqual({ playedGames: 3, gamesWithSquad: 1, gamesWithPoll: 0 });
            expect(october).toEqual({ playedGames: 2, gamesWithSquad: 1, gamesWithPoll: 0 });
        })
    );
});
