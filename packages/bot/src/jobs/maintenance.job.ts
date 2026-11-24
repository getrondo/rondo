import { expireStaleActions } from '@rondo/core/actions/pending-action.service';
import { closePollsOf } from '@rondo/core/signups/signup.service';
import { addMillis } from '@rondo/core/utils/add-millis.util';
import { assistantMessage, processedUpdate } from '@rondo/db/schema/platform.schema';
import { attendance, session, signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, inArray, lt, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

const dayMs = 24 * 60 * 60_000;
const finishAfterMs = 2 * 60 * 60_000;

const finishPastSessions = Effect.fn('Bot.finishPastSessions')(function* (now: Date) {
    const db = yield* Db;
    const finished = yield* db
        .update(session)
        .set({ status: 'played' })
        .where(and(inArray(session.status, ['open', 'full', 'locked']), lt(session.startsAt, addMillis(now, -finishAfterMs))))
        .returning({ id: session.id });

    for (const { id } of finished) {
        yield* db.execute(
            sql`insert into ${attendance} (session_id, person_id, outcome, source)
                select ${signup.sessionId}, ${signup.personId}, 'attended', 'bot' from ${signup}
                where ${signup.sessionId} = ${id} and ${signup.status} = 'in'
                and not exists (select 1 from ${attendance} where ${attendance.sessionId} = ${id})
                on conflict do nothing`
        );
        yield* closePollsOf(id).pipe(Effect.ignore);
    }

    return finished.length;
});

export const runMaintenance = Effect.fn('Bot.runMaintenance')(function* (now: Date) {
    const db = yield* Db;

    yield* expireStaleActions(now);
    const finished = yield* finishPastSessions(now);
    yield* db.delete(processedUpdate).where(lt(processedUpdate.at, addMillis(now, -7 * dayMs)));
    yield* db.delete(assistantMessage).where(lt(assistantMessage.at, addMillis(now, -30 * dayMs)));
    yield* db.execute(sql`select analytics.refresh_all()`);

    return { finished };
});
