import { expect, layer } from '@effect/vitest';
import { isDefined } from '@rnw-community/shared';
import { aliasLink, person, personAlias, telegramAccount } from '@rondo/db/schema/identity.schema';
import { activity, community, membership, telegramChat } from '@rondo/db/schema/org.schema';
import { importedPoll, messageRef, pollVote, telegramPoll } from '@rondo/db/schema/platform.schema';
import { lineupEntry, team, teamMember } from '@rondo/db/schema/play.schema';
import { attendance, session, sessionChange } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { testDbLayer } from '@rondo/db/testing/test-db.layer';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Option from 'effect/Option';
import * as Tracer from 'effect/Tracer';

import { loadGameDecisions, parseGameDecisions } from '../src/approvals/game-decisions';
import { compareApprovals, loadApprovals } from '../src/approvals/load-approvals';
import { parseApprovals } from '../src/approvals/parse-approvals';
import { assemblePlan } from '../src/extract/assemble-plan';
import { extractAll } from '../src/extract/extract-all';
import { applyApproved } from '../src/identity/apply-approved';
import { loadEvidence } from '../src/identity/load-evidence';
import { importMessages } from '../src/ingest.effect';
import { loadPlan } from '../src/load/load-plan';
import { parseSnapshot } from '../src/parse/parse-snapshot';

import { message, testConfig } from './fixture';

type TelegramMessage = ReturnType<typeof message>;

const linkColumns = {
    status: aliasLink.status,
    personId: aliasLink.personId,
    during: sql<string>`${aliasLink.during}::text`,
    method: aliasLink.method,
    decidedBy: aliasLink.decidedBy,
    decidedAt: aliasLink.decidedAt
};

const games = 12;
const base = 900_000;
const ids = { org: base, striker: base + 1, left: base + 2, bot: base + 3, gone: base + 4, other: base + 5 };
const dayOf = (index: number): string => String(index + 1).padStart(2, '0');
const pollMessage = (index: number): number => index * 10 + 1;

