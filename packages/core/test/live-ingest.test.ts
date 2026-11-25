import { expect, layer } from '@effect/vitest';
import { isDefined } from '@rnw-community/shared';
import { personAlias } from '@rondo/db/schema/identity.schema';
import { messageRef } from '@rondo/db/schema/platform.schema';
import { lineupEntry, team, teamMember } from '@rondo/db/schema/play.schema';
import { attendance, session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { upsertTelegramUser } from '../src/identity/telegram-user';
import { ingestGroupMessage } from '../src/live/live-ingest';
import { recordedTelegramDbLayer } from '../src/testing/recorded-telegram.layer';
import { seedCommunity, seedConfig } from '../src/testing/seed-community';

const config = seedConfig('live-fc');

const matchChat = -910;
const cancelChat = -920;

const seedMatchChat = Effect.fn('test.seedMatchChat')(function* (slug: string, secondChatId: number) {
    const scoped = { ...seedConfig(slug), otherChats: [{ chatId: secondChatId, exportDir: 'second', matchPatterns: ['friendly'] }] };
    const { communityId } = yield* seedCommunity(scoped);
    const personId = yield* upsertTelegramUser({ id: 910n, firstName: 'Org' });
    const post = (chatId: number, messageId: number, sentAt: string, content: { readonly text?: string; readonly question?: string }) =>
        ingestGroupMessage(communityId, scoped, {
            chatId: BigInt(chatId),
            messageId,
            sentAt: new Date(sentAt),
            senderPersonId: personId,
            senderTgUserId: 910n,
            senderName: 'Org',
            isTrusted: true,
            ...(isDefined(content.text) ? { text: content.text } : {}),
            ...(isDefined(content.question) ? { poll: { question: content.question, answers: ['+', '-'] } } : {})
        });
    const db = yield* Db;
    const entries = db
        .select({ chatId: lineupEntry.chatId, raw: lineupEntry.raw })
        .from(lineupEntry)
        .innerJoin(session, eq(session.id, lineupEntry.sessionId))
        .where(eq(session.communityId, communityId))
        .orderBy(lineupEntry.teamOrdinal, lineupEntry.position);

    return { communityId, post, entries };
});

layer(recordedTelegramDbLayer, { timeout: 60_000 })('live group listener', it => {
    it.effect('turns a poll and a line-up into session data and only suggests a cancellation', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedCommunity(config);
            const organizer = { id: 7n, firstName: 'Org' };
            const organizerPersonId = yield* upsertTelegramUser(organizer);
            const base = {
                chatId: -100n,
                senderPersonId: organizerPersonId,
                senderTgUserId: organizer.id,
                senderName: 'Org',
                isTrusted: true
            };

            const poll = yield* ingestGroupMessage(communityId, config, {
                ...base,
                messageId: 1,
                sentAt: new Date('2026-05-03T18:00:00Z'),
                poll: { question: 'Понедельник, 4 мая, 19.00 North. 18 чел', answers: ['+', '-'] }
            });
            const lineup = yield* ingestGroupMessage(communityId, config, {
                ...base,
                messageId: 2,
                sentAt: new Date('2026-05-04T15:00:00Z'),
                text: 'Составы на сегодня, North:\n🟢Я, Иван, Пётр вратарь\n🔵Олег, Семён, Павел'
            });
            const [played] = yield* db.select().from(session).where(eq(session.communityId, communityId));
            const members = yield* db
                .select()
                .from(teamMember)
                .where(eq(teamMember.sessionId, played?.id ?? ''));
            const selfMember = members.find(member => member.personId === organizerPersonId);
            const aliases = yield* db.select().from(personAlias).where(eq(personAlias.communityId, communityId));

            yield* ingestGroupMessage(communityId, config, {
                ...base,
                messageId: 3,
                sentAt: new Date('2026-05-08T10:00:00Z'),
                poll: { question: 'Пятница, 8 мая, 19.30 Park', answers: ['+', '-'] }
            });
            const cancellation = yield* ingestGroupMessage(communityId, config, {
                ...base,
                messageId: 4,
                sentAt: new Date('2026-05-08T12:00:00Z'),
                text: 'Сегодня отмена, дождь'
            });
            const [cancelled] = yield* db
                .select()
                .from(session)
                .where(and(eq(session.communityId, communityId), eq(session.localDate, '2026-05-08')));
            const stillPlayed = yield* db
                .select()
                .from(attendance)
                .where(eq(attendance.sessionId, played?.id ?? ''));

            expect(poll).toMatchObject({ poll: true, lineup: false });
            expect(lineup).toMatchObject({ lineup: true });
            expect(played).toMatchObject({ localDate: '2026-05-04', status: 'locked', capacityMax: 18 });
            expect(members).toHaveLength(6);
            expect(isDefined(selfMember)).toBe(true);
            expect(aliases.map(alias => alias.aliasNorm).toSorted()).toEqual(['иван', 'олег', 'павел', 'петр', 'семен']);
            expect(cancellation.cancellation).toEqual({ sessionId: cancelled?.id, reason: 'weather' });
            expect(cancelled?.status).toBe('open');
            expect(stillPlayed).toHaveLength(6);
        })
    );

    it.effect('ignores line-ups and cancellations from members, even one named like the organizer', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const scoped = seedConfig('live-member-fc');
            const { communityId } = yield* seedCommunity(scoped);
            const member = { id: 8n, firstName: 'Org' };
            const personId = yield* upsertTelegramUser(member);
            const base = { chatId: -101n, senderPersonId: personId, senderTgUserId: member.id, senderName: 'Org', isTrusted: false };

            yield* ingestGroupMessage(communityId, scoped, {
                ...base,
                isTrusted: true,
                messageId: 1,
                sentAt: new Date('2026-05-08T10:00:00Z'),
                poll: { question: 'Пятница, 8 мая, 19.30 Park', answers: ['+', '-'] }
            });
            const result = yield* ingestGroupMessage(communityId, scoped, {
                ...base,
                messageId: 2,
                sentAt: new Date('2026-05-08T12:00:00Z'),
                text: 'Сегодня отмена, дождь'
            });
            const lineup = yield* ingestGroupMessage(communityId, scoped, {
                ...base,
                messageId: 3,
                sentAt: new Date('2026-05-08T13:00:00Z'),
                text: 'Составы на сегодня, Park:\n🟢Иван, Пётр\n🔵Олег, Семён'
            });
            yield* ingestGroupMessage(communityId, scoped, {
                ...base,
                isTrusted: true,
                messageId: 4,
                sentAt: new Date('2026-05-08T14:00:00Z'),
                text: 'Переносим сегодняшний футбол на завтра'
            });
            yield* ingestGroupMessage(communityId, scoped, {
                ...base,
                isTrusted: true,
                messageId: 5,
                sentAt: new Date('2026-05-08T15:00:00Z'),
                text: 'Сегодня ничего не отменяем, играем, дождь небольшой'
            });
            const [kept] = yield* db.select().from(session).where(eq(session.communityId, communityId));

            expect(isDefined(result.cancellation)).toBe(false);
            expect(lineup.lineup).toBe(false);
            expect(kept?.status).toBe('open');
        })
    );

    it.effect('keeps two games on one day apart and never reopens a played one', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const scoped = seedConfig('two-games-fc');
            const { communityId } = yield* seedCommunity(scoped);
            const personId = yield* upsertTelegramUser({ id: 9n, firstName: 'Org' });
            const base = { chatId: -103n, senderPersonId: personId, senderTgUserId: 9n, senderName: 'Org', isTrusted: true };
            const pollAt = (messageId: number, time: string) =>
                ingestGroupMessage(communityId, scoped, {
                    ...base,
                    messageId,
                    sentAt: new Date('2026-05-08T08:00:00Z'),
                    poll: { question: `Пятница, 8 мая, ${time} Park`, answers: ['+', '-'] }
                });
            yield* pollAt(1, '19.00');
            yield* pollAt(2, '21.00');
            const games = yield* db.select().from(session).where(eq(session.communityId, communityId)).orderBy(session.startsAt);
            yield* db.update(session).set({ status: 'played' }).where(eq(session.communityId, communityId));
            yield* ingestGroupMessage(communityId, scoped, {
                ...base,
                messageId: 3,
                sentAt: new Date('2026-05-08T21:30:00Z'),
                text: 'Составы на сегодня, 19.00 Park:\n🟢Иван, Пётр\n🔵Олег, Семён'
            });
            const after = yield* db.select({ status: session.status }).from(session).where(eq(session.communityId, communityId));

            expect(games).toHaveLength(2);
            expect(after.map(row => row.status)).toEqual(['played', 'played']);
        })
    );

    it.effect('uses the import rules: squads by structure and no cancellation from questions', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const scoped = seedConfig('same-rules-fc');
            const { communityId } = yield* seedCommunity(scoped);
            const personId = yield* upsertTelegramUser({ id: 77n, firstName: 'Org' });
            const post = (messageId: number, text: string) =>
                ingestGroupMessage(communityId, scoped, {
                    chatId: -177n,
                    messageId,
                    sentAt: new Date('2026-05-08T12:00:00Z'),
                    senderPersonId: personId,
                    senderTgUserId: 77n,
                    senderName: 'Org',
                    isTrusted: true,
                    text
                });
            const squad = yield* post(1, '🟢Я, Иван, Пётр, Олег\n🔵Семён, Павел, Глеб, Ян');
            const asked = yield* post(2, 'Все приходят сегодня? Никто не отменяется?');
            const unclear = yield* post(3, 'Он отменился');
            const games = yield* db.select().from(session).where(eq(session.communityId, communityId));

            expect(squad.lineup).toBe(true);
            expect([asked.cancellation, unclear.cancellation]).toEqual([undefined, undefined]);
            expect(games).toHaveLength(1);
        })
    );

    it.effect('makes only weekly games of a chat that also has matches', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const chatId = -900;
            const matches = { ...seedConfig('live-matches'), otherChats: [{ chatId, exportDir: 'second', matchPatterns: ['friendly'] }] };
            const { communityId } = yield* seedCommunity(matches);
            const personId = yield* upsertTelegramUser({ id: 900n, firstName: 'Org' });
            const base = { senderPersonId: personId, senderTgUserId: 900n, senderName: 'Org', isTrusted: true };
            const post = (
                messageId: number,
                sentAt: string,
                chat: number,
                content: { readonly text?: string; readonly question?: string }
            ) =>
                ingestGroupMessage(communityId, matches, {
                    ...base,
                    chatId: BigInt(chat),
                    messageId,
                    sentAt: new Date(sentAt),
                    ...(isDefined(content.text) ? { text: content.text } : {}),
                    ...(isDefined(content.question) ? { poll: { question: content.question, answers: ['+', '-'] } } : {})
                });
            const squad = 'Составы на сегодня, North:\n🟢Я, Иван\n🔵Олег, Семён';
            const match = yield* post(1, '2026-05-09T08:00:00Z', chatId, { question: 'Завтра, 12.00 North' });
            const friendly = yield* post(2, '2026-05-06T08:00:00Z', chatId, { question: 'Сегодня, 19.00 North, friendly' });
            const matchSquad = yield* post(3, '2026-05-10T08:00:00Z', chatId, { text: squad });
            const weekly = yield* post(4, '2026-05-13T08:00:00Z', chatId, { question: 'Сегодня, 19.00 North' });
            const weeklySquad = yield* post(5, '2026-05-13T15:00:00Z', chatId, { text: squad });
            const elsewhere = yield* post(6, '2026-05-16T08:00:00Z', -901, { question: 'Завтра, 12.00 North' });
            const games = yield* db.select({ date: session.localDate }).from(session).where(eq(session.communityId, communityId));

            expect([match, friendly, matchSquad].map(({ poll, lineup }) => poll || lineup)).toEqual([false, false, false]);
            expect([weekly.poll, weeklySquad.lineup, elsewhere.poll]).toEqual([true, true, true]);
            expect(games.map(({ date }) => date).toSorted()).toEqual(['2026-05-13', '2026-05-17']);
        })
    );

    it.effect('stores a squad of the second chat with its chat and never replaces a main squad with it', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, post, entries } = yield* seedMatchChat('live-second-squad', matchChat);
            const second = 'Составы на сегодня, North:\n🟢Я, Иван\n🔵Олег, Семён';
            const main = 'Составы на сегодня, North:\n🟢Я, Глеб\n🔵Павел, Ян';
            yield* post(-911, 1, '2026-05-13T08:00:00Z', { question: 'Сегодня, 19.00 North' });
            yield* post(matchChat, 2, '2026-05-13T15:00:00Z', { text: second });
            const unpolled = yield* entries;
            yield* post(matchChat, 3, '2026-05-13T15:10:00Z', { question: 'Сегодня, 19.00 North' });
            yield* post(matchChat, 4, '2026-05-13T15:20:00Z', { text: second });
            const stored = yield* entries;
            yield* post(-911, 5, '2026-05-13T15:30:00Z', { text: main });
            yield* post(matchChat, 6, '2026-05-13T15:40:00Z', { text: second });
            const kept = yield* entries;
            const games = yield* db.select({ id: session.id }).from(session).where(eq(session.communityId, communityId));
            const teams = yield* db
                .select()
                .from(teamMember)
                .where(eq(teamMember.sessionId, games[0]?.id ?? ''));

            expect(unpolled).toEqual([]);
            expect(stored.map(({ chatId }) => chatId)).toEqual([matchChat, matchChat, matchChat, matchChat]);
            expect(kept.map(({ chatId }) => chatId)).toEqual([null, null, null, null]);
            expect(kept.map(({ raw }) => raw)).toContain('Глеб');
            expect([games.length, teams.length]).toEqual([1, 4]);
        })
    );

    it.effect('keeps teams the bot published when a squad of the second chat follows', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, post, entries } = yield* seedMatchChat('live-second-teams', matchChat);
            yield* post(matchChat, 11, '2026-05-13T08:00:00Z', { question: 'Сегодня, 19.00 North' });
            const [game] = yield* db.select().from(session).where(eq(session.communityId, communityId));
            const sessionId = game?.id ?? '';
            const personId = yield* upsertTelegramUser({ id: 912n, firstName: 'Player' });
            const [published] = yield* db.insert(team).values({ sessionId, ordinal: 1, publishedAt: new Date() }).returning();
            yield* db.insert(teamMember).values({ teamId: published?.id ?? '', sessionId, personId, assignedBy: 'balancer' });
            yield* post(matchChat, 12, '2026-05-13T15:00:00Z', { text: 'Составы на сегодня, North:\n🟢Я, Иван\n🔵Олег, Семён' });
            const members = yield* db.select().from(teamMember).where(eq(teamMember.sessionId, sessionId));

            expect(yield* entries).toEqual([]);
            expect(members.map(member => member.personId)).toEqual([personId]);
        })
    );

    it.effect('reads the match rules in squad headers of the second chat', () =>
        Effect.gen(function* () {
            const { post, entries } = yield* seedMatchChat('live-second-header', matchChat);
            const named = yield* post(matchChat, 1, '2026-05-13T15:00:00Z', {
                text: 'Составы на сегодня, friendly:\n🟢Я, Иван\n🔵Олег, Семён'
            });

            expect(named.lineup).toBe(false);
            expect(yield* entries).toEqual([]);
        })
    );

    it.effect('suggests a cancellation from the second chat only for its own games, never on match days', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, post } = yield* seedMatchChat('live-second-cancel', cancelChat);
            const inDay = (date: string) => and(eq(session.communityId, communityId), eq(session.localDate, date));
            const cancel = { text: 'Сегодня отмена, дождь' };
            yield* post(-911, 1, '2026-05-13T08:00:00Z', { question: 'Сегодня, 19.00 North' });
            const foreign = yield* post(cancelChat, 2, '2026-05-13T09:00:00Z', cancel);
            yield* post(cancelChat, 3, '2026-05-20T08:00:00Z', { question: 'Сегодня, 19.00 North' });
            const own = yield* post(cancelChat, 4, '2026-05-20T09:00:00Z', cancel);
            yield* post(-911, 5, '2026-05-23T08:00:00Z', { question: 'Сегодня, 19.00 North' });
            const [saturday] = yield* db.select().from(session).where(inDay('2026-05-23'));
            yield* db
                .insert(messageRef)
                .values({ chatId: BigInt(cancelChat), messageId: 6, purpose: 'poll', entityType: 'session', entityId: saturday?.id ?? '' });
            const weekend = yield* post(cancelChat, 7, '2026-05-23T09:00:00Z', cancel);
            const main = yield* post(-911, 8, '2026-05-23T10:00:00Z', cancel);

            expect([foreign, weekend].map(({ cancellation }) => isDefined(cancellation))).toEqual([false, false]);
            expect([own, main].map(({ cancellation }) => isDefined(cancellation))).toEqual([true, true]);
        })
    );
});
