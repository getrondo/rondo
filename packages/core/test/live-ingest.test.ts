import { expect, layer } from '@effect/vitest';
import { isDefined } from '@rnw-community/shared';
import { personAlias } from '@rondo/db/schema/identity.schema';
import { teamMember } from '@rondo/db/schema/play.schema';
import { attendance, session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { upsertTelegramUser } from '../src/identity/telegram-user';
import { ingestGroupMessage } from '../src/live/live-ingest';
import { recordedTelegramDbLayer } from '../src/testing/recorded-telegram.layer';
import { seedCommunity, seedConfig } from '../src/testing/seed-community';

const config = seedConfig('live-fc');

layer(recordedTelegramDbLayer, { timeout: 60_000 })('live group listener', it => {
    it.effect('turns a poll, a line-up and an organizer cancellation into session data', () =>
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
                senderIsAdmin: true
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
            expect(cancellation).toMatchObject({ cancellation: true });
            expect(cancelled).toMatchObject({ status: 'cancelled', cancelReason: 'weather' });
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
            const base = { chatId: -101n, senderPersonId: personId, senderTgUserId: member.id, senderName: 'Org', senderIsAdmin: false };

            yield* ingestGroupMessage(communityId, scoped, {
                ...base,
                senderIsAdmin: true,
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
                senderIsAdmin: true,
                messageId: 4,
                sentAt: new Date('2026-05-08T14:00:00Z'),
                text: 'Переносим сегодняшний футбол на завтра'
            });
            const [kept] = yield* db.select().from(session).where(eq(session.communityId, communityId));

            expect(result.cancellation).toBe(false);
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
            const base = { chatId: -103n, senderPersonId: personId, senderTgUserId: 9n, senderName: 'Org', senderIsAdmin: true };
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
});
