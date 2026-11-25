import { isDefined } from '@rnw-community/shared';
import { grantAdmin } from '@rondo/core/access/admin-access';
import { bindChat } from '@rondo/core/community/community.repository';
import { upsertTelegramUser } from '@rondo/core/identity/telegram-user';
import { createSession } from '@rondo/core/sessions/session.service';
import { seedCommunity, seedConfig } from '@rondo/core/testing/seed-community';
import { addDays } from '@rondo/core/utils/add-days.util';
import { session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { eq } from 'drizzle-orm';
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
