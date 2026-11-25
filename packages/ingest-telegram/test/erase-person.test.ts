import { expect, layer } from '@effect/vitest';
import { refreshNames } from '@rondo/core/identity/refresh-names';
import { personIdOfTelegramUser, syncMember, upsertTelegramUser } from '@rondo/core/identity/telegram-user';
import { ingestGroupMessage } from '@rondo/core/live/live-ingest';
import { linkAlias, linkEntry } from '@rondo/core/people/alias-links.service';
import { erasePerson, previewErasure } from '@rondo/core/people/erase-person';
import { mergePeople, renamePerson } from '@rondo/core/people/people.service';
import { addGuests } from '@rondo/core/signups/roster.service';
import { setHomeColour } from '@rondo/core/teams/team.service';
import { recordedTelegramDbLayer } from '@rondo/core/testing/recorded-telegram.layer';
import { seedCommunity, seedConfig } from '@rondo/core/testing/seed-community';
import { seedGame } from '@rondo/core/testing/seed-game';
import { person, personAlias, telegramAccount, telegramAuthor } from '@rondo/db/schema/identity.schema';
import { community } from '@rondo/db/schema/org.schema';
import { adminState, auditLog, pendingAction, pollVote } from '@rondo/db/schema/platform.schema';
import { homeColour, lineupDelivery, lineupEntry } from '@rondo/db/schema/play.schema';
import { attendance, session, signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { loadApprovals } from '../src/approvals/load-approvals';
import { importMessages } from '../src/ingest.effect';

import type { TelegramMessage } from '@rondo/core/model/telegram-message.model';

const goneId = 7_700_001;
const otherId = 7_700_002;
const days = Array.from({ length: 12 }, (_, index) => `2025-05-${String(index + 1).padStart(2, '0')}`);
const secrets = ['Зорро', 'zorro', 'Секрет', 'Дон Диего'];

const messagesOf = (author: { readonly author: string; readonly authorId?: number }) =>
    days.flatMap((day, index): TelegramMessage[] => {
        const base = { kind: 'message' as const, media: [], author: 'Org' };

        return [
            {
                ...base,
                id: index * 10 + 1,
                sentAt: new Date(`${day}T08:00:00Z`),
                poll: { question: 'Сегодня футбол 19.00 North', answers: ['+', '-'] }
            },
            {
                ...base,
                id: index * 10 + 2,
                sentAt: new Date(`${day}T12:00:00Z`),
                text: `Составы на сегодня, North:\n🟢${index === 11 ? '@zorro_tg' : 'Зорро'}, Олег${index}, Шурик${index === 0 ? ', Зорро +1' : ''}\n🔵Семён${index}${index === 1 ? ', Друг Зорро' : ''}`
            },
            { ...base, id: index * 10 + 3, sentAt: new Date(`${day}T13:00:00Z`), ...author, text: 'ок' }
        ];
    });

const knownAuthor = { author: 'Секрет Дон Диего', authorId: goneId };

const importAll = (slug: string, author: Parameters<typeof messagesOf>[0] = knownAuthor) =>
    importMessages({
        config: seedConfig(slug),
        messages: messagesOf(author),
        fileSha256: 'sha',
        allowRemoval: true,
        snapshot: Option.some({
            users: new Map(
                [
                    { id: goneId, first: 'Секрет', last: 'Дон Диего', username: 'zorro_tg' },
                    { id: otherId, first: 'Other', last: null, username: null }
                ].map(user => [user.id, { ...user, bot: false, deleted: false, member: true }])
            ),
            pollIdByMessage: new Map(days.map((_, index) => [index * 10 + 1, `${slug}-${index}`])),
            votes: days.map((_, index) => ({
                pollId: `${slug}-${index}`,
                userId: goneId,
                choice: 'yes' as const,
                votedAt: new Date('2025-05-01T09:00:00Z')
            }))
        })
    });

// Every text of every table, so a place nobody thought of fails the test
const leaks = Effect.gen(function* () {
    const db = yield* Db;
    const { rows: tables } = yield* db.execute<{ readonly name: string }>(sql`
        select format('%I.%I', table_schema, table_name) as name from information_schema.tables
        where table_type = 'BASE TABLE' and table_schema not in ('pg_catalog', 'information_schema')
    `);
    const found: string[] = [];

    for (const { name } of tables) {
        for (const secret of secrets) {
            const { rows } = yield* db.execute(
                sql`select 1 from ${sql.raw(name)} stored where stored::text ilike ${`%${secret}%`} limit 1`
            );
            found.push(...rows.map(() => `${name} ${secret}`));
        }
    }

    return found;
});

const countsOf = Effect.fn('test.countsOf')(function* (communityId: string, personId: string) {
    const db = yield* Db;
    const ofPerson = yield* db
        .select({ sessionId: attendance.sessionId })
        .from(attendance)
        .innerJoin(session, eq(session.id, attendance.sessionId))
        .where(and(eq(session.communityId, communityId), eq(attendance.personId, personId)));
    const all = yield* db
        .select({ guest: lineupEntry.isGuest, host: lineupEntry.guestOfPersonId })
        .from(lineupEntry)
        .innerJoin(session, eq(session.id, lineupEntry.sessionId))
        .where(eq(session.communityId, communityId));

    return {
        games: yield* db.$count(session, eq(session.communityId, communityId)),
        attended: ofPerson.length,
        votes: yield* db.$count(pollVote, eq(pollVote.tgUserId, BigInt(goneId))),
        entries: all.length,
        guests: all.filter(({ guest, host }) => guest && host === personId).length
    };
});

const rawsOf = (communityId: string) =>
    Effect.gen(function* () {
        const db = yield* Db;
        return yield* db
            .select({ date: session.localDate, raw: lineupEntry.raw })
            .from(lineupEntry)
            .innerJoin(session, eq(session.id, lineupEntry.sessionId))
            .where(and(eq(session.communityId, communityId), ne(session.localDate, '2025-05-12')))
            .orderBy(session.localDate, lineupEntry.teamOrdinal, lineupEntry.position);
    });

const prepare = Effect.fn('test.prepare')(function* (slug: string) {
    const db = yield* Db;
    yield* importAll(slug);
    const [home] = yield* db.select({ id: community.id }).from(community).where(eq(community.slug, slug));
    const communityId = home?.id ?? '';
    const personId = (yield* personIdOfTelegramUser(BigInt(goneId))) ?? '';
    const [alias] = yield* db
        .select()
        .from(personAlias)
        .where(and(eq(personAlias.communityId, communityId), eq(personAlias.aliasNorm, 'зорро')));
    yield* linkAlias({ communityId, aliasId: alias?.id ?? '', personId, actorPersonId: null });
    yield* importAll(slug);
    const [shared] = yield* db
        .select({ id: lineupEntry.id })
        .from(lineupEntry)
        .innerJoin(session, eq(session.id, lineupEntry.sessionId))
        .where(and(eq(session.communityId, communityId), eq(lineupEntry.raw, '@zorro_tg')));
    expect(shared).toBeDefined();
    const [game] = yield* db.select({ id: session.id }).from(session).where(eq(session.communityId, communityId));
    yield* db.insert(lineupDelivery).values({ sessionId: game?.id ?? '', chatId: -1n, text: '<a>Ян</a>, <a>D&amp;G</a>', status: 'sent' });
    yield* db.insert(person).values({ displayName: 'Дон Диего', mergedIntoPersonId: personId });
    const expiresAt = new Date('2030-01-01T00:00:00Z');
    const action = { communityId, requestedByTgUserId: 5n, kind: 'rename_person', expiresAt };
    yield* db.insert(pendingAction).values([
        { ...action, payload: { name: 'Зорро' }, summary: 'rename Зорро' },
        { ...action, payload: { name: 'keep' }, summary: 'rename Other' }
    ]);
    yield* db
        .insert(adminState)
        .values({ tgUserId: 5n, communityId, draft: { note: 'zorro_tg' }, expiresAt })
        .onConflictDoNothing();

    return { communityId, personId };
});

layer(recordedTelegramDbLayer, { timeout: 60_000 })('erasing a person', it => {
    it.effect('scrubs every stored name, keeps the counts, and neither an import nor the group brings them back', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const slug = 'erase-fc';
            const { communityId, personId } = yield* prepare(slug);
            const before = yield* countsOf(communityId, personId);
            expect(before).toMatchObject({ games: 12, attended: 12, votes: 12, guests: 2 });

            const leaked = yield* leaks;
            const preview = yield* previewErasure({ communityId, personId });
            expect(yield* leaks).toEqual(leaked);
            const erased = yield* erasePerson({ communityId, personId });

            expect(preview).toEqual(erased);
            expect(erased).toEqual({
                people: 2,
                accounts: 1,
                nicknames: 2,
                authors: 1,
                pendingActions: 1,
                adminStates: 1,
                assistantMessages: 0
            });
            expect(yield* leaks).toEqual([]);
            // A short or escaped name is in no search text: every posted text of the community goes
            expect(yield* db.select({ text: lineupDelivery.text }).from(lineupDelivery).where(isNotNull(lineupDelivery.text))).toEqual([]);
            expect(yield* countsOf(communityId, personId)).toEqual(before);
            expect(
                yield* db
                    .select({ summary: pendingAction.summary, status: pendingAction.status })
                    .from(pendingAction)
                    .orderBy(pendingAction.summary)
            ).toEqual([
                { summary: '', status: 'rejected' },
                { summary: 'rename Other', status: 'proposed' }
            ]);
            const [audited] = yield* db.select().from(auditLog).where(eq(auditLog.action, 'person.erase'));
            expect(audited).toMatchObject({ entityId: personId, diff: erased });

            const raws = yield* rawsOf(communityId);
            yield* importAll(slug, { author: 'Секрет Дон Диего' });
            expect(yield* rawsOf(communityId)).toEqual(raws);
            yield* db
                .insert(telegramAuthor)
                .values({ communityId, displayName: 'Секрет', firstSeenAt: new Date(0), lastSeenAt: new Date(0) });
            yield* importAll(slug, { author: 'Секрет', authorId: goneId });
            yield* loadApprovals({
                slug,
                rows: [{ nickname: 'Зорро', aliasNorm: 'зорро', tgUserId: BigInt(goneId), messageId: 2, date: '2025-05-01' }],
                decidedAt: new Date('2026-11-24T00:00:00Z')
            });
            yield* importAll(slug);
            expect(yield* leaks).toEqual([]);
            expect(yield* countsOf(communityId, personId)).toEqual(before);

            const sender = { id: BigInt(goneId), firstName: 'Секрет', lastName: 'Дон Диего', username: 'zorro_tg' };
            expect(yield* upsertTelegramUser(sender)).toBe(personId);
            const post = {
                chatId: -100n,
                sentAt: new Date('2025-05-20T12:00:00Z'),
                senderPersonId: personId,
                senderTgUserId: sender.id,
                senderName: 'Секрет Дон Диего',
                isTrusted: true
            };
            yield* ingestGroupMessage(communityId, seedConfig(slug), {
                isMain: true,
                ...post,
                messageId: 900,
                text: 'Составы на сегодня, North:\n🟢Зорро, Олег\n🔵Семён, Павел'
            });
            expect(yield* leaks).toEqual([]);
            expect(yield* countsOf(communityId, personId)).toMatchObject({ games: 13, attended: 13 });
        })
    );

    it.effect('keeps a nickname of another player and that player, and scrubs only the entries of the erased one', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const slug = 'erase-shared-fc';
            yield* importAll(slug);
            const [home] = yield* db.select({ id: community.id }).from(community).where(eq(community.slug, slug));
            const communityId = home?.id ?? '';
            const personId = yield* syncMember(communityId, { id: 991n, firstName: 'Gone' }, 'active');
            const otherPersonId = yield* syncMember(communityId, { id: 992n, firstName: 'Stays' }, 'active');
            const [alias] = yield* db
                .select()
                .from(personAlias)
                .where(and(eq(personAlias.communityId, communityId), eq(personAlias.aliasNorm, 'шурик')));
            const [first] = yield* db
                .select({ id: lineupEntry.id })
                .from(lineupEntry)
                .innerJoin(session, eq(session.id, lineupEntry.sessionId))
                .where(and(eq(lineupEntry.aliasId, alias?.id ?? ''), eq(session.localDate, '2025-05-01')));
            yield* linkAlias({ communityId, aliasId: alias?.id ?? '', personId: otherPersonId, actorPersonId: null });
            yield* linkEntry({ communityId, entryId: first?.id ?? '', personId, actorPersonId: null });
            const entries = db
                .select({ date: session.localDate, raw: lineupEntry.raw, personId: lineupEntry.personId })
                .from(lineupEntry)
                .innerJoin(session, eq(session.id, lineupEntry.sessionId))
                .where(eq(lineupEntry.aliasId, alias?.id ?? ''))
                .orderBy(session.localDate);

            const absentId = yield* syncMember(communityId, { id: 994n, firstName: 'Absent' }, 'active');
            yield* db.insert(personAlias).values({ communityId, personId: absentId, alias: 'Unused', aliasNorm: 'unused' });
            yield* erasePerson({ communityId, personId: absentId });
            yield* erasePerson({ communityId, personId });
            const after = yield* entries;
            yield* importAll(slug);

            expect(
                yield* db.$count(personAlias, and(eq(personAlias.communityId, communityId), eq(personAlias.alias, 'Former player')))
            ).toBe(1);
            expect(after[0]).toEqual({ date: '2025-05-01', raw: null, personId });
            expect(after.slice(1).every(entry => entry.raw === 'Шурик' && entry.personId === otherPersonId)).toBe(true);
            expect(yield* entries).toEqual(after);
            yield* refreshNames([personId]);
            const [renamed] = yield* db.select().from(person).where(eq(person.id, personId));
            expect(renamed?.displayName).toBe('Former player');
            const [kept] = yield* db.select().from(person).where(eq(person.id, otherPersonId));
            const [account] = yield* db.select().from(telegramAccount).where(eq(telegramAccount.tgUserId, 991n));
            expect(kept?.displayName).toBe('Шурик');
            expect(account).toMatchObject({ personId, firstName: 'Former player', username: null });
        })
    );

    it.effect('refuses to rename or merge an erased person and leaves other people alone', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedCommunity(seedConfig('erase-rename-fc'));
            const personId = yield* syncMember(communityId, { id: 981n, firstName: 'Erased' }, 'active');
            const neighbourId = yield* syncMember(communityId, { id: 982n, firstName: 'Kept' }, 'active');
            yield* setHomeColour({ communityId, personId, colour: 'red', actorPersonId: null });
            yield* setHomeColour({ communityId, personId: neighbourId, colour: 'green', actorPersonId: null });
            yield* erasePerson({ communityId, personId });
            yield* setHomeColour({ communityId, personId, colour: 'blue', actorPersonId: null });
            const colours = yield* db
                .select({ personId: homeColour.personId })
                .from(homeColour)
                .where(inArray(homeColour.personId, [personId, neighbourId]));
            const rename = (id: string) => renamePerson({ communityId, personId: id, displayName: 'Again', actorPersonId: null });
            const refused = { failure: { code: 'person_not_found' } };

            expect(colours).toEqual([{ personId: neighbourId }]);
            expect(yield* Effect.flip(rename(personId))).toMatchObject(refused);
            for (const [fromPersonId, intoPersonId] of [
                [personId, neighbourId],
                [neighbourId, personId]
            ] as const) {
                expect(yield* Effect.flip(mergePeople({ communityId, fromPersonId, intoPersonId, actorPersonId: null }))).toMatchObject(
                    refused
                );
            }
            yield* rename(neighbourId);

            const people = yield* db
                .select({ id: person.id, displayName: person.displayName })
                .from(person)
                .where(inArray(person.id, [personId, neighbourId]));
            expect(new Map(people.map(row => [row.id, row.displayName]))).toEqual(
                new Map([
                    [personId, 'Former player'],
                    [neighbourId, 'Again']
                ])
            );
            expect(yield* db.$count(auditLog, and(eq(auditLog.action, 'person.rename'), eq(auditLog.entityId, personId)))).toBe(0);
        })
    );

    it.effect('unites the author rows of two erased people with one name', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedCommunity(seedConfig('erase-authors-fc'));

            for (const [id, seen] of [
                [971n, '2025-01-02'],
                [972n, '2025-01-01']
            ] as const) {
                const personId = yield* syncMember(communityId, { id, firstName: 'Same Author' }, 'active');
                yield* db.insert(telegramAuthor).values({
                    communityId,
                    displayName: 'Same Author',
                    tgUserId: id,
                    personId,
                    messageCount: 2,
                    firstSeenAt: new Date(seen),
                    lastSeenAt: new Date(seen)
                });
                yield* erasePerson({ communityId, personId });
            }

            const authors = yield* db.select().from(telegramAuthor).where(eq(telegramAuthor.communityId, communityId));
            expect(authors).toHaveLength(1);
            expect(authors[0]).toMatchObject({
                tgUserId: null,
                personId: null,
                messageCount: 4,
                firstSeenAt: new Date('2025-01-01'),
                lastSeenAt: new Date('2025-01-02')
            });
            expect(authors[0]?.displayName).toMatch(/^erased /u);
        })
    );

    it.effect('scrubs the guests that carry the name of their host, and keeps typed names and other guests', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, sessionId } = yield* seedGame('erase-guests-fc');
            const personId = yield* syncMember(communityId, { id: 961n, firstName: 'Hostess' }, 'active');
            const neighbourId = yield* syncMember(communityId, { id: 962n, firstName: 'Neighbour' }, 'active');
            yield* db.insert(signup).values([personId, neighbourId].map(id => ({ sessionId, personId: id, status: 'in' as const })));
            const change = { communityId, sessionId, actorPersonId: null };
            yield* addGuests(change, { hostPersonId: personId, count: 1, name: null });
            yield* renamePerson({ communityId, personId, displayName: 'Interim', actorPersonId: null });
            yield* addGuests(change, { hostPersonId: personId, count: 1, name: null });
            yield* renamePerson({ communityId, personId, displayName: 'Renamed', actorPersonId: null });
            yield* addGuests(change, { hostPersonId: personId, count: 1, name: 'Typed' });
            yield* addGuests(change, { hostPersonId: neighbourId, count: 1, name: null });
            yield* db.insert(pendingAction).values({
                communityId,
                requestedByTgUserId: 5n,
                kind: 'x',
                payload: {},
                summary: 'remove Interim +2',
                expiresAt: new Date('2030-01-01T00:00:00Z')
            });

            yield* erasePerson({ communityId, personId });

            const guests = yield* db
                .select({ name: person.displayName })
                .from(signup)
                .innerJoin(person, eq(person.id, signup.personId))
                .where(and(eq(signup.sessionId, sessionId), eq(signup.isGuest, true)));
            const actions = yield* db.select().from(pendingAction).where(eq(pendingAction.communityId, communityId));
            expect(guests.map(({ name }) => name).toSorted()).toEqual(['Former player +1', 'Former player +2', 'Neighbour +1', 'Typed']);
            expect(actions.map(({ summary }) => summary)).toEqual(['']);
        })
    );

    it.effect('refuses a person of another community', () =>
        Effect.gen(function* () {
            const { communityId } = yield* seedCommunity(seedConfig('erase-other-fc'));
            const personId = yield* upsertTelegramUser({ id: 993n, firstName: 'Nobody' });
            const failure = yield* Effect.flip(erasePerson({ communityId, personId }));

            expect(failure).toMatchObject({ _tag: 'ActionFailedError' });
        })
    );
});
