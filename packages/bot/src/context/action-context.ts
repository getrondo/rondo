import { communityProfile, groupLocaleOf, mainGroupOf } from '@rondo/core/community/community.repository';
import { personIdOfTelegramUser } from '@rondo/core/identity/telegram-user';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import type { ActionContext } from '@rondo/core/actions/execute-action';

export const actionContextFor = Effect.fn('Bot.actionContext')(function* (communityId: string, requester: bigint) {
    const profile = yield* communityProfile(communityId);

    return {
        communityId,
        timezone: Option.match(profile, { onNone: () => 'Europe/Vienna', onSome: value => value.timezone }),
        group: yield* mainGroupOf(communityId),
        groupLocale: yield* groupLocaleOf(communityId),
        actorPersonId: yield* personIdOfTelegramUser(requester),
        requester
    } satisfies ActionContext;
}, Effect.orDie);
