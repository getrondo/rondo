import { isDefined } from '@rnw-community/shared';
import { extractPlace } from '@rondo/assistant/extract-place';
import { findVenueByName } from '@rondo/core/venues/venue.service';
import * as Effect from 'effect/Effect';

import { proposeToAdmin } from '../context/propose-to-admin';

import type { TelegramUser } from '@rondo/core/identity/telegram-user';

const propose = Effect.fn('Bot.proposeVenue')(function* (
    communityId: string,
    admin: TelegramUser,
    place: { readonly sessionId: string; readonly text: string }
) {
    const name = yield* extractPlace(place.text);

    if (!isDefined(name)) {
        return;
    }

    const known = yield* findVenueByName(communityId, name);

    if (isDefined(known)) {
        return;
    }

    yield* proposeToAdmin(communityId, admin, { _tag: 'create_venue', name, sessionId: place.sessionId });
});

export const proposeUnknownPlace = (
    communityId: string,
    admin: TelegramUser,
    place: { readonly sessionId: string; readonly text: string }
) => propose(communityId, admin, place).pipe(Effect.tapCause(Effect.logWarning), Effect.ignore);
