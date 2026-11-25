import { expect, layer } from '@effect/vitest';
import { rating } from '@rondo/db/schema/play.schema';
import { signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { isAdminOf } from '../src/access/admin-access';
import { describeAction } from '../src/actions/describe-action';
import { decideAction, proposeAction } from '../src/actions/pending-action.service';
import { syncMember } from '../src/identity/telegram-user';
import { notifyPromoted } from '../src/notify/notifier';
import { createSession, getSession } from '../src/sessions/session.service';
import { recordedTelegramDbLayer, recorder } from '../src/testing/recorded-telegram.layer';
import { seedCommunity, seedConfig } from '../src/testing/seed-community';
import { updateVenue } from '../src/venues/venue.service';

import type { Action } from '../src/actions/action.model';

const group = { chatId: -555n, topicId: null };

const confirm = Effect.fn('test.confirm')(function* (communityId: string, action: Action) {
    const summary = yield* describeAction(action, 'uk', communityId);
    const actionId = yield* proposeAction({ communityId, tgUserId: 42n, action, summary });

    return yield* decideAction({
        actionId,
        tgUserId: 42n,
        confirm: true,
        context: id =>
            Effect.succeed({
                communityId: id,
                timezone: 'Europe/Vienna',
                group: Option.fromNullishOr(group),
                groupLocale: 'uk',
                actorPersonId: null
            })
    });
});

const postsSince = (count: number) =>
    recorder.calls.slice(count).filter(call => call.method === 'sendMessage' && call.payload.chat_id === -555);

layer(recordedTelegramDbLayer, { timeout: 60_000 })('confirmed admin actions, one by one', it => {
    it.effect('grants admin rights and sets a confidential level', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedCommunity(seedConfig('gaps-admin'));
            const personId = yield* syncMember(communityId, { id: 6001n, firstName: 'Helper' }, 'active');
            const granted = yield* confirm(communityId, { _tag: 'grant_admin', personId });
            const levelled = yield* confirm(communityId, { _tag: 'set_rating', personId, level: 8 });
            const [level] = yield* db
                .select()
                .from(rating)
                .where(and(eq(rating.personId, personId), eq(rating.model, 'organizer_seed')));

            expect([granted._tag, levelled._tag]).toEqual(['done', 'done']);
            expect(yield* isAdminOf(6001n, communityId)).toBe(true);
            expect(level?.mu).toBe(8);
        })
    );

    it.effect('posts a change or a cancellation in the group only when asked', () =>
        Effect.gen(function* () {
            const { communityId, venueIdByName } = yield* seedCommunity(seedConfig('gaps-notice'));
            const venueId = venueIdByName.get('Park Field') ?? null;
            yield* updateVenue({
                communityId,
                venueId: venueId ?? '',
                patch: { address: 'Main Street 1', lat: 48.2, lng: 16.4 },
                actorPersonId: null
            });
            const game = {
                communityId,
                timezone: 'Europe/Vienna',
                localTime: '19:00',
                venueId,
                capacityMax: 14,
                title: null,
                actorPersonId: null
            };
            const first = yield* createSession({ ...game, localDate: '2026-12-04' });
            const second = yield* createSession({ ...game, localDate: '2026-12-05' });
            const start = recorder.calls.length;
            yield* confirm(communityId, { _tag: 'update_session', sessionId: first, localTime: '20:00', notify: false });
            const quiet = postsSince(start).length;
            yield* confirm(communityId, { _tag: 'update_session', sessionId: first, localTime: '20:30', notify: true });
            const changed = postsSince(start).at(-1);
            yield* confirm(communityId, { _tag: 'cancel_session', sessionId: second, reason: 'venue', notify: false });
            const quietCancel = postsSince(start).length;
            yield* confirm(communityId, { _tag: 'cancel_session', sessionId: first, reason: 'weather', notify: true });
            const cancelled = postsSince(start).at(-1);

            expect(quiet).toBe(0);
            expect(String(changed?.payload.text)).toContain('➡️ <b>Пт 04.12 20:30 · Park Field</b>');
            expect(String(changed?.payload.text)).toContain(
                '<a href="https://www.google.com/maps/search/?api=1&amp;query=48.2,16.4"><b>Main Street 1</b></a>'
            );
            expect(quietCancel).toBe(1);
            expect(String(cancelled?.payload.text)).toContain('❌ Скасовано: Пт 04.12 20:30 · Park Field');
            expect(String(cancelled?.payload.text)).toContain('погода');
        })
    );

    it.effect('publishes line-ups with names, colours and the place, never levels, and mentions a promoted player', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, venueIdByName } = yield* seedCommunity(seedConfig('gaps-teams'));
            const sessionId = yield* createSession({
                communityId,
                timezone: 'Europe/Vienna',
                localDate: '2026-12-06',
                localTime: '10:00',
                venueId: venueIdByName.get('North Arena') ?? null,
                capacityMax: 10,
                title: null,
                actorPersonId: null
            });
            const players = yield* Effect.all(
                [1, 2, 3, 4].map(index => syncMember(communityId, { id: BigInt(7000 + index), firstName: `Name${index}` }, 'active'))
            );
            yield* db
                .insert(signup)
                .values(players.map(personId => ({ sessionId, personId, role: 'field' as const, status: 'in' as const })));
            const start = recorder.calls.length;
            const teams = [1, 2].map(ordinal => ({
                ordinal,
                strength: 9.5,
                players: players.slice((ordinal - 1) * 2, ordinal * 2).map((personId, index) => ({
                    personId,
                    displayName: `Name${(ordinal - 1) * 2 + index + 1}`,
                    strength: 4.75,
                    isGk: false
                }))
            }));
            yield* confirm(communityId, { _tag: 'publish_teams', sessionId, teams });
            const lineup = String(postsSince(start).at(-1)?.payload.text);
            const target = Option.getOrThrow(yield* getSession(sessionId));
            yield* notifyPromoted({
                target,
                promoted: [{ personId: players[0] ?? '', displayName: 'Name1', tgUserId: 7001n }],
                group,
                locale: 'uk'
            });
            const promoted = String(postsSince(start).at(-1)?.payload.text);

            expect(lineup).toBe('<b>Склади: Нд 06.12 10:00 · North Arena</b>\n📍 <b>North Arena</b>\n🟢 Name1, Name2\n🔵 Name3, Name4');
            expect(lineup).not.toMatch(/4\.75|9\.5|Σ/u);
            expect(promoted).toBe(
                '🎉 <a href="tg://user?id=7001">Name1</a>, звільнилося місце — ти в складі! Нд 06.12 10:00 · North Arena'
            );
        })
    );
});
