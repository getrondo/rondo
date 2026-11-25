import { isDefined, isNotEmptyString } from '@rnw-community/shared';
import { personIdOfTelegramUser } from '@rondo/core/identity/telegram-user';
import { createVenue, findVenueByName, updateVenue } from '@rondo/core/venues/venue.service';
import * as Effect from 'effect/Effect';

import { parseMapLink } from '../../utils/parse-map-link.util';

import { loadNewGameData } from './new-game.data';
import { applyOp, withVenue } from './new-game.flow';

import type { MenuUser } from '../screen.interface';
import type { Draft, TypedInput } from './draft';

const placeOfName = Effect.fn('Bot.placeOfName')(function* (user: MenuUser, name: string, actorPersonId: string | null) {
    const known = yield* findVenueByName(user.communityId, name);

    if (isDefined(known)) {
        if (known.status !== 'active') {
            yield* updateVenue({ communityId: user.communityId, venueId: known.id, patch: { active: true }, actorPersonId });
        }

        return known.id;
    }

    return yield* createVenue({ communityId: user.communityId, name, actorPersonId });
});

const locate = (input: TypedInput) => {
    if (isDefined(input.location)) {
        return { lat: input.location.lat, lng: input.location.lng };
    }

    const text = input.text?.trim() ?? '';
    const link = parseMapLink(text);

    if (isDefined(link)) {
        return { mapUrl: link.url, ...(isDefined(link.lat) && isDefined(link.lng) ? { lat: link.lat, lng: link.lng } : {}) };
    }

    return /^https?:\/\//iu.test(text) || !isNotEmptyString(text) ? null : { address: text };
};

export const applyPlaceInput = Effect.fn('Bot.applyPlaceInput')(function* (user: MenuUser, draft: Draft, input: TypedInput) {
    const actorPersonId = yield* personIdOfTelegramUser(user.tgUserId);
    const data = yield* loadNewGameData(user);

    if (draft.view === 'venue_name') {
        const name = input.text?.trim() ?? '';

        return yield* placeOfName(user, name, actorPersonId).pipe(
            Effect.map(venueId => {
                const located = data.venues.find(entry => entry.id === venueId)?.located ?? false;
                const known = isDefined(draft.localDate) && isDefined(draft.localTime) && draft.sized;

                return withVenue(draft, venueId, data, located || known ? null : 'map');
            }),
            Effect.catchTag('ActionFailedError', () => Effect.succeed({ ...draft, notice: 'newPlaceName' }))
        );
    }

    const patch = locate(input);

    if (!isDefined(patch) || !isDefined(draft.venueId)) {
        return { ...draft, notice: 'badLink' };
    }

    yield* updateVenue({ communityId: user.communityId, venueId: draft.venueId, patch, actorPersonId });

    return applyOp(draft, 'ms', '', data);
});
