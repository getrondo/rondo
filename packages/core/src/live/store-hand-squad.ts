import * as Effect from 'effect/Effect';

import { storeLineup } from '../roster/store-lineup';
import { reseedDraft } from '../teams/team-draft.service';

// A squad posted in a chat is stored, and an open draft starts again from it
export const storeHandSquad = Effect.fn('Core.storeHandSquad')(function* (input: Parameters<typeof storeLineup>[0]) {
    yield* storeLineup(input);
    yield* reseedDraft(input.communityId, input.sessionId);
});
