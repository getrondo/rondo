import { telegramAccount } from '@rondo/db/schema/identity.schema';
import { Db } from '@rondo/db/service/db.service';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import type { CommunityConfig } from '../src/config/community-config';
import type { TelegramMessage } from '../src/model/telegram-message.model';

export const testConfig: CommunityConfig = {
    slug: 'test-fc',
    name: 'Test FC',
    timeZone: 'Europe/Vienna',
    organizers: ['Org'],
    selfAliases: ['Я'],
    venues: [
        { key: 'north', name: 'North Arena', kind: 'training', district: 21, patterns: ['north', 'норд'] },
        { key: 'park', name: 'Park Field', kind: 'training', patterns: ['park', 'парк'] }
    ],
    teamColors: [
        { emoji: '🟢', name: 'green' },
        { emoji: '🔵', name: 'blue' },
        { emoji: '🔴', name: 'red' }
    ],
    squads: [
        { name: 'TFC-2', patterns: ['^tfc\\s?-?\\s?2$'], contextPatterns: ['5\\s*лиг'] },
        { name: 'TFC', patterns: ['^tfc$'], contextPatterns: [] }
    ]
};

export const message = (id: number, sentAt: string, text: string, overrides: Partial<TelegramMessage> = {}): TelegramMessage => ({
    id,
    kind: 'message',
    sentAt: new Date(sentAt),
    author: 'Org',
    text,
    media: [],
    ...overrides
});

export const accountPerson = Effect.fn('test.accountPerson')(function* (id: number) {
    const db = yield* Db;
    const [row] = yield* db
        .select()
        .from(telegramAccount)
        .where(eq(telegramAccount.tgUserId, BigInt(id)));

    return row?.personId ?? '';
});
