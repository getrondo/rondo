import { communityProfile, groupLocaleOf, mainGroupOf } from '@rondo/core/community/community.repository';
import { personIdOfTelegramUser } from '@rondo/core/identity/telegram-user';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import type { ActionContext } from '@rondo/core/actions/execute-action';

export const actionContextFor = (tgUserId: bigint) =>
    Effect.fn('Bot.actionContext')(function* (communityId: string) {
        const profile = yield* communityProfile(communityId);

        return {
            communityId,
            timezone: Option.match(profile, { onNone: () => 'Europe/Vienna', onSome: value => value.timezone }),
            group: yield* mainGroupOf(communityId),
            groupLocale: yield* groupLocaleOf(communityId),
            actorPersonId: yield* personIdOfTelegramUser(tgUserId),
            requester: tgUserId
        } satisfies ActionContext;
    }, Effect.orDie);
