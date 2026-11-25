import { isDefined } from '@rnw-community/shared';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { describeAction } from '../actions/describe-action';
import { decideAction, proposeAction } from '../actions/pending-action.service';
import { mainGroupOf } from '../community/community.repository';
import { publishTeamsAction, type ProposedTeam } from '../teams/team.service';

import type { Action } from '../actions/action.model';

const groupFor = Effect.fn('Testing.groupFor')(function* (communityId: string, chatId?: bigint) {
    const linked = yield* mainGroupOf(communityId);

    return Option.isSome(linked) || !isDefined(chatId) ? linked : Option.some({ chatId, topicId: null });
});

export const teamsActionAsOwner = Effect.fn('Testing.teamsActionAsOwner')(function* (
    communityId: string,
    sessionId: string,
    teams: readonly ProposedTeam[] | null,
    chatId?: bigint
) {
    return yield* publishTeamsAction({
        communityId,
        sessionId,
        teams,
        teamCount: 2,
        locale: 'uk',
        privateChatId: null,
        fallback: yield* groupFor(communityId, chatId),
        actorPersonId: null
    });
});

export const proposeAs = Effect.fn('Testing.proposeAs')(function* (communityId: string, tgUserId: bigint, action: Action) {
    const summary = yield* describeAction(action, 'uk', communityId);

    return yield* proposeAction({ communityId, tgUserId, action, summary });
});

export const confirmAsOwner = Effect.fn('Testing.confirmAsOwner')(function* (communityId: string, action: Action, chatId?: bigint) {
    const actionId = yield* proposeAs(communityId, 42n, action);
    const group = yield* groupFor(communityId, chatId);

    return yield* decideAction({
        actionId,
        tgUserId: 42n,
        confirm: true,
        context: id => Effect.succeed({ communityId: id, timezone: 'Europe/Vienna', group, groupLocale: 'uk', actorPersonId: null })
    });
});
