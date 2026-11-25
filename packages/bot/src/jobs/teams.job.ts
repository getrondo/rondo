import { isNotEmptyArray } from '@rnw-community/shared';
import { gamesNearStart, pendingNotices } from '@rondo/core/teams/team-schedule';
import * as Effect from 'effect/Effect';

import { notifyRosterChange, proposeTeamsFor } from '../menu/teams/teams-notify';

export const runTeamsTick = Effect.fn('Bot.runTeamsTick')(function* (now: Date) {
    const games = yield* gamesNearStart(now);

    if (!isNotEmptyArray(games)) {
        return { games: 0, proposed: 0, noticed: 0 };
    }

    let proposed = 0;
    let noticed = 0;

    for (const game of games) {
        const outcome = yield* proposeTeamsFor(game, now).pipe(
            Effect.catchCause(cause => Effect.logError('[teams] proposal failed', cause).pipe(Effect.as('failed')))
        );
        proposed += outcome === 'proposed' ? 1 : 0;
    }

    for (const { sessionId } of yield* pendingNotices(games.map(game => game.id))) {
        const isSent = yield* notifyRosterChange(sessionId, now).pipe(
            Effect.catchCause(cause => Effect.logError('[teams] notice failed', cause).pipe(Effect.as(false)))
        );
        noticed += isSent ? 1 : 0;
    }

    return { games: games.length, proposed, noticed };
});
