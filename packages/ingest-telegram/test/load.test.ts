import { expect, layer } from '@effect/vitest';
import { isDefined } from '@rnw-community/shared';
import { priceRule } from '@rondo/db/schema/finance.schema';
import { person, personAlias, telegramAuthor } from '@rondo/db/schema/identity.schema';
import { fixture, squad } from '@rondo/db/schema/league.schema';
import { activity, community } from '@rondo/db/schema/org.schema';
import { teamMember } from '@rondo/db/schema/play.schema';
import { attendance, session } from '@rondo/db/schema/scheduling.schema';
import { venue } from '@rondo/db/schema/venue.schema';
import { Db } from '@rondo/db/service/db.service';
import { testDbLayer } from '@rondo/db/testing/test-db.layer';
import { and, count, countDistinct, eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { DuplicateVenueNameError } from '../src/error/duplicate-venue-name.error';
import { assemblePlan } from '../src/extract/assemble-plan';
import { extractAll } from '../src/extract/extract-all';
import { loadPlan } from '../src/load/load-plan';

import { message, testConfig } from './fixture';

const messages = [
    message(1, '2025-05-04T18:00:00Z', '', {
        text: undefined,
        poll: { question: 'Понедельник, 5 мая, 19.00 North. 18 чел', answers: ['+', '-'] }
    }),
    message(2, '2025-05-05T15:00:00Z', 'Составы на сегодня, North:\n🟢Я, Иван, Пётр вратарь\n🔵Олег, Семён, Павел\nПо 10 евро на поле'),
    message(3, '2025-05-08T18:00:00Z', '', { text: undefined, poll: { question: 'Пятница, 9 мая, 19.30 Park', answers: ['+', '-'] } }),
    message(4, '2025-05-09T10:00:00Z', 'Сегодня отмена, дождь'),
    message(5, '2025-05-12T10:00:00Z', 'TFC- Alpha 6:4')
];

const plan = assemblePlan(extractAll(messages, testConfig), '2025-06-30');

const loadedCommunity = Effect.fn('test.loadedCommunity')(function* (slug: string) {
    const db = yield* Db;
    const [row] = yield* db.select().from(community).where(eq(community.slug, slug));

    return row?.id ?? '';
});

const countsOf = Effect.fn('test.countsOf')(function* (communityId: string) {
    const db = yield* Db;
    const total = (rows: readonly { value: number }[]) => rows[0]?.value ?? 0;

    return {
        sessions: total(yield* db.select({ value: count() }).from(session).where(eq(session.communityId, communityId))),
        aliases: total(yield* db.select({ value: count() }).from(personAlias).where(eq(personAlias.communityId, communityId))),
        allPeople: total(yield* db.select({ value: count() }).from(person)),
        people: total(
            yield* db
                .select({ value: countDistinct(personAlias.personId) })
                .from(personAlias)
                .where(eq(personAlias.communityId, communityId))
        ),
        attendances: total(
            yield* db
                .select({ value: count() })
                .from(attendance)
                .innerJoin(session, eq(session.id, attendance.sessionId))
                .where(eq(session.communityId, communityId))
        ),
        teamMembers: total(
            yield* db
                .select({ value: count() })
                .from(teamMember)
                .innerJoin(session, eq(session.id, teamMember.sessionId))
                .where(eq(session.communityId, communityId))
        ),
        priceRules: total(yield* db.select({ value: count() }).from(priceRule).where(eq(priceRule.communityId, communityId))),
        fixtures: total(
            yield* db
                .select({ value: count() })
                .from(fixture)
                .innerJoin(squad, eq(squad.id, fixture.squadId))
                .where(eq(squad.communityId, communityId))
        )
    };
});

layer(testDbLayer, { timeout: 60_000 })('loading an import plan', it => {
    it.effect('writes sessions, teams, attendance, aliases, prices and fixtures', () =>
        Effect.gen(function* () {
            const config = { ...testConfig, slug: 'writes-fc' };
            const stats = yield* loadPlan(config, plan, { fileSha256: 'sha', allowRemoval: true });
            const db = yield* Db;
            const communityId = yield* loadedCommunity(config.slug);
            const cancelled = yield* db
                .select()
                .from(session)
                .where(and(eq(session.communityId, communityId), eq(session.status, 'cancelled')));

            expect(stats).toMatchObject({ sessions: 2, teams: 2, entries: 6, aliases: 6, priceRules: 1, fixtures: 1 });
            expect(cancelled.map(row => row.cancelReason)).toEqual(['weather']);
            expect(yield* countsOf(communityId)).toMatchObject({ attendances: 6, teamMembers: 6, priceRules: 1, fixtures: 1 });
        })
    );

    it.effect('keeps curated aliases, venues and bot sessions when the same export is loaded again', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const config = { ...testConfig, slug: 'idempotent-fc' };

            yield* loadPlan(config, plan, { fileSha256: 'sha', allowRemoval: true });
            const communityId = yield* loadedCommunity(config.slug);
            const [curated] = yield* db.insert(person).values({ displayName: 'Curated', source: 'manual' }).returning({ id: person.id });
            const curatedId = curated?.id ?? '';
            yield* db
                .update(personAlias)
                .set({ resolution: 'confirmed', personId: curatedId })
                .where(and(eq(personAlias.communityId, communityId), eq(personAlias.aliasNorm, 'иван')));
            yield* db.insert(venue).values({ communityId, name: 'Manual Pitch' });
            const [activityRow] = yield* db.select().from(activity).where(eq(activity.communityId, communityId));
            yield* db.insert(session).values({
                communityId,
                activityId: activityRow?.id ?? '',
                localDate: '2025-07-01',
                startsAt: new Date('2025-07-01T17:00:00Z'),
                source: 'bot'
            });
            const before = yield* countsOf(communityId);

            yield* loadPlan(config, plan, { fileSha256: 'sha', allowRemoval: true });
            const [alias] = yield* db
                .select()
                .from(personAlias)
                .where(and(eq(personAlias.communityId, communityId), eq(personAlias.aliasNorm, 'иван')));
            const venues = yield* db.select().from(venue).where(eq(venue.communityId, communityId));
            const botSessions = yield* db
                .select()
                .from(session)
                .where(and(eq(session.communityId, communityId), eq(session.source, 'bot')));

            expect(alias).toMatchObject({ resolution: 'confirmed', personId: curatedId });
            expect(venues.map(row => row.name).toSorted()).toEqual(['Manual Pitch', 'North Arena', 'Park Field']);
            expect(botSessions.map(row => [row.venueId, row.localDate])).toEqual([[null, '2025-07-01']]);
            expect(yield* countsOf(communityId)).toEqual(before);
        })
    );

    it.effect('loads a plan that has only polls', () =>
        Effect.gen(function* () {
            const pollOnly = assemblePlan(
                extractAll(messages.filter(entry => isDefined(entry.poll)).slice(0, 1), testConfig),
                '2025-06-30'
            );
            const stats = yield* loadPlan({ ...testConfig, slug: 'poll-only-fc' }, pollOnly, { fileSha256: 'sha', allowRemoval: true });

            expect(stats).toMatchObject({ sessions: 1, teams: 0, entries: 0, aliases: 0, priceRules: 0, fixtures: 0 });
        })
    );
    it.effect('links an organizer author once a later run has the self alias', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const config = { ...testConfig, slug: 'late-self-fc' };
            const withoutSelf = assemblePlan(
                extractAll(
                    [
                        message(
                            2,
                            '2025-05-05T15:00:00Z',
                            'Составы на сегодня, North:\n🟢Иван, Пётр вратарь\n🔵Олег, Семён, Павел\nПо 10 евро на поле'
                        ),
                        message(5, '2025-05-12T10:00:00Z', 'TFC- Alpha 6:4')
                    ],
                    config
                ),
                '2025-06-30'
            );

            yield* loadPlan(config, withoutSelf, { fileSha256: 'sha', allowRemoval: true });
            const communityId = yield* loadedCommunity(config.slug);
            const authorOf = () =>
                db
                    .select()
                    .from(telegramAuthor)
                    .where(and(eq(telegramAuthor.communityId, communityId), eq(telegramAuthor.displayName, 'Org')));
            const [early] = yield* authorOf();

            yield* loadPlan(config, plan, { fileSha256: 'sha', allowRemoval: true });
            const [late] = yield* authorOf();

            expect(early?.personId).toBeNull();
            expect(isDefined(late?.personId)).toBe(true);
        })
    );

    it.effect('rejects a config with duplicate venue names', () =>
        Effect.gen(function* () {
            const config = {
                ...testConfig,
                slug: 'duplicate-venue-fc',
                venues: [
                    { key: 'north', name: 'Same Name', kind: 'training' as const, patterns: [] },
                    { key: 'park', name: 'Same Name', kind: 'training' as const, patterns: [] }
                ]
            };
            const error = yield* Effect.flip(loadPlan(config, plan, { fileSha256: 'sha', allowRemoval: true }));

            expect(error).toBeInstanceOf(DuplicateVenueNameError);
            expect(error).toMatchObject({ venueName: 'Same Name', keys: ['north', 'park'] });
        })
    );
});
