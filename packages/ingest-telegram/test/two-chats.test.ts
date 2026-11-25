import { expect, layer } from '@effect/vitest';
import { isDefined } from '@rnw-community/shared';
import { aliasLink, personAlias } from '@rondo/db/schema/identity.schema';
import { community, telegramChat } from '@rondo/db/schema/org.schema';
import { importedPoll, messageRef, pollVote, sourceRef } from '@rondo/db/schema/platform.schema';
import { lineupEntry } from '@rondo/db/schema/play.schema';
import { attendance, session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { testDbLayer } from '@rondo/db/testing/test-db.layer';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Option from 'effect/Option';

import { compareApprovals, loadApprovals } from '../src/approvals/load-approvals';
import { parseApprovals } from '../src/approvals/parse-approvals';
import { importMessages } from '../src/ingest.effect';

import { accountPerson, message, testConfig } from './fixture';

import type { TelegramSnapshot } from '../src/model/telegram-snapshot.model';

type Message = ReturnType<typeof message>;

const ids = { org: 41, striker: 42, other: 43, late: 44 };
const secondChat = -1009;
const mondays = ['2025-05-05', '2025-05-12', '2025-05-19', '2025-05-26'];
const wednesdays = ['2025-05-07', '2025-05-14', '2025-05-21'];
const decidedAt = new Date('2026-11-24T00:00:00Z');

const pollOn = (id: number, date: string) =>
    message(id, `${date}T08:00:00Z`, '', {
        text: undefined,
        authorId: ids.org,
        poll: { question: 'Сегодня, 19.00 North', answers: ['+', '-'] }
    });
const squadOn = (id: number, date: string, names: string) =>
    message(id, `${date}T12:00:00Z`, `Составы на сегодня:\n🟢Я, Гонзо\n🔵${names}`, { authorId: ids.org });
const postsOn = (dates: readonly string[], names: string): Message[] =>
    dates.flatMap((date, index) => [pollOn(index * 10 + 1, date), squadOn(index * 10 + 2, date, names)]);

const userOf = (id: number) => ({ id, first: `U${id}`, last: '', username: null, bot: false, deleted: false, member: true });

const snapshotOf = (
    prefix: string,
    pollIds: ReadonlyMap<number, string>,
    votersOf: (index: number) => readonly number[]
): TelegramSnapshot => ({
    users: new Map(Object.values(ids).map(id => [id, userOf(id)])),
    pollIdByMessage: pollIds,
    votes: [...pollIds.values()]
        .filter(pollId => pollId.startsWith(prefix))
        .flatMap((pollId, index) =>
            votersOf(index).map(userId => ({ pollId, userId, choice: 'yes' as const, votedAt: new Date('2025-05-01T09:00:00Z') }))
        )
});

const pollIdsOf = (prefix: string, dates: readonly string[]) => new Map(dates.map((_, index) => [index * 10 + 1, `${prefix}-${index}`]));

interface Second {
    readonly messages: readonly Message[];
    readonly pollIds: ReadonlyMap<number, string>;
    readonly votersOf?: (index: number) => readonly number[];
}

const load = Effect.fn('test.load')(function* (slug: string, second?: Second, main: readonly Message[] = postsOn(mondays, 'Олег, Семён')) {
    const db = yield* Db;
    const config = {
        ...testConfig,
        slug,
        ...(isDefined(second) ? { otherChats: [{ chatId: secondChat, exportDir: 'second', matchPatterns: ['cup'] }] } : {})
    };
    const mainPollIds = new Map(main.filter(({ poll }) => isDefined(poll)).map(({ id }) => [id, `${slug}-m-${(id - 1) / 10}`]));
    const stats = yield* importMessages({
        config,
        messages: main.map(post => ({ ...post })),
        fileSha256: 'sha',
        snapshot: Option.fromNullishOr(
            snapshotOf(`${slug}-m`, mainPollIds, index => (index % 2 === 0 ? [ids.org, ids.striker] : [ids.striker]))
        ),
        allowRemoval: true,
        otherChats: isDefined(second)
            ? [
                  {
                      messages: second.messages.map(post => ({ ...post })),
                      snapshot: Option.fromNullishOr(
                          snapshotOf(`${slug}-s`, second.pollIds, second.votersOf ?? (() => [ids.org, ids.late]))
                      )
                  }
              ]
            : []
    });
    const [home] = yield* db.select().from(community).where(eq(community.slug, slug));
    const communityId = home?.id ?? '';
    const inCommunity = eq(session.communityId, communityId);
    const inOrder = [asc(session.localDate), asc(lineupEntry.teamOrdinal), asc(lineupEntry.position)];
    const entries = yield* db
        .select({
            date: session.localDate,
            sessionId: session.id,
            chatId: lineupEntry.chatId,
            messageId: lineupEntry.messageId,
            raw: lineupEntry.raw,
            personId: lineupEntry.personId,
            resolvedBy: lineupEntry.resolvedBy,
            isGuest: lineupEntry.isGuest
        })
        .from(lineupEntry)
        .innerJoin(session, eq(session.id, lineupEntry.sessionId))
        .where(inCommunity)
        .orderBy(...inOrder);
    const games = yield* db.select().from(session).where(inCommunity).orderBy(asc(session.localDate));

    return { communityId, stats, entries, games };
});

const wednesdayPosts = (slug: string, names = 'Олег, Марк'): Second => ({
    messages: postsOn(wednesdays, names),
    pollIds: pollIdsOf(`${slug}-s`, wednesdays)
});

const withMention = (second: Second): Second => ({
    ...second,
    messages: second.messages.map(post => {
        const before = `${post.text}, `;
        const mentions = [{ offset: before.length, text: 'U42', userId: ids.striker }];

        return post.id === 2 ? Object.assign(post, { text: `${before}U42`, mentions }) : post;
    })
});

const gonzoOn = (entries: Effect.Success<ReturnType<typeof load>>['entries']) =>
    entries.filter(({ raw }) => raw === 'Гонзо').map(({ date, personId, resolvedBy }) => [date, resolvedBy, personId] as const);

const approve = Effect.fn('test.approve')(function* (slug: string, dates: readonly string[], id = ids.striker) {
    const lines = dates.map(date => `Гонзо|${id}|${mondays.indexOf(date) * 10 + 2}|${date}`);
    const rows = yield* parseApprovals(lines.join('\n'), testConfig);
    yield* loadApprovals({ slug, rows, decidedAt });

    return rows;
});

layer(testDbLayer, { timeout: 60_000 })('a community with two chats', it => {
    it.effect('adds the games of the second chat, keeps equal message ids apart and changes nothing in the first', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const slug = 'two-ids-fc';
            const alone = yield* load(slug);
            const both = yield* load(slug, wednesdayPosts(slug));
            const again = yield* load(slug, wednesdayPosts(slug));
            const refs = yield* db
                .select({ chatId: sourceRef.chatId, kind: sourceRef.kind })
                .from(sourceRef)
                .where(and(eq(sourceRef.communityId, both.communityId), eq(sourceRef.messageId, 1)));
            const polls = yield* db
                .select({ chatId: importedPoll.chatId, messageId: importedPoll.messageId })
                .from(importedPoll)
                .where(and(eq(importedPoll.communityId, both.communityId), isNotNull(importedPoll.chatId)));
            const late = yield* accountPerson(ids.late);
            const attended = yield* db
                .select()
                .from(attendance)
                .innerJoin(session, eq(session.id, attendance.sessionId))
                .where(and(eq(session.communityId, both.communityId), eq(session.localDate, '2025-05-07')));
            const votes = yield* db
                .select()
                .from(pollVote)
                .innerJoin(session, eq(session.id, pollVote.sessionId))
                .where(and(eq(session.localDate, '2025-05-07'), eq(session.communityId, both.communityId)));

            expect(both.games.map(({ localDate }) => localDate)).toEqual([...mondays, ...wednesdays].toSorted());
            expect(both.entries.filter(({ chatId }) => !isDefined(chatId))).toEqual(alone.entries);
            expect(both.entries.filter(({ date }) => date === '2025-05-07').map(({ chatId, messageId }) => [chatId, messageId])).toEqual(
                Array.from({ length: 4 }, () => [secondChat, 2])
            );
            expect(new Set(refs.map(({ chatId }) => chatId))).toEqual(new Set([null, secondChat]));
            expect(refs).toHaveLength(2);
            expect(polls.map(({ messageId }) => messageId).toSorted((left, right) => left - right)).toEqual([1, 11, 21]);
            expect(late).not.toBe('');
            expect(attended.length).toBeGreaterThan(0);
            expect(votes).toHaveLength(2);
            expect(again.entries).toEqual(both.entries);
            expect(again.games.map(({ id }) => id)).toEqual(both.games.map(({ id }) => id));
            expect(again.stats).toEqual(both.stats);
        })
    );

    it.effect('keeps two games of one day at different times apart, also in the next import', () =>
        Effect.gen(function* () {
            const slug = 'two-times-fc';
            const second: Second = {
                messages: [
                    message(1, '2025-05-12T08:00:00Z', '', {
                        text: undefined,
                        authorId: ids.org,
                        poll: { question: 'Сегодня, 21.00 North', answers: ['+', '-'] }
                    }),
                    squadOn(2, '2025-05-12', 'Марк, Лев')
                ],
                pollIds: new Map([[1, `${slug}-s-0`]])
            };
            const first = yield* load(slug, second);
            const again = yield* load(slug, second);
            const sameDay = first.games.filter(({ localDate }) => localDate === '2025-05-12');
            const namesIn = (sessionId: string) => first.entries.filter(entry => entry.sessionId === sessionId).map(({ raw }) => raw);

            expect(sameDay.map(({ startsAt }) => startsAt.toISOString()).toSorted()).toEqual([
                '2025-05-12T17:00:00.000Z',
                '2025-05-12T19:00:00.000Z'
            ]);
            expect(sameDay.filter(({ id }) => namesIn(id).includes('Марк'))).toHaveLength(1);
            expect(sameDay.map(({ id }) => namesIn(id).length)).toEqual([4, 4]);
            expect(again.games.map(({ id }) => id).toSorted()).toEqual(first.games.map(({ id }) => id).toSorted());
            expect(again.entries).toEqual(first.entries);
        })
    );

    it.effect('counts a forwarded poll once, by its votes of the first chat, and answers to the forward belong to its game', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const slug = 'two-forward-fc';
            const main = postsOn(mondays, 'Олег, Семён').filter(({ id }) => id !== 2);
            const second: Second = {
                messages: [
                    pollOn(5, '2025-05-06'),
                    message(6, '2025-05-06T10:00:00Z', '+2', { author: 'Late', authorId: ids.late, replyTo: 5 }),
                    message(7, '2025-05-06T10:00:00Z', '+3', { author: 'Late', authorId: ids.late, replyTo: 1 })
                ],
                pollIds: new Map([[5, `${slug}-m-0`]])
            };
            const { communityId, games, entries } = yield* load(slug, second, main);
            const polls = yield* db
                .select()
                .from(importedPoll)
                .where(eq(importedPoll.pollId, `${slug}-m-0`));
            const votes = yield* db
                .select()
                .from(pollVote)
                .where(eq(pollVote.pollId, `${slug}-m-0`));

            expect(games.map(({ localDate }) => localDate)).toEqual(mondays);
            expect(polls).toMatchObject([{ communityId, chatId: null, messageId: 1 }]);
            expect(votes).toHaveLength(2);
            expect(
                entries.filter(({ date }) => date === '2025-05-05').map(({ chatId, messageId, isGuest }) => [chatId, messageId, isGuest])
            ).toEqual([
                [secondChat, 6, true],
                [secondChat, 6, true]
            ]);
        })
    );

    it.effect('gives a nickname of the first chat to the same player in the second within its period', () =>
        Effect.gen(function* () {
            const slug = 'two-period-fc';
            yield* load(slug);
            const striker = yield* accountPerson(ids.striker);
            const rows = yield* approve(slug, ['2025-05-05', '2025-05-12']);
            yield* approve(slug, ['2025-05-19', '2025-05-26'], ids.other);
            const other = yield* accountPerson(ids.other);
            const far: Second = {
                messages: [
                    ...postsOn(wednesdays, 'Олег, Марк'),
                    pollOn(91, '2025-12-03'),
                    squadOn(92, '2025-12-03', 'Олег, Марк'),
                    squadOn(82, '2024-10-02', 'Олег, Марк')
                ],
                pollIds: new Map([...pollIdsOf(`${slug}-s`, wednesdays), [91, `${slug}-s-9`]])
            };
            const { entries, stats } = yield* load(slug, far);
            const compared = yield* compareApprovals(slug, rows);
            const nameOf = new Map([
                [striker, 'striker'],
                [other, 'other']
            ]);
            const ofSecond = gonzoOn(entries.filter(({ chatId }) => isDefined(chatId)));

            expect(ofSecond.map(([date, by, personId]) => [date, by, nameOf.get(personId ?? '') ?? 'nobody'])).toEqual([
                ['2024-10-02', 'guest', 'nobody'],
                ['2025-05-07', 'alias', 'striker'],
                ['2025-05-14', 'guest', 'nobody'],
                ['2025-05-21', 'alias', 'other'],
                ['2025-12-03', 'guest', 'nobody']
            ]);
            expect(stats).toMatchObject({ extendedEntries: 2 });
            expect(compared).toMatchObject({ rows: 2, kept: 2, otherMessage: 0 });
        })
    );

    it.effect('does not give it to a player who is in that squad already or was rejected for the nickname', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const slug = 'two-limits-fc';
            const first = yield* load(slug);
            yield* approve(slug, mondays);
            const striker = yield* accountPerson(ids.striker);
            const [alias] = yield* db
                .select()
                .from(personAlias)
                .where(and(eq(personAlias.communityId, first.communityId), eq(personAlias.aliasNorm, 'гонзо')));
            yield* db.insert(aliasLink).values({
                communityId: first.communityId,
                aliasId: alias?.id ?? '',
                personId: striker,
                during: '[2025-05-14,2025-05-15)',
                method: 'admin',
                status: 'rejected'
            });
            const second = wednesdayPosts(slug);
            const { entries } = yield* load(slug, withMention(second));

            expect(gonzoOn(entries).map(([date, by]) => [date, by])).toEqual([
                ['2025-05-05', 'alias'],
                ['2025-05-07', 'guest'],
                ['2025-05-12', 'alias'],
                ['2025-05-14', 'guest'],
                ['2025-05-19', 'alias'],
                ['2025-05-21', 'alias'],
                ['2025-05-26', 'alias']
            ]);
        })
    );

    it.effect('compares approvals only with squads of their own chat', () =>
        Effect.gen(function* () {
            const slug = 'two-compare-fc';
            yield* load(slug, wednesdayPosts(slug));
            const line = `Гонзо|${ids.striker}|2|2025-05-07`;
            const rows = yield* parseApprovals(line, testConfig);
            const ofSecond = yield* parseApprovals(`${line}|${secondChat}`, testConfig);
            const ofOther = yield* parseApprovals(`${line}|-5`, testConfig);
            const malformed = yield* Effect.exit(parseApprovals(`${line}|second`, testConfig));
            const loaded = yield* loadApprovals({ slug, rows: ofSecond, decidedAt });

            expect(loaded).toMatchObject({ stored: 1, pinned: 1 });
            expect(yield* compareApprovals(slug, rows)).toMatchObject({ kept: 0, nicknameGone: 1, otherMessage: 1 });
            expect(yield* compareApprovals(slug, ofSecond)).toMatchObject({ kept: 1, nicknameGone: 0, otherMessage: 0 });
            expect(yield* compareApprovals(slug, ofOther)).toMatchObject({ kept: 0, nicknameGone: 1, otherMessage: 1 });
            expect(Exit.isFailure(malformed)).toBe(true);
        })
    );

    it.effect('lets votes of the second chat link only its own squads, and its repeated nicknames stay its own', () =>
        Effect.gen(function* () {
            const slug = 'two-votes-fc';
            const regular = Array.from({ length: 18 }, (_, index) => new Date(Date.UTC(2025, 4, 7 + index * 7)).toISOString().slice(0, 10));

            const second: Second = {
                messages: regular.flatMap((date, index) => [
                    pollOn(index * 10 + 1, date),
                    squadOn(index * 10 + 2, date, index % 3 === 0 ? 'Олег, Семён, Семён' : 'Олег, Тим')
                ]),
                pollIds: pollIdsOf(`${slug}-s`, regular),
                votersOf: index => (index % 3 === 0 ? [ids.org] : [ids.org, ids.late])
            };
            const main = [...postsOn(mondays.slice(0, 1), 'Олег, Тим'), ...postsOn(mondays, 'Олег, Семён').slice(2)];
            const alone = yield* load(slug, Option.getOrUndefined(Option.none<Second>()), main);
            const db = yield* Db;
            const { entries, communityId, stats } = yield* load(slug, second, main);
            const late = yield* accountPerson(ids.late);
            const [repeated] = yield* db
                .select()
                .from(personAlias)
                .where(and(eq(personAlias.communityId, communityId), eq(personAlias.aliasNorm, 'семен')));

            expect(entries.filter(({ chatId }) => !isDefined(chatId))).toEqual(alone.entries);
            expect(repeated?.kind).toBe('nickname');
            expect(stats.otherChatLinks).toBeGreaterThan(0);
            expect(
                entries.some(({ chatId, personId, resolvedBy }) => chatId === secondChat && personId === late && resolvedBy === 'vote')
            ).toBe(true);
        })
    );

    it.effect('keeps manual entries of the second chat with their chat', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const slug = 'two-manual-fc';
            const first = yield* load(slug, wednesdayPosts(slug));
            const striker = yield* accountPerson(ids.striker);
            const target = first.entries.find(({ date, raw }) => date === '2025-05-14' && raw === 'Марк');
            yield* db
                .update(lineupEntry)
                .set({ personId: striker, resolvedBy: 'manual', raw: 'Нет в посте' })
                .where(and(eq(lineupEntry.sessionId, target?.sessionId ?? ''), eq(lineupEntry.raw, 'Марк')));
            const { entries } = yield* load(slug, wednesdayPosts(slug));

            expect(entries.filter(({ resolvedBy }) => resolvedBy === 'manual')).toMatchObject([
                { date: '2025-05-14', chatId: secondChat, messageId: 12, personId: striker }
            ]);
        })
    );

    it.effect('leaves only the posts of its own chat to the bot', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const slug = 'two-live-fc';
            const first = yield* load(slug, wednesdayPosts(slug));
            const live = first.games.find(({ localDate }) => localDate === '2025-05-07');
            yield* db
                .insert(telegramChat)
                .values({ chatId: BigInt(secondChat), communityId: first.communityId, kind: 'supergroup', title: 'Second' });
            yield* db.insert(messageRef).values({
                chatId: BigInt(secondChat),
                messageId: 2,
                purpose: 'lineup',
                entityType: 'session',
                entityId: live?.id ?? ''
            });
            const main = postsOn(mondays, 'Олег, Павел');
            const { entries } = yield* load(slug, wednesdayPosts(slug, 'Олег, Павел'), main);
            const namesOn = (date: string) => entries.filter(entry => entry.date === date).map(({ raw }) => raw);

            expect(namesOn('2025-05-05')).toContain('Павел');
            expect(namesOn('2025-05-07')).toContain('Марк');
            expect(namesOn('2025-05-14')).toContain('Павел');
        })
    );

    it.effect('does not name a player twice whose nickname the votes of the first chat linked', () =>
        Effect.gen(function* () {
            const slug = 'two-twice-fc';
            const dates = Array.from({ length: 12 }, (_, index) => new Date(Date.UTC(2025, 4, 5 + index * 7)).toISOString().slice(0, 10));
            const main = dates.flatMap((date, index) => [
                pollOn(index * 10 + 1, date),
                squadOn(index * 10 + 2, date, index % 2 === 0 ? 'Олег' : 'Семён')
            ]);
            const second = wednesdayPosts(slug);
            const { entries } = yield* load(slug, withMention(second), main);
            const striker = yield* accountPerson(ids.striker);
            const namesOn = (date: string) =>
                entries.filter(entry => entry.date === date && entry.personId === striker).map(({ raw }) => raw);

            expect(namesOn('2025-05-05')).toEqual(['Гонзо']);
            expect(namesOn('2025-05-07')).toEqual(['U42']);
            expect(namesOn('2025-05-14')).toEqual(['Гонзо']);
        })
    );
});
