import { describeAction } from '@rondo/core/actions/describe-action';
import { requireActionScope } from '@rondo/core/actions/execute-action';
import { proposeAction } from '@rondo/core/actions/pending-action.service';
import { groupLocaleOf, mainGroupOf } from '@rondo/core/community/community.repository';
import { withNotice } from '@rondo/core/notify/notice-preview';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import type { Action } from '@rondo/core/actions/action.model';
import type { Locale } from '@rondo/core/i18n/locale';

export interface ToolScope {
    readonly communityId: string;
    readonly tgUserId: bigint;
    readonly locale: Locale;
    readonly proposals: { actionId: string; summary: string }[];
}

// The group of now is the one that is shown and approved, so it is stored with the proposal
const withPlace = Effect.fn('Assistant.withPlace')(function* (action: Action, communityId: string) {
    const isPoll = action._tag === 'announce_session' || (action._tag === 'create_session' && action.announce);
    const main = isPoll ? yield* mainGroupOf(communityId) : Option.none();

    return isPoll && Option.isSome(main) ? { ...action, chatId: String(main.value.chatId), topicId: main.value.topicId } : action;
});

export const propose = (scope: ToolScope, requested: Action) =>
    Effect.gen(function* () {
        yield* requireActionScope(requested, scope.communityId);
        const placed = yield* withPlace(requested, scope.communityId);
        const action = yield* withNotice(placed, {
            communityId: scope.communityId,
            group: yield* mainGroupOf(scope.communityId),
            groupLocale: yield* groupLocaleOf(scope.communityId),
            requester: scope.tgUserId
        });
        const summary = yield* describeAction(action, scope.locale, scope.communityId);
        const actionId = yield* proposeAction({ communityId: scope.communityId, tgUserId: scope.tgUserId, action, summary });
        scope.proposals.push({ actionId, summary });

        return { status: 'awaiting_admin_confirmation', summary };
    });
