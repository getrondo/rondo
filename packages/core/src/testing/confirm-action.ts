import { isDefined } from '@rnw-community/shared';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { describeAction } from '../actions/describe-action';
import { decideAction, proposeAction } from '../actions/pending-action.service';
import { groupLocaleOf, mainGroupOf } from '../community/community.repository';
import { withNotice } from '../notify/notice-preview';
import { publishTeamsAction, type ProposedTeam } from '../teams/team.service';

import { linkGroup } from './link-group';

import type { Action } from '../actions/action.model';

const groupFor = Effect.fn('Testing.groupFor')(function* (communityId: string, chatId?: bigint) {
    const linked = yield* mainGroupOf(communityId);

    if (Option.isNone(linked) && isDefined(chatId)) {
        yield* linkGroup(communityId, { chatId: Number(chatId) });

        return Option.some({ chatId, topicId: null });
    }

    return linked;
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
    const group = yield* groupFor(communityId);
    const context = { communityId, group, groupLocale: yield* groupLocaleOf(communityId) };
    const shown = yield* withNotice(action, context);
    const summary = yield* describeAction(shown, 'uk', communityId);

    return yield* proposeAction({ communityId, tgUserId, action: shown, summary });
});

export const confirmAsOwner = Effect.fn('Testing.confirmAsOwner')(function* (communityId: string, action: Action, chatId?: bigint) {
    const group = yield* groupFor(communityId, chatId);
    const actionId = yield* proposeAs(communityId, 42n, action);

    return yield* decideAction({
        actionId,
        tgUserId: 42n,
        confirm: true,
        context: id => Effect.succeed({ communityId: id, timezone: 'Europe/Vienna', group, groupLocale: 'uk', actorPersonId: null })
    });
});
