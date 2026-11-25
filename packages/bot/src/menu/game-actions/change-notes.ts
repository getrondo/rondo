import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { displayOfVenue } from '@rondo/core/actions/describe-action';
import { hasOpenPoll } from '@rondo/core/menu/game-history.repository';
import * as Effect from 'effect/Effect';
import * as Predicate from 'effect/Predicate';

import { menuText, type MenuKey } from '../menu-text';

import type { MenuUser } from '../screen.interface';
import type { Action } from '@rondo/core/actions/action.model';
import type { SessionView } from '@rondo/core/sessions/session.model';

export const afterChange = Effect.fn('Bot.afterChange')(function* (game: SessionView, action: Extract<Action, { _tag: 'update_session' }>) {
    const display = isDefined(action.venueId) ? yield* displayOfVenue(action.venueId, game.communityId) : {};

    return {
        ...game,
        ...display,
        localDate: action.localDate ?? game.localDate,
        localTime: action.localTime ?? game.localTime,
        capacityMax: Predicate.isUndefined(action.capacityMax) ? game.capacityMax : action.capacityMax,
        venueId: action.venueId ?? game.venueId
    };
});

export const changeNotes = Effect.fn('Bot.changeNotes')(function* (
    user: MenuUser,
    game: SessionView,
    change: { readonly action: Extract<Action, { _tag: 'update_session' }>; readonly loud: boolean }
) {
    const { action } = change;
    const changedPlaces = Predicate.isNotUndefined(action.capacityMax) && action.capacityMax !== game.capacityMax;
    const changes: [boolean, MenuKey][] = [
        [isDefined(action.localTime) && action.localTime !== game.localTime, 'oldTime'],
        [isDefined(action.localDate) && action.localDate !== game.localDate, 'oldDate'],
        [isDefined(action.venueId) && action.venueId !== game.venueId, 'oldPlace'],
        [changedPlaces, 'oldPlaces']
    ];
    const stale = changes.filter(([changed]) => changed).map(([, key]) => menuText(user.locale, key));
    const hasPoll = yield* hasOpenPoll(game.id);

    if (!hasPoll || !isNotEmptyArray(stale)) {
        return [];
    }

    const learn = change.loud ? [menuText(user.locale, 'playersLearn')] : [];

    return [[menuText(user.locale, 'staleIn', { what: stale.join(', ') }), ...learn].join(' ')];
});
