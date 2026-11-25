import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { gamesNearStart, pendingNotices } from '@rondo/core/teams/team-schedule';
import * as Effect from 'effect/Effect';

import { tellExpired } from '../menu/groups/approval';
import { notifyRosterChange, proposeTeamsFor } from '../menu/teams/teams-notify';

import { notifyOwnersOfFailure } from './notify-owners';

const teamsTick = Effect.fn('Bot.teamsTick')(function* (now: Date) {
    const games = yield* gamesNearStart(now);

    if (!isNotEmptyArray(games)) {
        return { games: 0, proposed: 0, noticed: 0, failed: 0 };
    }

    let proposed = 0;
    let noticed = 0;
    let failed = 0;

    for (const game of games) {
        const outcome = yield* proposeTeamsFor(game, now).pipe(
            Effect.catchCause(cause => Effect.logError('[teams] proposal failed', cause).pipe(Effect.as('failed')))
        );
        proposed += outcome === 'proposed' ? 1 : 0;
        failed += outcome === 'failed' ? 1 : 0;
    }

    for (const { sessionId } of yield* pendingNotices(games.map(game => game.id))) {
        const isSent = yield* notifyRosterChange(sessionId, now).pipe(
            Effect.catchCause(cause => Effect.logError('[teams] notice failed', cause).pipe(Effect.as(null)))
        );
        noticed += isSent === true ? 1 : 0;
        failed += isDefined(isSent) ? 0 : 1;
    }

    return { games: games.length, proposed, noticed, failed };
});

export const runTeamsTick = (now: Date) =>
    tellExpired(now).pipe(
        Effect.catchCause(cause => Effect.logError('[approval] expired requests not told', cause)),
        Effect.andThen(teamsTick(now)),
        Effect.tap(({ failed }) => notifyOwnersOfFailure('ownerTeamsFailed', failed, now)),
        Effect.tapCause(() => notifyOwnersOfFailure('ownerTeamsFailed', 1, now))
    );
