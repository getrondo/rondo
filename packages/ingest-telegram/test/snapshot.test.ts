import { expect, layer } from '@effect/vitest';
import { isDefined } from '@rnw-community/shared';
import { person, personAlias, telegramAccount } from '@rondo/db/schema/identity.schema';
import { community, membership, telegramChat } from '@rondo/db/schema/org.schema';
import { messageRef, pollVote } from '@rondo/db/schema/platform.schema';
import { lineupEntry } from '@rondo/db/schema/play.schema';
import { attendance, session, sessionChange } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { testDbLayer } from '@rondo/db/testing/test-db.layer';
import { and, asc, eq, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { assemblePlan } from '../src/extract/assemble-plan';
import { extractAll } from '../src/extract/extract-all';
import { withoutLiveMessages } from '../src/load/live-messages';
import { loadPlan } from '../src/load/load-plan';
import { parseSnapshot } from '../src/parse/parse-snapshot';

import { message, testConfig } from './fixture';

import type { TelegramMessage } from '../src/model/telegram-message.model';

const games = 12;
const base = 900_000;
const ids = { org: base, striker: base + 1, left: base + 2, bot: base + 3, gone: base + 4, other: base + 5 };
const dayOf = (index: number): string => String(index + 1).padStart(2, '0');
const pollMessage = (index: number): number => index * 10 + 1;

const messages: TelegramMessage[] = Array.from({ length: games }, (_, index) => [
    message(pollMessage(index), `2025-05-${dayOf(index)}T08:00:00Z`, '', {
        text: undefined,
        authorId: ids.org,
        poll: { question: 'Сегодня футбол 19.00 North', answers: ['+', '-'] }
    }),
    ...(index === games - 1
        ? []
        : [
              message(
                  pollMessage(index) + 1,
                  `2025-05-${dayOf(index)}T12:00:00Z`,
                  `Составы на сегодня, North:\n🟢Я, Гонзо${index === 0 ? ', Гонзо +1' : ''}, Зорро\n🔵${index % 2 === 0 ? 'Олег' : 'Семён'}${index === 1 || index === 2 ? ', Зорро' : ''}${index === 3 ? ', Пират, Пират, Друг Гонзо, новый' : ''}`,
                  { authorId: ids.org }
              )
          ])
]).flat();

const chat = [
    message(901, '2025-05-12T09:00:00Z', '+2', { author: 'Left', authorId: ids.left, replyTo: pollMessage(games - 1) }),
    message(902, '2025-05-12T09:01:00Z', '+1', { author: 'Left', authorId: ids.left })
];

const userOf = (id: number, extra: object = {}) => ({
    id,
    first: `U${id}`,
    last: '',
    username: id === ids.striker ? 'Striker' : null,
    usernames: [],
    bot: id === ids.bot,
    deleted: id === ids.gone,
    member: id === ids.striker || id === ids.org,
    ...extra
});

const pollId = (index: number): string => `${5_300_000_000_000_000_001n + BigInt(index)}`;

const snapshot = parseSnapshot({
    users: [
        JSON.stringify(Object.values(ids).map(id => userOf(id, id === ids.gone ? { first: '' } : {}))),
        JSON.stringify([userOf(ids.striker, { member: false })])
    ],
    messages: Array.from(
        { length: games },
        (_, index) =>
            `{"id":${pollMessage(index)},"poll": {"id": ${pollId(index)},"answers":[{"option":"30","text":"+"},{"option":"31","text":"-"}]}}\n`
    ).join(''),
    votes: [
        Array.from({ length: games }, (_, index) =>
            JSON.stringify({
                message: pollMessage(index),
                votes: [
                    { peer: { user: ids.striker }, options: ['30'], date: '2025-05-01T09:00:00+00:00' },
                    { peer: { user: ids.bot }, options: ['30'], date: '2025-05-01T09:00:00+00:00' },
                    { peer: { user: ids.gone }, options: [index === 0 ? '30' : '31'], date: '2025-05-01T09:00:00+00:00' },
                    { peer: { user: ids.other }, options: [index % 3 === 0 ? '30' : '31'], date: '2025-05-01T09:00:00+00:00' }
                ]
            })
        ).join('\n')
    ]
});

const load = Effect.fn('test.load')(function* (slug: string, source: readonly TelegramMessage[] = [...messages, ...chat]) {
    const db = yield* Db;
    const config = { ...testConfig, slug };
    const plan = assemblePlan(extractAll(yield* withoutLiveMessages(slug, source), config), '2025-06-30');
    const stats = yield* loadPlan(config, plan, 'sha', yield* snapshot);
    const [row] = yield* db.select().from(community).where(eq(community.slug, slug));
    const communityId = row?.id ?? '';
    const entries = yield* db
        .select({ entry: lineupEntry, localDate: session.localDate })
        .from(lineupEntry)
        .innerJoin(session, eq(session.id, lineupEntry.sessionId))
        .where(eq(session.communityId, communityId))
        .orderBy(asc(session.localDate), asc(lineupEntry.teamOrdinal), asc(lineupEntry.position));
    const aliases = yield* db.select().from(personAlias).where(eq(personAlias.communityId, communityId));

    return { communityId, stats, entries, aliases, alias: (norm: string) => aliases.find(alias => alias.aliasNorm === norm) };
});

const accountPerson = Effect.fn('test.accountPerson')(function* (id: number) {
    const db = yield* Db;
    const [row] = yield* db
        .select()
        .from(telegramAccount)
        .where(eq(telegramAccount.tgUserId, BigInt(id)));

    return row?.personId ?? '';
});

const resolutions = (entries: readonly { readonly entry: typeof lineupEntry.$inferSelect }[]): (string | null)[] =>
    entries.map(({ entry }) => `${entry.raw}|${entry.resolvedBy}|${entry.teamOrdinal}|${entry.position}|${entry.personId}`);

layer(testDbLayer, { timeout: 60_000 })('loading a snapshot', it => {
    it.effect('loads accounts, votes, entries and one certain vote link', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, stats, entries, aliases, alias } = yield* load('snapshot-fc');
            const striker = yield* accountPerson(ids.striker);
            const members = yield* db.select().from(membership).where(eq(membership.communityId, communityId));
            const [shown] = yield* db.select().from(person).where(eq(person.id, striker));
            const votes = yield* db
                .select()
                .from(pollVote)
                .where(eq(pollVote.pollId, pollId(0)));
            const bots = yield* db
                .select()
                .from(telegramAccount)
                .where(eq(telegramAccount.tgUserId, BigInt(ids.bot)));
            const guestsNamed = (raw: string) =>
                entries.filter(({ entry }) => entry.raw === raw).map(({ entry }) => [entry.isGuest, entry.guestOfPersonId]);
            const lastGame = entries.filter(({ localDate }) => localDate === '2025-05-12');
            const lastAttendance = yield* db
                .select()
                .from(attendance)
                .innerJoin(session, eq(session.id, attendance.sessionId))
                .where(and(eq(session.communityId, communityId), eq(session.localDate, '2025-05-12')));

            expect(stats).toMatchObject({
                sessions: games,
                accounts: 5,
                votes: games * 3,
                aliasLinks: 1,
                segmentLinks: 0,
                sharedEntries: 0,
                unassignedGuestRequests: 1
            });
            expect(members.filter(({ status }) => status === 'active')).toHaveLength(2);
            expect(members.filter(({ status }) => status === 'left')).toHaveLength(3);
            expect(bots).toEqual([]);
            expect(votes.map(({ choice }) => choice)).toEqual(['yes', 'yes', 'yes']);
            expect(alias('гонзо')).toMatchObject({ personId: striker, resolution: 'vote' });
            expect(shown?.displayName).toBe('Гонзо');
            expect(entries.filter(({ entry }) => entry.raw === 'Я').every(({ entry }) => entry.resolvedBy === 'account')).toBe(true);
            expect(aliases.filter(({ kind }) => kind === 'placeholder').map(({ aliasNorm }) => aliasNorm)).toEqual(['зорро']);
            expect(entries.filter(({ entry }) => entry.raw === 'Зорро').every(({ entry }) => !isDefined(entry.personId))).toBe(true);
            expect(entries.filter(({ entry }) => entry.raw === 'Пират').map(({ entry }) => !isDefined(entry.personId))).toEqual([
                false,
                true
            ]);
            expect(guestsNamed('Друг Гонзо')).toEqual([[true, striker]]);
            expect(guestsNamed('новый')).toEqual([[true, null]]);
            expect(
                entries
                    .filter(({ entry, localDate }) => localDate === '2025-05-01' && entry.aliasId === alias('гонзо')?.id)
                    .map(({ entry }) => [entry.raw, entry.isGuest])
            ).toEqual([
                ['Гонзо', false],
                ['Гонзо +1', true]
            ]);
            expect(lastGame.map(({ entry }) => [entry.teamOrdinal, entry.personId])).toEqual([
                [0, null],
                [0, null]
            ]);
            expect(lastAttendance).toEqual([]);
        })
    );

    it.effect('gives the same result twice, keeps manual overrides, unlinked nicknames and live line-ups', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const slug = 'twice-fc';
            const first = yield* load(slug);
            const again = yield* load(slug);

            expect(again.stats).toEqual(first.stats);
            expect(resolutions(again.entries)).toEqual(resolutions(first.entries));

            const organizer = yield* accountPerson(ids.org);
            const striker = yield* accountPerson(ids.striker);
            const other = yield* accountPerson(ids.other);
            const manual = again.entries.find(({ entry }) => entry.raw === 'Олег');
            yield* db
                .update(lineupEntry)
                .set({ personId: other, resolvedBy: 'manual' })
                .where(eq(lineupEntry.id, manual?.entry.id ?? ''));
            yield* db
                .update(attendance)
                .set({ outcome: 'no_show', source: 'manual' })
                .where(and(eq(attendance.sessionId, manual?.entry.sessionId ?? ''), eq(attendance.personId, organizer)));
            yield* db
                .update(personAlias)
                .set({ resolution: 'guest' })
                .where(eq(personAlias.id, again.alias('гонзо')?.id ?? ''));
            yield* db.insert(telegramChat).values({ chatId: -900n, communityId: again.communityId, kind: 'supergroup', title: 'Test' });
            const live = again.entries.find(({ localDate }) => localDate === '2025-05-05');
            yield* db.insert(messageRef).values({
                chatId: -900n,
                messageId: live?.entry.messageId ?? 0,
                purpose: 'lineup',
                entityType: 'session',
                entityId: live?.entry.sessionId ?? ''
            });
            const third = yield* load(slug);
            const kept = third.entries.filter(({ entry }) => entry.sessionId === manual?.entry.sessionId);
            const [noShow] = yield* db
                .select()
                .from(attendance)
                .where(and(eq(attendance.sessionId, manual?.entry.sessionId ?? ''), eq(attendance.personId, organizer)));
            const liveEntries = third.entries.filter(({ entry }) => entry.sessionId === live?.entry.sessionId);

            expect(kept.filter(({ entry }) => entry.resolvedBy === 'manual').map(({ entry }) => entry.personId)).toEqual([other]);
            expect(noShow?.outcome).toBe('no_show');
            expect(third.alias('гонзо')?.resolution).toBe('guest');
            expect(third.stats.aliasLinks).toBe(0);
            expect(third.entries.some(({ entry, localDate }) => entry.personId === striker && localDate !== '2025-05-05')).toBe(true);
            expect(liveEntries.map(({ entry }) => entry.id)).toContain(live?.entry.id);
        })
    );

    it.effect('upgrades an earlier import in place', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const slug = 'upgrade-fc';
            const before = yield* load(slug, messages);
            const [legacy] = yield* db.insert(person).values({ displayName: 'Legacy', source: 'import' }).returning({ id: person.id });
            yield* db
                .update(personAlias)
                .set({ personId: legacy?.id, guestPersonId: legacy?.id, resolution: 'suggested', occurrences: 99 })
                .where(eq(personAlias.id, before.alias('олег')?.id ?? ''));
            const after = yield* load(slug, messages);
            const sessions = yield* db
                .select({ ids: sql<string>`string_agg(${session.id}::text, ',' order by ${session.localDate})` })
                .from(session)
                .where(eq(session.communityId, after.communityId));

            expect(after.alias('олег')).toMatchObject({ personId: legacy?.id, occurrences: 6 });
            expect(after.entries.map(({ entry }) => entry.sessionId)).toEqual(before.entries.map(({ entry }) => entry.sessionId));
            expect(sessions[0]?.ids.split(',')).toHaveLength(games);
        })
    );

    it.effect('keeps what an admin changed in an imported game, even its date', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const slug = 'edited-fc';
            const first = yield* load(slug);
            const gameOn = (date: string): string => first.entries.find(({ localDate }) => localDate === date)?.entry.sessionId ?? '';
            const edited = gameOn('2025-05-07');
            const cancelled = gameOn('2025-05-08');
            const startsAt = new Date('2025-06-20T18:30:00Z');
            yield* db
                .update(session)
                .set({ localDate: '2025-06-20', startsAt, endsAt: new Date('2025-06-20T20:00:00Z') })
                .where(eq(session.id, edited));
            yield* db.update(session).set({ status: 'cancelled', cancelReason: 'weather' }).where(eq(session.id, cancelled));
            yield* db.insert(sessionChange).values([edited, cancelled].map(sessionId => ({ sessionId, diff: {} })));
            const again = yield* load(slug);
            const all = yield* db.select().from(session).where(eq(session.communityId, again.communityId));
            const played = yield* db.select().from(attendance).where(eq(attendance.sessionId, cancelled));

            expect(all).toHaveLength(first.stats.sessions);
            expect(all.find(({ id }) => id === edited)).toMatchObject({ localDate: '2025-06-20', startsAt });
            expect(all.find(({ id }) => id === cancelled)).toMatchObject({ status: 'cancelled', cancelReason: 'weather' });
            expect(played).toEqual([]);
        })
    );

    it.effect('works without a snapshot', () =>
        Effect.gen(function* () {
            const config = { ...testConfig, slug: 'no-snapshot-fc' };
            const stats = yield* loadPlan(config, assemblePlan(extractAll(messages, config), '2025-06-30'), 'sha');

            expect(stats).toMatchObject({ sessions: games, accounts: 1, votes: 0, aliasLinks: 0 });
        })
    );
});
