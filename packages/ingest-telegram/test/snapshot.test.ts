import { expect, layer } from '@effect/vitest';
import { isDefined } from '@rnw-community/shared';
import { person, personAlias, telegramAccount } from '@rondo/db/schema/identity.schema';
import { activity, community, membership, telegramChat } from '@rondo/db/schema/org.schema';
import { messageRef, pollVote } from '@rondo/db/schema/platform.schema';
import { lineupEntry, team, teamMember } from '@rondo/db/schema/play.schema';
import { attendance, session, sessionChange } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { testDbLayer } from '@rondo/db/testing/test-db.layer';
import { and, asc, eq, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Tracer from 'effect/Tracer';

import { assemblePlan } from '../src/extract/assemble-plan';
import { extractAll } from '../src/extract/extract-all';
import { loadEvidence } from '../src/identity/load-evidence';
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
            const [stale] = yield* db.insert(person).values({ displayName: 'Stale', source: 'import' }).returning({ id: person.id });
            yield* db.insert(personAlias).values({
                communityId: before.communityId,
                personId: stale?.id,
                guestPersonId: stale?.id,
                alias: 'Нет такого',
                aliasNorm: 'нет такого',
                resolution: 'suggested'
            });
            const after = yield* load(slug, messages);
            const leftovers = yield* db
                .select({ id: person.id })
                .from(person)
                .where(eq(person.id, stale?.id ?? ''));
            const sessions = yield* db
                .select({ ids: sql<string>`string_agg(${session.id}::text, ',' order by ${session.localDate})` })
                .from(session)
                .where(eq(session.communityId, after.communityId));

            expect(after.alias('олег')).toMatchObject({ personId: legacy?.id, occurrences: 6 });
            expect(after.alias('нет такого')).toBeUndefined();
            expect(leftovers).toHaveLength(1);
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

    it.effect('backfills a live line-up of the old bot and keeps its game and its nicknames', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const slug = 'old-bot-fc';
            const day = 2;
            const rest = messages.filter(({ id }) => id !== pollMessage(day) && id !== pollMessage(day) + 1);
            const { communityId } = yield* load(slug, rest);
            const [football] = yield* db.select().from(activity).where(eq(activity.communityId, communityId));
            const people = yield* db
                .insert(person)
                .values([{ displayName: 'Гонзо' }, { displayName: 'Странник' }])
                .returning({ id: person.id });
            const [, wanderer] = people;
            const [game] = yield* db
                .insert(session)
                .values({
                    communityId,
                    activityId: football?.id ?? '',
                    localDate: '2025-05-03',
                    startsAt: new Date('2025-05-03T17:00:00Z'),
                    status: 'played',
                    source: 'bot'
                })
                .returning({ id: session.id });
            const sessionId = game?.id ?? '';
            const [oldTeam] = yield* db.insert(team).values({ sessionId, ordinal: 1 }).returning({ id: team.id });
            yield* db.insert(personAlias).values({
                communityId,
                personId: wanderer?.id,
                guestPersonId: wanderer?.id,
                alias: 'Странник',
                aliasNorm: 'странник'
            });
            yield* db.insert(teamMember).values(people.map(({ id }) => ({ teamId: oldTeam?.id ?? '', sessionId, personId: id })));
            yield* db
                .insert(attendance)
                .values(people.map(({ id }) => ({ sessionId, personId: id, outcome: 'attended' as const, source: 'bot' as const })));
            yield* db.insert(telegramChat).values({ chatId: -901n, communityId, kind: 'supergroup', title: 'Old' });
            yield* db.insert(messageRef).values({
                chatId: -901n,
                messageId: pollMessage(day) + 1,
                purpose: 'lineup',
                entityType: 'session',
                entityId: sessionId
            });

            const partial = yield* load(
                slug,
                messages.filter(({ id }) => id !== pollMessage(day) + 1)
            );
            const untouchedTeam = yield* db.select().from(teamMember).where(eq(teamMember.sessionId, sessionId));
            const untouched = yield* db.select().from(attendance).where(eq(attendance.sessionId, sessionId));
            const full = yield* load(slug);
            const again = yield* load(slug);
            const sameDay = yield* db
                .select()
                .from(session)
                .where(and(eq(session.communityId, communityId), eq(session.localDate, '2025-05-03')));
            const ofGame = ({ entries }: typeof full) => entries.filter(({ entry }) => entry.sessionId === sessionId);

            expect(partial.alias('странник')?.personId).toBe(wanderer?.id);
            expect(untouched).toHaveLength(2);
            expect(untouchedTeam).toHaveLength(2);
            expect(sameDay.map(({ id }) => id)).toEqual([sessionId]);
            expect(ofGame(full).map(({ entry }) => entry.raw)).toEqual(['Я', 'Гонзо', 'Зорро', 'Олег', 'Зорро']);
            expect(resolutions(ofGame(again))).toEqual(resolutions(ofGame(full)));
        })
    );

    it.effect('keeps a game whose only manual work is an entry, and manual entries a new line-up does not match', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const slug = 'manual-entry-fc';
            const first = yield* load(slug);
            const other = yield* accountPerson(ids.other);
            const linkTo = (date: string, raw: string) => {
                const found = first.entries.find(({ entry, localDate }) => localDate === date && entry.raw === raw)?.entry;

                return db
                    .update(lineupEntry)
                    .set({ personId: other, resolvedBy: 'manual' })
                    .where(eq(lineupEntry.id, found?.id ?? ''))
                    .returning({ sessionId: lineupEntry.sessionId });
            };
            const [gone] = yield* linkTo('2025-05-05', 'Олег');
            const [pollOnly] = yield* linkTo('2025-05-07', 'Олег');
            const [changed] = yield* linkTo('2025-05-09', 'Олег');
            const partial = messages
                .filter(({ id }) => ![pollMessage(4), pollMessage(4) + 1, pollMessage(6) + 1].includes(id))
                .map(item =>
                    item.id === pollMessage(8) + 1
                        ? message(item.id, '2025-05-09T12:00:00Z', 'Составы на сегодня, North:\n🟢Я, Гонзо\n🔵Семён', { authorId: ids.org })
                        : item
                );
            const again = yield* load(slug, partial);
            const manualIn = (sessionId: string | undefined) =>
                again.entries
                    .filter(({ entry }) => entry.sessionId === sessionId && entry.resolvedBy === 'manual')
                    .map(({ entry }) => entry.personId);
            const played = yield* db
                .select({ sessionId: attendance.sessionId })
                .from(attendance)
                .where(and(eq(attendance.personId, other), eq(attendance.sessionId, changed?.sessionId ?? '')));

            expect(manualIn(gone?.sessionId)).toEqual([other]);
            expect(manualIn(pollOnly?.sessionId)).toEqual([other]);
            expect(manualIn(changed?.sessionId)).toEqual([other]);
            expect(played).toHaveLength(1);
        })
    );

    it.effect('writes line-ups only under the community lock', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            yield* db.execute(sql`
                create function play.require_lock() returns trigger language plpgsql as $$
                begin
                    if not exists (select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and granted) then
                        raise exception 'no community lock';
                    end if;
                    return new;
                end $$`);
            yield* db.execute(
                sql`create trigger require_lock before insert on play.lineup_entry for each row execute function play.require_lock()`
            );
            const outcome = yield* Effect.exit(load('locked-fc'));
            yield* db.execute(sql`drop trigger require_lock on play.lineup_entry`);
            yield* db.execute(sql`drop function play.require_lock`);

            expect(Exit.isSuccess(outcome)).toBe(true);
        })
    );

    it.effect('counts a person with two accounts as one voter and loads the evidence once', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const slug = 'two-accounts-fc';
            const { communityId } = yield* load(slug);
            const striker = yield* accountPerson(ids.striker);
            const original = yield* accountPerson(ids.other);
            yield* db
                .update(telegramAccount)
                .set({ personId: striker })
                .where(eq(telegramAccount.tgUserId, BigInt(ids.other)));
            const { squads } = yield* loadEvidence(communityId);
            const loads: string[] = [];
            const tracer = Tracer.make({
                span: options => {
                    loads.push(options.name);

                    return new Tracer.NativeSpan(options);
                }
            });
            yield* load(slug).pipe(Effect.withTracer(tracer));
            yield* db
                .update(telegramAccount)
                .set({ personId: original })
                .where(eq(telegramAccount.tgUserId, BigInt(ids.other)));

            expect(squads.find(({ date }) => date === '2025-05-04')?.yes?.size).toBe(1);
            expect(loads.filter(name => name === 'IngestTelegram.loadEvidence')).toHaveLength(1);
        })
    );

    it.effect('leaves teams the bot published alone', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const slug = 'published-fc';
            const first = yield* load(slug);
            const published = first.entries.find(({ localDate }) => localDate === '2025-05-03')?.entry;
            const sessionId = published?.sessionId ?? '';
            yield* db.delete(lineupEntry).where(eq(lineupEntry.sessionId, sessionId));
            yield* db.update(teamMember).set({ assignedBy: 'balancer' }).where(eq(teamMember.sessionId, sessionId));
            const before = yield* db.select().from(teamMember).where(eq(teamMember.sessionId, sessionId));
            yield* db.insert(telegramChat).values({ chatId: -902n, communityId: first.communityId, kind: 'supergroup', title: 'Pub' });
            yield* db.insert(messageRef).values({
                chatId: -902n,
                messageId: published?.messageId ?? 0,
                purpose: 'lineup',
                entityType: 'session',
                entityId: sessionId
            });
            const again = yield* load(slug);
            const after = yield* db.select().from(teamMember).where(eq(teamMember.sessionId, sessionId));

            expect(before.length).toBeGreaterThan(0);
            expect(after).toEqual(before);
            expect(again.entries.filter(({ entry }) => entry.sessionId === sessionId)).toEqual([]);
        })
    );
});
