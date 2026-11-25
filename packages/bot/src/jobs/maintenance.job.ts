import { removeActionTexts } from '@rondo/core/actions/pending-action.service';
import { finishPastSessions } from '@rondo/core/sessions/finish-session';
import { closeFinishedPolls } from '@rondo/core/signups/signup.service';
import { addMillis } from '@rondo/core/utils/add-millis.util';
import { assistantMessage, processedUpdate } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, count, gt, gte, isNull, lt, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { maxAttempts } from '../handle-update';
import { tellExpired } from '../menu/groups/approval';

import { notifyOwnersOfFailure } from './notify-owners';

const dayMs = 24 * 60 * 60_000;
const closePollsMs = 20_000;
const finishAfterMs = 2 * 60 * 60_000;

const droppedUpdates = Effect.fn('Bot.droppedUpdates')(function* (now: Date) {
    const db = yield* Db;
    const [row] = yield* db
        .select({ dropped: count() })
        .from(processedUpdate)
        .where(
            and(isNull(processedUpdate.doneAt), gte(processedUpdate.attempts, maxAttempts), gt(processedUpdate.at, addMillis(now, -dayMs)))
        );

    return row?.dropped ?? 0;
});

const isDone = <Value, Failure, Requirements>(name: string, step: Effect.Effect<Value, Failure, Requirements>) =>
    step.pipe(
        Effect.as(true),
        Effect.catchCause(cause => Effect.logError(`[maintenance] ${name} failed`, cause).pipe(Effect.as(false)))
    );

export const runMaintenance = Effect.fn('Bot.runMaintenance')(function* (now: Date) {
    const db = yield* Db;
    const before = yield* Effect.all([
        isDone('expiry of proposals', tellExpired(now)),
        isDone('removal of proposal texts', removeActionTexts(addMillis(now, -30 * dayMs)))
    ]);
    const games = yield* finishPastSessions(addMillis(now, -finishAfterMs)).pipe(
        Effect.catchCause(cause => Effect.logError('[maintenance] end of games failed', cause).pipe(Effect.as({ finished: 0, failed: 1 })))
    );
    const after = yield* Effect.all([
        isDone('close of polls', closeFinishedPolls().pipe(Effect.timeoutOption(closePollsMs))),
        isDone(
            'notice of dropped updates',
            droppedUpdates(now).pipe(Effect.flatMap(dropped => notifyOwnersOfFailure('ownerDroppedUpdates', dropped, now)))
        ),
        isDone('removal of updates', db.delete(processedUpdate).where(lt(processedUpdate.at, addMillis(now, -7 * dayMs)))),
        isDone('removal of the assistant history', db.delete(assistantMessage).where(lt(assistantMessage.at, addMillis(now, -30 * dayMs)))),
        isDone('refresh of statistics', db.execute(sql`select analytics.refresh_all()`))
    ]);
    const failed = games.failed + [...before, ...after].filter(done => !done).length;

    yield* notifyOwnersOfFailure('ownerMaintenanceFailed', failed, now);

    return { finished: games.finished, failed };
});
