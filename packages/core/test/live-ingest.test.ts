import { expect, layer } from '@effect/vitest';
import { isDefined } from '@rnw-community/shared';
import { personAlias } from '@rondo/db/schema/identity.schema';
import { teamMember } from '@rondo/db/schema/play.schema';
import { attendance, session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { testDbLayer } from '@rondo/db/testing/test-db.layer';
import { and, eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { upsertTelegramUser } from '../src/identity/telegram-user';
import { ingestGroupMessage } from '../src/live/live-ingest';
import { seedCommunity, seedConfig } from '../src/testing/seed-community';

const config = seedConfig('live-fc');

layer(testDbLayer, { timeout: 60_000 })('live group listener', it => {
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
            expect(played).toMatchObject({ localDate: '2026-05-04', status: 'played', capacityMax: 18 });
            expect(members).toHaveLength(6);
            expect(isDefined(selfMember)).toBe(true);
            expect(aliases.map(alias => alias.aliasNorm).toSorted()).toEqual(['иван', 'олег', 'павел', 'петр', 'семен']);
            expect(cancellation).toMatchObject({ cancellation: true });
            expect(cancelled).toMatchObject({ status: 'cancelled', cancelReason: 'weather' });
            expect(stillPlayed).toHaveLength(6);
        })
    );

    it.effect('ignores cancellations from members who are not organizers', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const scoped = seedConfig('live-member-fc');
            const { communityId } = yield* seedCommunity(scoped);
            const member = { id: 8n, firstName: 'Member' };
            const personId = yield* upsertTelegramUser(member);
            const base = { chatId: -101n, senderPersonId: personId, senderTgUserId: member.id, senderName: 'Member', senderIsAdmin: false };

            yield* ingestGroupMessage(communityId, scoped, {
                ...base,
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
            const [kept] = yield* db.select().from(session).where(eq(session.communityId, communityId));

            expect(result.cancellation).toBe(false);
            expect(kept?.status).toBe('open');
        })
    );
});
