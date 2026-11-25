import { isDefined } from '@rnw-community/shared';
import { badges } from '@rondo/core/teams/badges';
import { playersOf } from '@rondo/core/teams/draft-state';
import { setHomeColour, setTier } from '@rondo/core/teams/team.service';
import * as Effect from 'effect/Effect';

import { editorScreen } from './teams-editor.screen';
import { settingsScreen } from './teams-screens';
import { actorOf, loadView } from './teams-view';

import type { MenuUser } from '../screen.interface';
import type { TeamsTap } from './teams-callback';
import type { EditorView } from './teams-view.interface';
import type { Tier } from '@rondo/core/teams/interface/team-inputs.interface';

const nextTier: Readonly<Record<Tier | 'none', Tier>> = { none: 'normal', normal: 'strong', strong: 'new', new: 'normal' };

export const tierTap = Effect.fn('Bot.teamsTier')(function* (user: MenuUser, view: EditorView, tap: TeamsTap) {
    const personId = playersOf(view.row.state)[Number(tap.args[0])];
    const member = view.inputs.members.find(entry => entry.personId === personId);

    if (isDefined(member) && !member.isGuest) {
        yield* setTier({
            communityId: user.communityId,
            personId: member.personId,
            tier: nextTier[member.tier ?? 'none'],
            actorPersonId: yield* actorOf(user)
        });
    }

    const fresh = yield* loadView(user, tap.sessionId, { page: tap.page });

    return settingsScreen(user, fresh);
});

export const homeColourTap = Effect.fn('Bot.teamsHomeColour')(function* (user: MenuUser, view: EditorView, tap: TeamsTap) {
    const personId = playersOf(view.row.state)[Number(tap.args[0])] ?? null;

    if (isDefined(personId) && view.inputs.affinities.has(personId)) {
        yield* setHomeColour({
            communityId: user.communityId,
            personId,
            colour: badges[Number(tap.args[1])]?.colour ?? null,
            actorPersonId: yield* actorOf(user)
        });
    }

    const fresh = yield* loadView(user, tap.sessionId, { page: tap.page });

    return editorScreen(user, { ...fresh, selected: personId });
});
