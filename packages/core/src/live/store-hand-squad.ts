import * as Effect from 'effect/Effect';

import { storeLineup } from '../roster/store-lineup';
import { isPublishing } from '../teams/publish-claim';
import { reseedDraft } from '../teams/team-draft.service';
import { hasResult } from '../teams/team-result';

// The teams of a recorded result, and those being sent right now, are not replaced by a squad typed in a chat
export const isSquadFixed = Effect.fn('Core.isSquadFixed')(function* (sessionId: string) {
    return (yield* hasResult(sessionId)) || (yield* isPublishing(sessionId));
});

// A squad posted in a chat is stored, and an open draft starts again from it
export const storeHandSquad = Effect.fn('Core.storeHandSquad')(function* (input: Parameters<typeof storeLineup>[0]) {
    yield* storeLineup(input);
    yield* reseedDraft(input.communityId, input.sessionId);
});
