import { expireStaleActions, removeActionTexts } from '@rondo/core/actions/pending-action.service';
import { finishPastSessions } from '@rondo/core/sessions/finish-session';
import { closeFinishedPolls } from '@rondo/core/signups/signup.service';
import { addMillis } from '@rondo/core/utils/add-millis.util';
import { assistantMessage, processedUpdate } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { lt, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

const dayMs = 24 * 60 * 60_000;
const closePollsMs = 20_000;
const finishAfterMs = 2 * 60 * 60_000;

export const runMaintenance = Effect.fn('Bot.runMaintenance')(function* (now: Date) {
    const db = yield* Db;

    yield* expireStaleActions(now);
    yield* removeActionTexts(addMillis(now, -30 * dayMs));
    const finished = yield* finishPastSessions(addMillis(now, -finishAfterMs));
    yield* closeFinishedPolls().pipe(Effect.timeoutOption(closePollsMs));
    yield* db.delete(processedUpdate).where(lt(processedUpdate.at, addMillis(now, -7 * dayMs)));
    yield* db.delete(assistantMessage).where(lt(assistantMessage.at, addMillis(now, -30 * dayMs)));
    yield* db.execute(sql`select analytics.refresh_all()`);

    return { finished };
});
