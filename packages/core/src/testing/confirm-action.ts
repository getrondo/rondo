import { isDefined } from '@rnw-community/shared';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { describeAction } from '../actions/describe-action';
import { decideAction, proposeAction } from '../actions/pending-action.service';
import { mainGroupOf } from '../community/community.repository';

import type { Action } from '../actions/action.model';

export const confirmAsOwner = Effect.fn('Testing.confirmAsOwner')(function* (communityId: string, action: Action, chatId?: bigint) {
    const summary = yield* describeAction(action, 'uk', communityId);
    const actionId = yield* proposeAction({ communityId, tgUserId: 42n, action, summary });
    const linked = yield* mainGroupOf(communityId);
    const group = Option.isSome(linked) || !isDefined(chatId) ? linked : Option.some({ chatId, topicId: null });

    return yield* decideAction({
        actionId,
        tgUserId: 42n,
        confirm: true,
        context: id => Effect.succeed({ communityId: id, timezone: 'Europe/Vienna', group, groupLocale: 'uk', actorPersonId: null })
    });
});