const messages: TelegramMessage[] = Array.from({ length: games }, (_, index) => [
    message(pollMessage(index), `2025-05-${dayOf(index)}T08:00:00Z`, '', {
        text: undefined,
        authorId: ids.org,
        poll: { question: 'Сегодня, 19.00 North', answers: ['+', '-'] }
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

const pollIdIn = (slug: string, index: number): string => `${slug}-${pollId(index)}`;

const snapshotOf = (slug: string) =>
    snapshot.pipe(
        Effect.map(content => ({
            ...content,
            pollIdByMessage: new Map([...content.pollIdByMessage].map(([messageId, id]) => [messageId, `${slug}-${id}`] as const)),
            votes: content.votes.map(({ pollId: id, userId, choice, votedAt }) => ({ pollId: `${slug}-${id}`, userId, choice, votedAt }))
        }))
    );

const load = Effect.fn('test.load')(function* (
    slug: string,
    source: readonly TelegramMessage[] = [...messages, ...chat],
    allowRemoval?: boolean
) {
    const db = yield* Db;
    const config = { ...testConfig, slug };
    const content = yield* snapshotOf(slug);
    const stats = yield* importMessages({
        config,
        messages: source,
        fileSha256: 'sha',
        snapshot: Option.fromNullishOr(content),
        allowRemoval: allowRemoval ?? true
    });
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

const namedOn = Effect.fn('test.namedOn')(function* (communityId: string, date: string, personIds: readonly string[]) {
    const db = yield* Db;

    return yield* db
        .select({ raw: lineupEntry.raw, personId: lineupEntry.personId, resolvedBy: lineupEntry.resolvedBy })
        .from(lineupEntry)
        .innerJoin(session, eq(session.id, lineupEntry.sessionId))
        .where(and(eq(session.communityId, communityId), eq(session.localDate, date), inArray(lineupEntry.personId, [...personIds])));
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
                .where(eq(pollVote.pollId, pollIdIn('snapshot-fc', 0)));
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
            const stats = yield* loadPlan(config, assemblePlan(extractAll(messages, config), '2025-06-30'), { fileSha256: 'sha' });

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
                    if not exists (
                        select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and granted
                        and ((classid::bigint << 32) | objid::bigint) = hashtextextended('rondo.community:locked-fc', 0)
                    ) then
                        raise exception 'no community lock';
                    end if;
                    return new;
                end $$`);
            yield* db.execute(
                sql`create trigger require_lock before insert on play.lineup_entry for each row execute function play.require_lock()`
            );
            const outcome = yield* Effect.exit(load('locked-fc')).pipe(
                Effect.ensuring(db.execute(sql`drop function play.require_lock cascade`).pipe(Effect.orDie))
            );

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

    it.effect('keeps published teams of a game that also has entries with vote links', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const slug = 'balanced-fc';
            const first = yield* load(slug);
            const linked = first.entries.find(({ entry, localDate }) => entry.resolvedBy === 'vote' && localDate === '2025-05-05')?.entry;
            const sessionId = linked?.sessionId ?? '';
            const striker = yield* accountPerson(ids.striker);
            const other = yield* accountPerson(ids.other);
            yield* db.delete(team).where(eq(team.sessionId, sessionId));
            const teams = yield* db
                .insert(team)
                .values([1, 2, 3].map(ordinal => ({ sessionId, ordinal })))
                .returning({ id: team.id });
            yield* db.insert(teamMember).values(
                [other, striker].map((personId, index) => ({
                    teamId: teams[index]?.id ?? '',
                    sessionId,
                    personId,
                    assignedBy: 'balancer' as const
                }))
            );
            const membersOf = () => db.select().from(teamMember).where(eq(teamMember.sessionId, sessionId)).orderBy(teamMember.personId);
            const before = yield* membersOf();
            yield* load(slug);
            const unreferenced = yield* membersOf();
            yield* db.insert(telegramChat).values({ chatId: -903n, communityId: first.communityId, kind: 'supergroup', title: 'Bal' });
            yield* db.insert(messageRef).values({
                chatId: -903n,
                messageId: 777_777,
                purpose: 'lineup',
                entityType: 'session',
                entityId: sessionId
            });
            yield* load(slug);
            const played = yield* db.select().from(attendance).where(eq(attendance.sessionId, sessionId));

            expect(linked?.personId).toBe(striker);
            expect(unreferenced).toEqual(before);
            expect(yield* membersOf()).toEqual(before);
            expect(played.map(({ personId }) => personId)).toContain(striker);
            expect(played.map(({ personId }) => personId)).not.toContain(other);
        })
    );

    it.effect('pins approved links and lets a rejection block new ones, without storing automatic ones', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const slug = 'approve-fc';
            const first = yield* load(slug);
            const striker = yield* accountPerson(ids.striker);
            const other = yield* accountPerson(ids.other);
            const alias = first.alias('гонзо');
            const linksOf = () =>
                db
                    .select(linkColumns)
                    .from(aliasLink)
                    .where(eq(aliasLink.aliasId, alias?.id ?? ''));
            const auto = yield* linksOf();
            yield* db.insert(aliasLink).values([
                {
                    communityId: first.communityId,
                    aliasId: alias?.id ?? '',
                    personId: other,
                    during: '[2025-05-01,2025-05-03)',
                    method: 'owner_list',
                    status: 'approved'
                }
            ]);
            const pinned = yield* load(slug);
            const gonzo = ({ entries }: typeof first) =>
                entries
                    .filter(({ entry }) => entry.aliasId === alias?.id && !entry.isGuest)
                    .map(({ entry, localDate }) => [localDate, entry.personId]);
            const kept = yield* linksOf();
            yield* db.delete(aliasLink).where(eq(aliasLink.aliasId, alias?.id ?? ''));
            yield* db.insert(aliasLink).values({
                communityId: first.communityId,
                aliasId: alias?.id ?? '',
                personId: striker,
                during: '(,)',
                method: 'admin',
                status: 'rejected'
            });
            const blocked = yield* load(slug);

            expect(first.alias('гонзо')).toMatchObject({ personId: striker, resolution: 'vote' });
            expect(auto).toEqual([]);
            expect(gonzo(pinned).slice(0, 3)).toEqual([
                ['2025-05-01', other],
                ['2025-05-02', other],
                ['2025-05-03', striker]
            ]);
            expect(kept).toHaveLength(1);
            expect(pinned.alias('гонзо')).toMatchObject({ resolution: 'unresolved' });
            expect(gonzo(blocked).some(([, personId]) => personId === striker)).toBe(false);
            expect(blocked.stats.aliasLinks).toBe(0);
        })
    );

    it.effect('loads a private list of approvals once and compares it after an import', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const slug = 'list-fc';
            const first = yield* load(slug);
            const other = yield* accountPerson(ids.other);
            const line = (raw: string, id: number, index: number) => `${raw}|${id}|${pollMessage(index) + 1}|2025-05-${dayOf(index)}`;
            const list = [
                line('Гонзо', ids.striker, 0),
                line('Гонзо', ids.striker, 1),
                line('Олег', ids.other, 4),
                line('Зорро', ids.other, 1)
            ];
            const rows = yield* parseApprovals([...list, line('Никого', ids.other, 1)].join('\n'), testConfig);
            const decidedAt = new Date('2026-11-24T00:00:00Z');
            const loaded = yield* loadApprovals({ slug, rows, decidedAt });
            const again = yield* loadApprovals({ slug, rows, decidedAt });
            yield* load(slug);
            const compared = yield* compareApprovals(slug, rows);
            const links = yield* db
                .select(linkColumns)
                .from(aliasLink)
                .where(and(eq(aliasLink.communityId, first.communityId), eq(aliasLink.status, 'approved')));
            const shared = yield* db
                .select()
                .from(lineupEntry)
                .innerJoin(session, eq(session.id, lineupEntry.sessionId))
                .where(and(eq(session.communityId, first.communityId), eq(lineupEntry.raw, 'Зорро'), eq(lineupEntry.personId, other)));

            expect(loaded).toMatchObject({ rows: 5, stored: 5 });
            expect(again.stored).toBe(0);
            expect(links.every(link => link.decidedAt?.getTime() === decidedAt.getTime() && link.method === 'owner_list')).toBe(true);
            const pinned = yield* db
                .select({ resolvedBy: lineupEntry.resolvedBy })
                .from(lineupEntry)
                .innerJoin(session, eq(session.id, lineupEntry.sessionId))
                .where(
                    and(
                        eq(session.communityId, first.communityId),
                        eq(session.localDate, '2025-05-01'),
                        eq(lineupEntry.raw, 'Гонзо'),
                        eq(lineupEntry.isGuest, false)
                    )
                );
            yield* db
                .update(lineupEntry)
                .set({ personId: null })
                .where(and(eq(lineupEntry.raw, 'Олег'), eq(lineupEntry.personId, other)));
            const broken = yield* compareApprovals(slug, rows);

            expect(pinned).toEqual([{ resolvedBy: 'alias' }]);
            expect(broken).toMatchObject({ kept: 3, nicknameGone: 1, linkedToOther: 1 });
            expect(compared).toMatchObject({ rows: 5, kept: 4, nicknameGone: 1, linkedToOther: 0, otherMessage: 0 });
            expect(shared).toHaveLength(1);
            expect(shared[0]?.lineup_entry.isTeamUndecided).toBe(true);
        })
    );

    it.effect('gives no team to a player whose team is undecided, but keeps the attendance', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const slug = 'undecided-fc';
            const first = yield* load(slug);
            const other = yield* accountPerson(ids.other);
            const rows = yield* parseApprovals(`Зорро|${ids.other}|12|2025-05-02`, testConfig);
            yield* loadApprovals({ slug, rows, decidedAt: new Date('2026-11-24T00:00:00Z') });
            const game = first.entries.find(({ localDate }) => localDate === '2025-05-02');
            const ofGame = { sessionId: game?.entry.sessionId ?? '' };
            const teams = yield* db.select().from(teamMember).where(eq(teamMember.sessionId, ofGame.sessionId));
            const played = yield* db.select().from(attendance).where(eq(attendance.sessionId, ofGame.sessionId));

            expect(teams.map(({ personId }) => personId)).not.toContain(other);
            expect(played.map(({ personId }) => personId)).toContain(other);
        })
    );

    it.effect('fills only what is missing from a snapshot and skips a handle that another account holds', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const slug = 'fill-fc';
            const { communityId } = yield* load(slug);
            const accountOf = (id: number) =>
                db
                    .select()
                    .from(telegramAccount)
                    .where(eq(telegramAccount.tgUserId, BigInt(id)));
            const striker = yield* accountPerson(ids.striker);
            yield* db
                .update(telegramAccount)
                .set({ firstName: 'Live', username: 'live_name' })
                .where(eq(telegramAccount.tgUserId, BigInt(ids.striker)));
            yield* db.insert(telegramAccount).values({ tgUserId: 990_001n, firstName: 'Holder', username: 'STRIKER' });
            yield* db
                .update(telegramAccount)
                .set({ username: null })
                .where(eq(telegramAccount.tgUserId, BigInt(ids.striker)));
            yield* db
                .update(membership)
                .set({ status: 'left' })
                .where(and(eq(membership.communityId, communityId), eq(membership.personId, striker)));
            yield* load(slug);
            const [kept] = yield* accountOf(ids.striker);
            const [holder] = yield* accountOf(990_001);
            const [member] = yield* db
                .select()
                .from(membership)
                .where(and(eq(membership.communityId, communityId), eq(membership.personId, striker)));
            yield* db.delete(telegramAccount).where(eq(telegramAccount.tgUserId, 990_001n));
            yield* db
                .update(telegramAccount)
                .set({ firstName: `U${ids.striker}`, username: 'Striker' })
                .where(eq(telegramAccount.tgUserId, BigInt(ids.striker)));

            expect(kept).toMatchObject({ firstName: 'Live', username: null });
            expect(holder?.username).toBe('STRIKER');
            expect(member?.status).toBe('left');
        })
    );

    it.effect('refuses to remove many imported games without a flag and never removes a game with published teams', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const slug = 'removal-fc';
            const first = yield* load(slug);
            const few = messages.slice(0, 4);
            const refused = yield* Effect.flip(load(slug, few, false));
            const kept = first.entries.find(({ localDate }) => localDate === '2025-05-07')?.entry.sessionId ?? '';
            yield* db.update(teamMember).set({ assignedBy: 'balancer' }).where(eq(teamMember.sessionId, kept));
            yield* load(slug, few, true);
            const left = yield* db.select({ id: session.id }).from(session).where(eq(session.communityId, first.communityId));

            expect(refused).toMatchObject({ _tag: 'TooManyRemovedGamesError', imported: games });
            expect(refused).toHaveProperty('dates.length', games - 2);
            expect(left.map(({ id }) => id)).toContain(kept);
            expect(left).toHaveLength(3);
        })
    );

    it.effect('loads lists before the first import, day by day, in any order and only once', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const decidedAt = new Date('2026-11-24T00:00:00Z');
            const line = (raw: string, id: number, index: number) => `${raw}|${id}|${pollMessage(index) + 1}|2025-05-${dayOf(index)}`;
            const first = yield* parseApprovals([line('Гонзо', ids.other, 0), line('Гонзо', ids.other, 5)].join('\n'), testConfig);
            const second = yield* parseApprovals([line('Гонзо', ids.striker, 2), line('Олег', 777_001, 4)].join('\n'), testConfig);
            const outcome = Effect.fn('test.outcome')(function* (slug: string, lists: readonly (typeof first)[]) {
                yield* db.insert(community).values({ slug, name: slug });
                const loads = yield* Effect.all(lists.map(rows => loadApprovals({ slug, rows, decidedAt })));
                const { communityId, entries, alias } = yield* load(slug);
                const compared = yield* compareApprovals(slug, [...first, ...second]);
                const links = yield* db
                    .select(linkColumns)
                    .from(aliasLink)
                    .where(and(eq(aliasLink.communityId, communityId), eq(aliasLink.status, 'approved')));
                const gonzo = entries
                    .filter(({ entry }) => entry.aliasId === alias('гонзо')?.id && !entry.isGuest)
                    .map(({ entry, localDate }) => `${localDate} ${entry.resolvedBy} ${entry.personId}`);

                return { loads, gonzo, compared, days: links.map(({ during }) => during).toSorted() };
            });
            const forward = yield* outcome('before-a-fc', [first, second, first, second]);
            const backward = yield* outcome('before-b-fc', [second, first]);
            const other = yield* accountPerson(ids.other);
            const [unseen] = yield* db.select().from(telegramAccount).where(eq(telegramAccount.tgUserId, 777_001n));

            expect(forward.loads.map(({ stored }) => stored)).toEqual([2, 2, 0, 0]);
            expect(forward.days).toEqual([
                '[2025-05-01,2025-05-02)',
                '[2025-05-03,2025-05-04)',
                '[2025-05-05,2025-05-06)',
                '[2025-05-06,2025-05-07)'
            ]);
            expect(backward.days).toEqual(forward.days);
            expect(backward.gonzo).toEqual(forward.gonzo);
            expect(forward.gonzo.filter(entry => entry.includes('alias'))).toHaveLength(3);
            expect(forward.gonzo[1]).not.toContain(other);
            expect(forward.compared).toMatchObject({ rows: 4, kept: 4 });
            expect(unseen?.personId).not.toBeNull();
        })
    );

    it.effect('keeps a decided game after an import that says otherwise', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const slug = 'decided-fc';
            const unclear = [
                message(950, '2025-05-12T09:00:00Z', '', {
                    text: undefined,
                    poll: { question: 'Сегодня, 19.00 North', answers: ['+', '-'], voters: [12, 1] }
                }),
                message(951, '2025-05-12T12:00:00Z', 'Он отменился')
            ];
            const source = [...messages.filter(({ id }) => id !== pollMessage(games - 1)), ...unclear];
            const first = yield* load(slug, source);
            const gameOn = Effect.fn('test.gameOn')(function* (localDate: string) {
                const [game] = yield* db
                    .select()
                    .from(session)
                    .where(and(eq(session.communityId, first.communityId), eq(session.localDate, localDate)));

                return game;
            });
            const inReview = yield* gameOn('2025-05-12');
            const decisions = yield* parseGameDecisions(
                '2025-05-12|football|played\n2025-05-02|football|cancelled\n1999-01-01|football|played'
            );
            const decidedAt = new Date('2026-11-24T00:00:00Z');
            const loaded = yield* loadGameDecisions({ slug, decisions, decidedAt });
            const withoutAttendance = yield* db
                .select()
                .from(attendance)
                .innerJoin(session, eq(session.id, attendance.sessionId))
                .where(and(eq(session.communityId, first.communityId), eq(session.localDate, '2025-05-02')));
            const again = yield* loadGameDecisions({ slug, decisions, decidedAt });
            const second = yield* load(slug, source);
            const played = yield* gameOn('2025-05-12');
            const cancelled = yield* gameOn('2025-05-02');
            const attended = yield* db
                .select()
                .from(attendance)
                .where(eq(attendance.sessionId, cancelled?.id ?? ''));
            const changes = yield* db
                .select()
                .from(sessionChange)
                .where(eq(sessionChange.sessionId, played?.id ?? ''));

            expect(inReview).toMatchObject({ status: 'cancelled', reviewReason: 'unclear_cancellation' });
            expect(loaded).toEqual({ decisions: 3, changed: 2, missing: ['1999-01-01|football'], ambiguous: [] });
            expect(again).toMatchObject({ changed: 0 });
            expect(played).toMatchObject({ id: inReview?.id, status: 'played', cancelReason: null, reviewReason: null });
            expect(cancelled).toMatchObject({ status: 'cancelled', cancelReason: 'organizer' });
            expect(withoutAttendance).toEqual([]);
            expect(attended).toEqual([]);
            expect(changes).toHaveLength(1);
            expect(second.stats.sessions).toBe(first.stats.sessions);
        })
    );

    it.effect('rejects a game decision it does not understand', () =>
        Effect.gen(function* () {
            const outcomes = yield* Effect.all(
                ['2025-05-12|football|maybe', '12.05.2025|football|played', '2025-05-12|chess|played'].map(line =>
                    Effect.exit(parseGameDecisions(line))
                )
            );

            expect(outcomes.map(outcome => Exit.isFailure(outcome))).toEqual([true, true, true]);
        })
    );

    it.effect('lets manual entries and players already listed win over an approval', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const slug = 'pin-limits-fc';
            const first = yield* load(slug);
            const organizer = yield* accountPerson(ids.org);
            const striker = yield* accountPerson(ids.striker);
            const other = yield* accountPerson(ids.other);
            const entryOn = (found: typeof first, date: string, raw: string) =>
                found.entries.find(({ entry, localDate }) => localDate === date && entry.raw === raw)?.entry;
            yield* db
                .update(lineupEntry)
                .set({ personId: other, resolvedBy: 'manual' })
                .where(eq(lineupEntry.id, entryOn(first, '2025-05-01', 'Олег')?.id ?? ''));
            const row = { communityId: first.communityId, method: 'owner_list' as const, status: 'approved' as const };
            yield* db.insert(aliasLink).values([
                { ...row, aliasId: first.alias('олег')?.id ?? '', personId: striker, during: '[2025-05-01,2025-05-02)' },
                { ...row, aliasId: first.alias('семен')?.id ?? '', personId: organizer, during: '[2025-05-02,2025-05-03)' }
            ]);
            const again = yield* load(slug);

            expect(entryOn(again, '2025-05-01', 'Олег')).toMatchObject({ personId: other, resolvedBy: 'manual' });
            expect(entryOn(again, '2025-05-02', 'Семён')?.personId).not.toBe(organizer);
            expect(entryOn(again, '2025-05-02', 'Я')?.personId).toBe(organizer);
        })
    );

    it.effect('gives a player with an approved nickname no second automatic one and keeps decided nicknames', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const slug = 'one-name-fc';
            const first = yield* load(slug);
            const striker = yield* accountPerson(ids.striker);
            const [unused] = yield* db
                .insert(personAlias)
                .values({ communityId: first.communityId, alias: 'Забытый', aliasNorm: 'забытый' })
                .returning();
            const row = { communityId: first.communityId, method: 'admin' as const };
            yield* db.insert(aliasLink).values([
                {
                    ...row,
                    aliasId: first.alias('олег')?.id ?? '',
                    personId: striker,
                    during: '[2030-01-01,2030-02-01)',
                    status: 'approved'
                },
                { ...row, aliasId: unused?.id ?? '', personId: striker, during: '(,)', status: 'rejected' }
            ]);
            const again = yield* load(slug);

            expect(first.stats.aliasLinks).toBe(1);
            expect(again.stats.aliasLinks).toBe(0);
            expect(again.alias('забытый')?.id).toBe(unused?.id);
        })
    );

    it.effect('links a shared nickname by votes unless the player was rejected for it', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const slug = 'shared-votes-fc';
            const isDouble = (index: number): boolean => index % 3 === 0;
            const voters = (index: number): number[] =>
                isDouble(index) ? [ids.striker, ids.other] : [index % 2 === 0 ? ids.striker : ids.other];
            const squads = messages.map(item =>
                item.id % 10 === 2
                    ? message(
                          item.id,
                          `2025-05-${dayOf((item.id - 2) / 10)}T12:00:00Z`,
                          `Составы на сегодня, North:\n🟢Я, Вихрь\n🔵Олег${isDouble((item.id - 2) / 10) ? ', Вихрь' : ''}`,
                          { authorId: ids.org }
                      )
                    : item
            );
            const content = yield* snapshotOf(slug);
            const votes = Array.from({ length: games }, (_, index) =>
                voters(index).map(userId => ({
                    pollId: pollIdIn(slug, index),
                    userId,
                    choice: 'yes' as const,
                    votedAt: new Date('2025-05-01T09:00:00Z')
                }))
            ).flat();
            const run = importMessages({
                config: { ...testConfig, slug },
                messages: squads,
                fileSha256: 'sha',
                snapshot: Option.fromNullishOr({ ...content, votes }),
                allowRemoval: true
            });
            const linked = yield* run;
            const [alias] = yield* db.select().from(personAlias).where(eq(personAlias.aliasNorm, 'вихрь'));
            yield* db.insert(aliasLink).values({
                communityId: alias?.communityId ?? '',
                aliasId: alias?.id ?? '',
                personId: yield* accountPerson(ids.other),
                during: '[2025-05-30,2025-06-01)',
                method: 'admin',
                status: 'rejected'
            });
            const outside = yield* run;
            yield* db
                .update(aliasLink)
                .set({ during: '[2025-05-04,2025-05-05)' })
                .where(and(eq(aliasLink.aliasId, alias?.id ?? ''), eq(aliasLink.status, 'rejected')));
            const rejected = yield* run;

            expect(linked.sharedEntries).toBe(15);
            expect(outside.sharedEntries).toBe(15);
            expect(rejected.sharedEntries).toBe(0);
        })
    );

    it.effect('stores reserve and other polls without turning their votes into participation', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const slug = 'poll-kinds-fc';
            const content = yield* snapshotOf(slug);
            const posts = [
                message(970, '2025-05-02T09:00:00Z', '', {
                    text: undefined,
                    poll: { question: 'Сегодня, 19.00 North, резерв', answers: ['+', '-'] }
                }),
                message(971, '2025-05-02T09:30:00Z', '', {
                    text: undefined,
                    poll: { question: 'За кого болеем?', answers: ['За красных', 'За синих'] }
                })
            ];
            const extra = [970, 971].map(id => ({
                pollId: `kind-${id}`,
                userId: ids.other,
                choice: 'yes' as const,
                votedAt: new Date('2025-05-02T10:00:00Z')
            }));
            yield* importMessages({
                config: { ...testConfig, slug },
                messages: [...messages, ...posts],
                fileSha256: 'sha',
                snapshot: Option.fromNullishOr({
                    ...content,
                    pollIdByMessage: new Map([...content.pollIdByMessage, [970, 'kind-970'], [971, 'kind-971']]),
                    votes: [...content.votes, ...extra]
                }),
                allowRemoval: true
            });
            const stored = yield* db
                .select({
                    pollId: importedPoll.pollId,
                    kind: importedPoll.kind,
                    gameOn: session.localDate,
                    votedFor: pollVote.sessionId
                })
                .from(importedPoll)
                .innerJoin(pollVote, eq(pollVote.pollId, importedPoll.pollId))
                .leftJoin(session, eq(session.id, importedPoll.sessionId))
                .where(inArray(importedPoll.pollId, ['kind-970', 'kind-971']))
                .orderBy(asc(importedPoll.pollId));

            expect(stored).toEqual([
                { pollId: 'kind-970', kind: 'reserve', gameOn: '2025-05-02', votedFor: null },
                { pollId: 'kind-971', kind: 'other', gameOn: null, votedFor: null }
            ]);
        })
    );

    it.effect('does not let an unreadable answer hide a yes vote from the evidence', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, entries } = yield* load('readable-fc');
            const striker = yield* accountPerson(ids.striker);
            const sessionId = entries.find(({ localDate }) => localDate === '2025-05-04')?.entry.sessionId ?? '';
            yield* db.insert(pollVote).values({
                pollId: 'readable-later',
                tgUserId: BigInt(ids.striker),
                sessionId,
                choice: 'other',
                votedAt: new Date('2025-06-01T09:00:00Z')
            });
            const { squads } = yield* loadEvidence(communityId);

            expect(squads.find(squad => squad.sessionId === sessionId)?.yes?.has(striker)).toBe(true);
        })
    );

    it.effect('prefers the narrowest approval, changes only what differs and names a player once per game', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const slug = 'narrow-fc';
            const first = yield* load(slug);
            const striker = yield* accountPerson(ids.striker);
            const other = yield* accountPerson(ids.other);
            const row = { communityId: first.communityId, method: 'owner_list' as const, status: 'approved' as const };
            const aliasId = (norm: string) => first.alias(norm)?.id ?? '';
            yield* db.insert(aliasLink).values([
                { ...row, aliasId: aliasId('гонзо'), personId: other, during: '[2025-05-02,2025-05-03)' },
                { ...row, aliasId: aliasId('гонзо'), personId: striker, during: '(,)' },
                { ...row, aliasId: aliasId('семен'), personId: other, during: '(,)' },
                { ...row, aliasId: aliasId('олег'), personId: striker, during: '[2025-05-03,2025-05-04)' }
            ]);
            const namesOn = (date: string) =>
                namedOn(first.communityId, date, [striker, other]).pipe(
                    Effect.map(rows =>
                        rows.map(({ raw, personId, resolvedBy }) => [raw, personId === striker ? 'striker' : 'other', resolvedBy])
                    )
                );
            const before = yield* namesOn('2025-05-03');
            const changed = yield* applyApproved(first.communityId);
            const attended = yield* db
                .select()
                .from(attendance)
                .innerJoin(session, eq(session.id, attendance.sessionId))
                .where(and(eq(session.communityId, first.communityId), eq(attendance.personId, striker)));
            const again = yield* applyApproved(first.communityId);
            const pinned = yield* Effect.all([namesOn('2025-05-01'), namesOn('2025-05-02'), namesOn('2025-05-03')]);
            yield* load(slug);
            const imported = yield* Effect.all([namesOn('2025-05-01'), namesOn('2025-05-02'), namesOn('2025-05-03')]);

            expect(before).toEqual([['Гонзо', 'striker', 'vote']]);
            expect(pinned).toEqual([[['Гонзо', 'striker', 'alias']], [['Гонзо', 'other', 'alias']], [['Олег', 'striker', 'alias']]]);
            expect(imported).toEqual(pinned);
            expect(changed).toBeGreaterThan(0);
            expect(again).toBe(0);
            expect(attended).toHaveLength(10);
        })
    );

    it.effect('keeps account entries ahead of an approval for the same player', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const slug = 'ahead-fc';
            const mentioned = messages.map(item => (item.id === 12 ? { ...item, text: `${item.text}, @Striker` } : item));
            const first = yield* load(slug, mentioned);
            const striker = yield* accountPerson(ids.striker);
            const other = yield* accountPerson(ids.other);
            const row = {
                communityId: first.communityId,
                aliasId: first.alias('семен')?.id ?? '',
                method: 'owner_list' as const,
                status: 'approved' as const
            };
            yield* db.insert(aliasLink).values([
                { ...row, personId: striker, during: '[2025-05-02,2025-05-03)' },
                { ...row, personId: other, during: '(,)' }
            ]);
            yield* applyApproved(first.communityId);
            const listed = yield* namedOn(first.communityId, '2025-05-02', [striker, other]);

            expect(listed).toEqual([{ raw: '@Striker', personId: striker, resolvedBy: 'handle' }]);
        })
    );

    it.effect('lets an approval of the owner replace the rejection of that day and reports other players on it', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const slug = 'replace-fc';
            const first = yield* load(slug);
            const striker = yield* accountPerson(ids.striker);
            const other = yield* accountPerson(ids.other);
            const aliasId = first.alias('гонзо')?.id ?? '';
            const row = { communityId: first.communityId, aliasId, method: 'admin' as const };
            yield* db.insert(aliasLink).values([
                { ...row, personId: striker, during: '(,)', status: 'rejected' },
                { ...row, personId: other, during: '[2025-05-01,2025-05-03)', status: 'approved' }
            ]);
            const rows = yield* parseApprovals(
                [`Гонзо|${ids.striker}|22|2025-05-03`, `Гонзо|${ids.striker}|12|2025-05-02`].join('\n'),
                testConfig
            );
            const decidedAt = new Date('2026-11-24T00:00:00Z');
            const loaded = yield* loadApprovals({ slug, rows, decidedAt });
            const again = yield* loadApprovals({ slug, rows, decidedAt });
            const links = yield* db
                .select(linkColumns)
                .from(aliasLink)
                .where(and(eq(aliasLink.aliasId, aliasId), eq(aliasLink.personId, striker)))
                .orderBy(aliasLink.during);

            expect(links.map(({ status, during }) => [status, during])).toEqual([
                ['rejected', '(,2025-05-02)'],
                ['approved', '[2025-05-02,2025-05-03)'],
                ['approved', '[2025-05-03,2025-05-04)'],
                ['rejected', '[2025-05-04,)']
            ]);
            expect(loaded).toMatchObject({ stored: 2, overlapDates: ['2025-05-02'] });
            expect(again).toMatchObject({ stored: 0, overlapDates: ['2025-05-02'] });
        })
    );

    it.effect('refuses to lose many stored squads without a flag and names their dates', () =>
        Effect.gen(function* () {
            const slug = 'lost-squads-fc';
            const first = yield* load(slug, messages);
            const withoutSquads = messages.filter(({ id }) => id % 10 === 1);
            const refused = yield* Effect.flip(load(slug, withoutSquads, false));
            const kept = yield* load(slug, messages, false);
            const allowed = yield* load(slug, withoutSquads, true);
            const fewerGames = yield* Effect.flip(load(slug, withoutSquads.slice(0, 10), false));

            expect(refused).toMatchObject({ _tag: 'TooManyRemovedGamesError' });
            const squadDates = first.entries.filter(({ entry }) => entry.teamOrdinal > 0).map(({ localDate }) => localDate);
            expect(refused).toHaveProperty('dates', [...new Set(squadDates)]);
            expect(String(refused)).toContain('2025-05-01, 2025-05-02');
            expect(kept.entries.length).toBe(first.entries.length);
            expect(allowed.entries).toEqual([]);
            expect(fewerGames).toHaveProperty('dates', ['2025-05-11', '2025-05-12']);
        })
    );

    it.effect('adds no second game beside a decided one, also a game of the bot', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const slug = 'beside-fc';
            yield* db.insert(community).values({ slug, name: slug });
            const [home] = yield* db.select().from(community).where(eq(community.slug, slug));
            const communityId = home?.id ?? '';
            const [football] = yield* db.insert(activity).values({ communityId, sport: 'football', name: 'football' }).returning();
            const gameOn = {
                communityId,
                activityId: football?.id ?? '',
                startsAt: new Date('2025-05-02T17:00:00Z'),
                source: 'bot' as const
            };
            const [botGame, , single, ...twins] = yield* db
                .insert(session)
                .values([
                    { ...gameOn, localDate: '2025-05-02', status: 'cancelled' },
                    { ...gameOn, localDate: '2025-05-02', status: 'cancelled', source: 'import' },
                    { ...gameOn, localDate: '2025-05-03', status: 'played' },
                    { ...gameOn, localDate: '2025-05-04', status: 'played' },
                    { ...gameOn, localDate: '2025-05-04', status: 'played' }
                ])
                .returning();
            const person1 = yield* db.insert(person).values({ displayName: 'Came' }).returning();
            const came = {
                sessionId: single?.id ?? '',
                personId: person1[0]?.id ?? '',
                outcome: 'attended' as const,
                source: 'bot' as const
            };
            yield* db.insert(attendance).values(came);
            const decidedAt = new Date('2026-11-24T00:00:00Z');
            yield* db.insert(sessionChange).values({ sessionId: botGame?.id ?? '', at: decidedAt, diff: { decision: 'cancelled' } });
            const decisions = yield* parseGameDecisions('2025-05-03|football|played\n2025-05-04|football|played');
            const loaded = yield* loadGameDecisions({ slug, decisions, decidedAt });
            const stillThere = yield* db.select().from(attendance).where(eq(attendance.sessionId, came.sessionId));
            const { stats } = yield* load(slug);
            yield* db.insert(sessionChange).values(twins.map(({ id }) => ({ sessionId: id, at: decidedAt, diff: { decision: 'played' } })));
            const reported = yield* load(slug);
            const stored = yield* db
                .select({ id: session.id, localDate: session.localDate, status: session.status })
                .from(session)
                .where(and(eq(session.communityId, communityId), inArray(session.localDate, ['2025-05-02', '2025-05-03'])))
                .orderBy(session.localDate);

            expect(loaded).toEqual({ decisions: 2, changed: 1, missing: [], ambiguous: ['2025-05-04|football'] });
            expect(stillThere).toHaveLength(1);
            expect(stats.ambiguousDates).toEqual([]);
            expect(reported.stats.ambiguousDates).toEqual(['2025-05-04']);
            expect(stored).toEqual([
                { id: botGame?.id, localDate: '2025-05-02', status: 'cancelled' },
                { id: single?.id, localDate: '2025-05-03', status: 'played' }
            ]);
        })
    );

    it.effect('keeps the attendance of a game whose only entries are guests from chat', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const slug = 'chat-guest-fc';
            const squadless = messages.filter(item => item.id !== 12);
            const first = yield* load(slug, squadless);
            const striker = yield* accountPerson(ids.striker);
            const [game] = yield* db
                .select()
                .from(session)
                .where(and(eq(session.communityId, first.communityId), eq(session.localDate, '2025-05-02')));
            const sessionId = game?.id ?? '';
            yield* db.insert(lineupEntry).values({
                sessionId,
                messageId: 5,
                teamOrdinal: 0,
                position: 1,
                resolvedBy: 'guest',
                isGuest: true,
                guestOfPersonId: striker
            });
            yield* db.insert(attendance).values({ sessionId, personId: striker, outcome: 'attended', source: 'bot' });
            yield* load(slug, squadless);
            const kept = yield* db.select().from(attendance).where(eq(attendance.sessionId, sessionId));

            expect(kept).toMatchObject([{ personId: striker, source: 'bot' }]);
        })
    );

    it.effect('never takes over polls of another community', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const first = yield* load('polls-home-fc');
            const before = yield* db.select().from(importedPoll).where(eq(importedPoll.communityId, first.communityId));
            const content = yield* snapshotOf('polls-home-fc');
            const run = (slug: string) =>
                importMessages({
                    config: { ...testConfig, slug },
                    messages,
                    fileSha256: 'sha',
                    snapshot: Option.fromNullishOr(content),
                    allowRemoval: true
                });
            const refused = yield* Effect.flip(run('polls-away-fc'));
            const ofHome = inArray(
                pollVote.pollId,
                before.map(poll => poll.pollId)
            );
            const votes = yield* db.delete(pollVote).where(ofHome).returning();
            const pollsOnly = yield* Effect.flip(run('polls-away-fc'));
            yield* db.insert(pollVote).values(votes);
            yield* db.delete(importedPoll).where(eq(importedPoll.communityId, first.communityId));
            const votesOnly = yield* Effect.flip(run('polls-away-fc'));
            const kept = yield* db.select().from(pollVote).where(ofHome);

            yield* db.delete(pollVote).where(ofHome);
            const [game] = yield* db.select().from(session).where(eq(session.communityId, first.communityId));
            yield* db.insert(telegramPoll).values({
                pollId: pollIdIn('polls-home-fc', 0),
                chatId: -1n,
                messageId: 1,
                sessionId: game?.id ?? '',
                options: ['in', 'out']
            });
            const botPoll = yield* Effect.flip(run('polls-away-fc'));

            expect(botPoll).toMatchObject({ _tag: 'ForeignPollError' });
            expect(refused).toMatchObject({ _tag: 'ForeignPollError' });
            expect(refused).toHaveProperty('pollIds.length', games);
            expect(String(refused)).toContain(pollIdIn('polls-home-fc', 0));
            expect(votesOnly).toMatchObject({ _tag: 'ForeignPollError' });
            expect(pollsOnly).toMatchObject({ _tag: 'ForeignPollError' });
            expect(votes.length).toBeGreaterThan(0);
            expect(kept).toHaveLength(votes.length);
        })
    );
});
