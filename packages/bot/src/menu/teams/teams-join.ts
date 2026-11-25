import { isDefined } from '@rnw-community/shared';
import { joinGame, waitingOf } from '@rondo/core/signups/roster.service';
import { syncByAdmin } from '@rondo/core/teams/draft-state';
import { lookupName } from '@rondo/core/teams/paste-lineup';
import { changeDraft, goalkeepersOf, rebalanced } from '@rondo/core/teams/team-draft.service';
import { loadTeamInputs } from '@rondo/core/teams/team-inputs';
import { escapeHtml } from '@rondo/telegram/format/html';
import * as Effect from 'effect/Effect';

import { toShortId } from '../../utils/to-short-id.util';

import { editorScreen } from './teams-editor.screen';
import { fullAsk, joinersScreen } from './teams-screens';
import { teamsText } from './teams-text';
import { actorOf, loadView, showTeams } from './teams-view';

import type { MenuUser } from '../screen.interface';

// A name typed after «Інший» means a member when it matches one: joined (or asked about a full game), several are offered
export const joinTyped = Effect.fn('Bot.joinTyped')(function* (user: MenuUser, sessionId: string, name: string) {
    const found = yield* lookupName(user.communityId, sessionId, name);
    const playing = found.find(entry => entry.isPlaying);
    const [only] = found;

    if (!isDefined(only)) {
        return false;
    }

    const view = yield* loadView(user, sessionId);

    if (isDefined(playing) || found.length > 1) {
        const notes = isDefined(playing) ? [teamsText(user.locale, 'alreadyIn', { name: escapeHtml(playing.displayName) })] : [];
        const screen = isDefined(playing) ? editorScreen(user, { ...view, notes }) : joinersScreen(user, view, found);
        yield* showTeams(user, null, { sessionId, screen });

        return true;
    }

    const { taken } = yield* waitingOf(sessionId);
    const limit = view.inputs.game.capacityMax;

    if (isDefined(limit) && taken + 1 > limit) {
        const args = [toShortId(only.personId)];
        yield* showTeams(user, null, { sessionId, screen: fullAsk(user, view, { who: only.displayName, taken, limit, op: 'J', args }) });

        return true;
    }

    const actorPersonId = yield* actorOf(user);
    yield* joinGame({ communityId: user.communityId, sessionId, actorPersonId }, [only.personId]);
    const inputs = yield* loadTeamInputs(user.communityId, sessionId);
    const roster = inputs.members.map(member => member.personId);
    yield* changeDraft({ sessionId, version: view.row.version, key: `${user.tgUserId}:join:${view.row.version}`, actorPersonId }, state =>
        Effect.succeed(rebalanced(inputs, syncByAdmin(state, roster, goalkeepersOf(inputs))))
    );
    const fresh = yield* loadView(user, sessionId, {
        notes: [teamsText(user.locale, 'guestsAdded', { names: escapeHtml(only.displayName) })]
    });
    yield* showTeams(user, null, { sessionId, screen: editorScreen(user, fresh) });

    return true;
});
