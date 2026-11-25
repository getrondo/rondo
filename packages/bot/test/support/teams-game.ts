import { isDefined } from '@rnw-community/shared';
import { syncMember } from '@rondo/core/identity/telegram-user';
import { createSession } from '@rondo/core/sessions/session.service';
import { messageRef } from '@rondo/db/schema/platform.schema';
import { signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import * as Effect from 'effect/Effect';

import { seedSeason } from './season';

const names = [
    'Andriy',
    'Bohdan',
    'Vasyl',
    'Hryhoriy',
    'Dmytro',
    'Yevhen',
    'Zakhar',
    'Ivan',
    'Kyrylo',
    'Lev',
    'Maksym',
    'Nazar',
    'Oleh',
    'Petro',
    'Roman',
    'Stepan',
    'Taras',
    'Ustym',
    'Fedir',
    'Khoma',
    'Tsezar'
];

export const teamsGame = Effect.fn('test.teamsGame')(function* (
    slug: string,
    options: {
        readonly groupChatId: number | null;
        readonly adminId: number;
        readonly players: number;
        readonly keepers?: number;
        readonly privateAudience?: boolean;
        readonly base?: number;
    }
) {
    const db = yield* Db;
    const season = yield* seedSeason(slug, { groupChatId: options.groupChatId, adminId: options.adminId });
    const sessionId = yield* createSession({
        communityId: season.communityId,
        timezone: 'Europe/Vienna',
        localDate: '2026-11-27',
        localTime: '19:00',
        venueId: season.north,
        capacityMax: 22,
        title: null,
        actorPersonId: null
    });
    const people: string[] = [];
    const base = options.base ?? options.adminId * 100;

    for (let index = 0; index < options.players; index += 1) {
        const personId = yield* syncMember(
            season.communityId,
            { id: BigInt(base + index), firstName: names[index % names.length] ?? `P${index}` },
            'active'
        );
        yield* db.insert(signup).values({ sessionId, personId, status: 'in', role: index < (options.keepers ?? 0) ? 'gk' : 'field' });
        people.push(personId);
    }

    if (options.privateAudience === true) {
        yield* db
            .insert(messageRef)
            .values({ chatId: BigInt(options.adminId), messageId: 1, purpose: 'poll', entityType: 'session', entityId: sessionId });
    } else if (isDefined(options.groupChatId)) {
        yield* db
            .insert(messageRef)
            .values({ chatId: BigInt(options.groupChatId), messageId: 1, purpose: 'poll', entityType: 'session', entityId: sessionId });
    }

    return { ...season, sessionId, people };
});
