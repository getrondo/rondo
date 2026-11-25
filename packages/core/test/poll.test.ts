import { expect, layer } from '@effect/vitest';
import { community } from '@rondo/db/schema/org.schema';
import { venue } from '@rondo/db/schema/venue.schema';
import { Db } from '@rondo/db/service/db.service';
import { eq, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { describeAction } from '../src/actions/describe-action';
import { placeHtml } from '../src/signups/place-block';
import { pollFor, previewOf } from '../src/signups/poll-for';
import { recordedTelegramDbLayer } from '../src/testing/recorded-telegram.layer';
import { seedCommunity, seedConfig } from '../src/testing/seed-community';
import { updateVenue } from '../src/venues/venue.service';

import type { Action } from '../src/actions/action.model';

const template = { question: '{weekday}, {date}, {time} {place}, {station}!\n\n{fields}, {places}', answers: ['👍', '👎'] };
const game = {
    localDate: '2026-11-20',
    localTime: '19:00',
    venueName: 'Sport Arena Vienna North',
    venueShortName: 'Sport Arena',
    venueStation: 'U9 Station',
    fieldsPlanned: 1,
    capacityMax: 20
};
const bare = { ...game, venueName: null, venueShortName: null, venueStation: null, fieldsPlanned: null, capacityMax: null };

const seed = Effect.fn('test.seed')(function* (slug: string, defaultLocale: 'uk' | 'ru' | 'de', poll?: unknown) {
    const db = yield* Db;
    const { communityId } = yield* seedCommunity(seedConfig(slug));
    yield* db
        .update(community)
        .set({ defaultLocale, settings: sql`${community.settings} || ${JSON.stringify({ poll })}::jsonb` })
        .where(eq(community.id, communityId));

    return communityId;
});

layer(recordedTelegramDbLayer, { timeout: 60_000 })('the poll in the style of the organizer', it => {
    it.effect('fills the template of the community', () =>
        Effect.gen(function* () {
            const communityId = yield* seed('poll-ru-fc', 'ru', template);
            const full = yield* pollFor(communityId, game, '  Без телеграма:\n двое ');
            const noVenue = yield* pollFor(communityId, { ...bare, fieldsPlanned: 2, capacityMax: 21 }, null);
            const noStation = yield* pollFor(communityId, { ...game, venueShortName: null, venueStation: null, fieldsPlanned: null }, null);
            const nothing = yield* pollFor(communityId, bare, null);

            expect(full).toMatchObject({
                question: 'Пятница, 20 ноября, 19.00 Sport Arena, U9 Station!\n\n1 поле, 20 мест\nБез телеграма:\nдвое',
                answers: ['👍', '👎']
            });
            expect(noVenue.question).toBe('Пятница, 20 ноября, 19.00!\n\n2 поля, 21 место');
            expect(noStation.question).toBe('Пятница, 20 ноября, 19.00 Sport Arena Vienna North!\n\n20 мест');
            expect(nothing.question).toBe('Пятница, 20 ноября, 19.00!');
        })
    );

    it.effect('has a generic default in the language of the group', () =>
        Effect.gen(function* () {
            const communityId = yield* seed('poll-default-fc', 'de');
            const poll = yield* pollFor(communityId, { ...game, fieldsPlanned: 5, capacityMax: 22 }, null);

            expect(poll).toMatchObject({
                question: '⚽ Пʼятниця, 20 листопада, 19.00 Sport Arena, U9 Station\n\n5 полів, 22 місця',
                answers: ['✅ Граю', '❌ Не граю']
            });
        })
    );

    it.effect('refuses a poll Telegram would not accept and a template it cannot read', () =>
        Effect.gen(function* () {
            const communityId = yield* seed('poll-long-fc', 'ru', template);
            const badAnswers = yield* seed('poll-answers-fc', 'ru', { ...template, answers: ['👍', 'н'.repeat(101)] });
            const badPlaceholder = yield* seed('poll-placeholder-fc', 'ru', { ...template, question: '{weekday} {price}' });
            const threeAnswers = yield* seed('poll-three-fc', 'ru', { ...template, answers: ['1', '2', '3'] });
            const emptyQuestion = yield* seed('poll-empty-fc', 'ru', { ...template, question: '{station}' });
            const length = (yield* pollFor(communityId, game, null)).question.length + 1;
            const fits = yield* pollFor(communityId, game, 'x'.repeat(300 - length));
            const refused = yield* Effect.all(
                [
                    pollFor(communityId, game, 'x'.repeat(301 - length)),
                    pollFor(badAnswers, game, null),
                    pollFor(badPlaceholder, game, null),
                    pollFor(threeAnswers, game, null),
                    pollFor(emptyQuestion, bare, null)
                ].map(poll => Effect.flip(poll))
            );

            expect(fits.question).toHaveLength(300);
            expect(refused.map(error => error._tag)).toEqual(Array.from({ length: 5 }, () => 'ActionFailedError'));
        })
    );

    it.effect('puts the place, its address and a route into the poll, with nothing empty', () =>
        Effect.gen(function* () {
            const communityId = yield* seed('poll-place-fc', 'ru', template);
            const located = { ...game, venueAddress: 'Main Street 1 & Co', venueLat: 48.2, venueLng: 16.4, venueMapUrl: null };
            const linked = {
                ...game,
                venueStation: null,
                venueAddress: null,
                venueLat: null,
                venueLng: null,
                venueMapUrl: 'https://maps.app.goo.gl/abc'
            };
            const poll = yield* pollFor(communityId, located, null);
            const onlyLink = yield* pollFor(communityId, linked, null);
            const bareVenue = yield* pollFor(communityId, { ...game, venueStation: null }, null);
            const none = yield* pollFor(communityId, bare, null);
            const url = 'https://www.google.com/maps/search/?api=1&query=48.2,16.4';

            expect(poll.route).toEqual({ label: '🗺 Маршрут', url });
            expect(placeHtml(poll.place)).toBe(
                `📍 <b>Sport Arena Vienna North</b>\n<a href="${url.replaceAll('&', '&amp;')}"><b>Main Street 1 &amp; Co</b></a>\n🚇 U9 Station`
            );
            expect(poll.description).toBe(`📍 <a href="${url.replaceAll('&', '&amp;')}"><b>Main Street 1 &amp; Co</b></a>`);
            expect(previewOf(poll)).toBe(
                [
                    'Пятница, 20 ноября, 19.00 Sport Arena, U9 Station!',
                    '',
                    '1 поле, 20 мест',
                    '',
                    '▫️ 👍',
                    '▫️ 👎',
                    '',
                    '📍 Main Street 1 & Co',
                    `🗺 Маршрут: ${url}`
                ].join('\n')
            );
            expect(onlyLink.description).toBeNull();
            expect(bareVenue.description).toBeNull();
            expect(placeHtml(onlyLink.place)).toBe('📍 <b>Sport Arena Vienna North</b>');
            expect(onlyLink.route?.url).toBe('https://maps.app.goo.gl/abc');
            expect(placeHtml(bareVenue.place)).toBe('📍 <b>Sport Arena Vienna North</b>');
            expect(bareVenue.route).toBeNull();
            expect(none.place).toBeNull();
            expect(previewOf(none)).toBe('Пятница, 20 ноября, 19.00!\n\n▫️ 👍\n▫️ 👎');
        })
    );

    it.effect('shows the admin the poll of a new game, with the venue as it is displayed', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const communityId = yield* seed('poll-preview-fc', 'ru', template);
            const [park] = yield* db.select().from(venue).where(eq(venue.communityId, communityId)).orderBy(venue.name).offset(1);
            const venueId = park?.id ?? '';
            yield* updateVenue({ communityId, venueId, patch: { shortName: 'Park', station: 'U9 Park' }, actorPersonId: null });
            const create: Action = {
                _tag: 'create_session',
                localDate: '2026-11-20',
                localTime: '19:00',
                venueId,
                capacityMax: 20,
                fieldsPlanned: 1,
                title: null,
                note: 'Мячи есть',
                announce: true
            };
            const summary = yield* describeAction(create, 'uk', communityId);
            const silent = yield* describeAction({ ...create, announce: false }, 'uk', communityId);
            const change = yield* describeAction({ _tag: 'update_venue', venueId, shortName: 'Park', station: 'U9' }, 'uk', communityId);

            expect(summary).toBe(
                [
                    '➕ Нова гра: Пт 20.11 19:00 · Park Field, 1 поле, 20 місць і опублікувати опитування в групі:',
                    '',
                    'Пятница, 20 ноября, 19.00 Park, U9 Park!',
                    '',
                    '1 поле, 20 мест',
                    'Мячи есть',
                    '',
                    '▫️ 👍',
                    '▫️ 👎'
                ].join('\n')
            );
            expect(silent).toBe('➕ Нова гра: Пт 20.11 19:00 · Park Field, 1 поле, 20 місць');
            expect(change).toBe('📍 Змінити поле: Park Field → Park, U9');
        })
    );
});
