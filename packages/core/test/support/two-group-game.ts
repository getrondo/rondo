import { telegramChat } from '@rondo/db/schema/org.schema';
import { messageRef } from '@rondo/db/schema/platform.schema';
import { signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { syncMember } from '../../src/identity/telegram-user';
import { planLineup } from '../../src/teams/lineup-plan';
import { publishLineup } from '../../src/teams/publish-lineup';
import { openDraft } from '../../src/teams/team-draft.service';
import { seedGame } from '../../src/testing/seed-game';

export const twoGroupGame = Effect.fn('test.twoGroupGame')(function* (slug: string, chats: readonly [number, number], base: number) {
    const db = yield* Db;
    const { communityId, sessionId } = yield* seedGame(slug);

    for (const [index, chatId] of chats.entries()) {
        yield* db.insert(telegramChat).values({ chatId: BigInt(chatId), communityId, kind: 'supergroup', title: `Group ${index + 1}` });
        yield* db
            .insert(messageRef)
            .values({ chatId: BigInt(chatId), messageId: index + 1, purpose: 'poll', entityType: 'session', entityId: sessionId });
    }

    for (let index = 0; index < 8; index += 1) {
        const personId = yield* syncMember(communityId, { id: BigInt(base + index), firstName: `Player${index}` }, 'active');
        yield* db.insert(signup).values({ sessionId, personId, status: 'in' });
    }

    yield* openDraft(communityId, sessionId, null);

    return { communityId, sessionId };
});

export const publishPlanned = Effect.fn('test.publishPlanned')(function* (
    game: { readonly communityId: string; readonly sessionId: string },
    retryToken: string | null = null
) {
    const input = { ...game, locale: 'uk' as const, actorPersonId: null, privateChatId: null, fallback: Option.none(), retryToken };
    const plan = yield* planLineup(input);

    return yield* publishLineup({ ...input, version: plan.version, fingerprint: plan.fingerprint });
});
