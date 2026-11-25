import { messageRef } from '@rondo/db/schema/platform.schema';
import { signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { Telegram } from '@rondo/telegram/service/telegram.service';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { syncMember } from '../../src/identity/telegram-user';
import { planLineup } from '../../src/teams/lineup-plan';
import { publishLineup } from '../../src/teams/publish-lineup';
import { openDraft } from '../../src/teams/team-draft.service';
import { linkGroup, ownerApproval } from '../../src/testing/link-group';
import { seedGame } from '../../src/testing/seed-game';

export { ownerApproval } from '../../src/testing/link-group';

export const twoGroupGame = Effect.fn('test.twoGroupGame')(function* (slug: string, chats: readonly [number, number], base: number) {
    const db = yield* Db;
    const { communityId, sessionId } = yield* seedGame(slug);

    for (const [index, chatId] of chats.entries()) {
        yield* linkGroup(communityId, { chatId, title: `Group ${index + 1}`, purpose: index === 0 ? 'main' : 'other' });
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
    const input = {
        ...game,
        locale: 'uk' as const,
        actorPersonId: null,
        approval: ownerApproval,
        privateChatId: null,
        fallback: Option.none(),
        retryToken
    };
    const plan = yield* planLineup(input);

    return yield* publishLineup({ ...input, version: plan.version, fingerprint: plan.fingerprint });
});

// The competing write ends before the first send starts
export const publishWhile = <Value, Failure>(
    target: { readonly communityId: string; readonly sessionId: string },
    during: Effect.Effect<Value, Failure, Db>
) =>
    Effect.gen(function* () {
        const db = yield* Db;
        const telegram = yield* Telegram;
        const once = yield* Effect.cached(during.pipe(Effect.provideService(Db, db)));
        const published = yield* publishPlanned(target).pipe(
            Effect.provideService(Telegram, {
                ...telegram,
                call: (method, request) => Effect.exit(once).pipe(Effect.andThen(telegram.call(method, request)))
            }),
            Effect.result
        );

        return { published, during: yield* Effect.exit(once) };
    });
