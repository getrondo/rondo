import { isDefined } from '@rnw-community/shared';
import { grantAdmin } from '@rondo/core/access/admin-access';
import { bindChat } from '@rondo/core/community/community.repository';
import { upsertTelegramUser } from '@rondo/core/identity/telegram-user';
import { createSession } from '@rondo/core/sessions/session.service';
import { seedCommunity, seedConfig } from '@rondo/core/testing/seed-community';
import { addDays } from '@rondo/core/utils/add-days.util';
import { messageRef } from '@rondo/db/schema/platform.schema';
import { session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq, inArray } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { setNow } from './fixed-clock';

export const thursdayMorning = Date.parse('2026-11-26T09:00:00Z');

export const grantOrganizer = Effect.fn('test.grantOrganizer')(function* (communityId: string, tgUserId: number) {
    const personId = yield* upsertTelegramUser({ id: BigInt(tgUserId), firstName: `Admin ${tgUserId}` });
    yield* grantAdmin({ communityId, personId, grantedBy: null });

    return personId;
});

const weeks = [1, 2, 3, 4, 5, 6, 7, 8];

export const seedSeason = Effect.fn('test.seedSeason')(function* (
    slug: string,
    options: { readonly groupChatId: number | null; readonly adminId: number }
) {
    const db = yield* Db;
    const { communityId, venueIdByName } = yield* seedCommunity(seedConfig(slug));
    const north = venueIdByName.get('North Arena') ?? null;
    const park = venueIdByName.get('Park Field') ?? null;
    const base = { communityId, timezone: 'Europe/Vienna', title: null, actorPersonId: null };
    const played = [
        ...weeks.map(week => ({ localDate: addDays('2026-11-20', -7 * (week - 1)), localTime: '19:00', venueId: north, capacityMax: 22 })),
        ...weeks.map(week => ({ localDate: addDays('2026-11-23', -7 * (week - 1)), localTime: '18:30', venueId: park, capacityMax: 18 })),
        { localDate: '2026-11-24', localTime: '20:00', venueId: null, capacityMax: null },
        { localDate: '2026-11-17', localTime: '20:00', venueId: null, capacityMax: null }
    ];

    for (const game of played) {
        const sessionId = yield* createSession({ ...base, ...game, fieldsPlanned: 1 });
        yield* db.update(session).set({ status: 'played' }).where(eq(session.id, sessionId));
    }

    if (isDefined(options.groupChatId)) {
        yield* bindChat({ communityId, chatId: BigInt(options.groupChatId), topicId: null, kind: 'supergroup', title: 'Games' });
    }

    yield* grantOrganizer(communityId, options.adminId);
    yield* setNow(thursdayMorning);

    return { communityId, north: north ?? '', park: park ?? '' };
});

export const seedSecondGroup = Effect.fn('test.seedSecondGroup')(function* (
    communityId: string,
    chats: { readonly main: number; readonly second: number; readonly venueId: string }
) {
    const db = yield* Db;
    yield* bindChat({ communityId, chatId: BigInt(chats.second), topicId: null, kind: 'supergroup', title: 'Second' });
    const base = { communityId, timezone: 'Europe/Vienna', title: null, actorPersonId: null, fieldsPlanned: 1 };
    const wednesdays = [1, 2, 3, 4].map(week => addDays('2026-11-25', -7 * week));
    let messageId = 70_000;

    for (const localDate of wednesdays) {
        const sessionId = yield* createSession({ ...base, localDate, localTime: '20:00', venueId: chats.venueId, capacityMax: 16 });
        yield* db.update(session).set({ status: 'played' }).where(eq(session.id, sessionId));
        messageId += 1;
        yield* db
            .insert(messageRef)
            .values({ chatId: BigInt(chats.second), messageId, purpose: 'poll', entityType: 'session', entityId: sessionId });
    }

    const fridays = yield* db
        .select({ id: session.id })
        .from(session)
        .where(and(eq(session.communityId, communityId), inArray(session.localDate, ['2026-11-20', '2026-11-13'])));

    for (const friday of fridays) {
        for (const chatId of [chats.main, chats.second]) {
            messageId += 1;
            yield* db
                .insert(messageRef)
                .values({ chatId: BigInt(chatId), messageId, purpose: 'poll', entityType: 'session', entityId: friday.id });
        }
    }
});
