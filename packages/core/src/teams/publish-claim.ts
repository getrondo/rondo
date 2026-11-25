import { isDefined } from '@rnw-community/shared';
import { teamDraft } from '@rondo/db/schema/play.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq, gt, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';

import { addMillis } from '../utils/add-millis.util';

export const busyMs = 60_000;

export const claimPublish = Effect.fn('Core.claimPublish')(function* (sessionId: string, now: Date) {
    const db = yield* Db;
    const [claimed] = yield* db
        .update(teamDraft)
        .set({ publishToken: sql`gen_random_uuid()`, publishAt: now })
        .where(
            and(eq(teamDraft.sessionId, sessionId), or(isNull(teamDraft.publishToken), lte(teamDraft.publishAt, addMillis(now, -busyMs))))
        )
        .returning({ token: teamDraft.publishToken });

    return claimed?.token ?? null;
});

export const ownPublish = (sessionId: string, token: string) => and(eq(teamDraft.sessionId, sessionId), eq(teamDraft.publishToken, token));

export const isPublishing = Effect.fn('Core.isPublishing')(function* (sessionId: string) {
    const db = yield* Db;
    const now = yield* DateTime.nowAsDate;
    const [busy] = yield* db
        .select({ sessionId: teamDraft.sessionId })
        .from(teamDraft)
        .where(
            and(eq(teamDraft.sessionId, sessionId), isNotNull(teamDraft.publishToken), gt(teamDraft.publishAt, addMillis(now, -busyMs)))
        );

    return isDefined(busy);
});
