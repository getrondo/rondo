import { isNotEmptyArray } from '@rnw-community/shared';
import { lineupEntry, teamMember } from '@rondo/db/schema/play.schema';
import { attendance, session, sessionChange, signup } from '@rondo/db/schema/scheduling.schema';
import { and, eq, gt, inArray, notExists } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { TooManyRemovedGamesError } from '../error/too-many-removed-games.error';

import type { LoadContext } from '../interface/load-context.interface';

const maxRemovedShare = 0.05;

const isManualIn = (sessionId: typeof session.id) => and(eq(lineupEntry.sessionId, sessionId), eq(lineupEntry.resolvedBy, 'manual'));

export const deleteStaleSessions = Effect.fn('IngestTelegram.deleteStaleSessions')(function* (
    { transaction, communityId, allowRemoval }: LoadContext,
    currentIds: ReadonlySet<string>,
    withoutSquad: ReadonlySet<string>
) {
    const imported = yield* transaction.$count(session, and(eq(session.communityId, communityId), eq(session.source, 'import')));
    const stored = yield* transaction
        .select({ id: session.id, date: session.localDate })
        .from(session)
        .where(
            and(
                eq(session.communityId, communityId),
                eq(session.source, 'import'),
                notExists(transaction.select().from(lineupEntry).where(isManualIn(session.id))),
                notExists(
                    transaction
                        .select()
                        .from(teamMember)
                        .where(and(eq(teamMember.sessionId, session.id), eq(teamMember.assignedBy, 'balancer')))
                ),
                notExists(transaction.select().from(sessionChange).where(eq(sessionChange.sessionId, session.id))),
                notExists(transaction.select().from(signup).where(eq(signup.sessionId, session.id))),
                notExists(
                    transaction
                        .select()
                        .from(attendance)
                        .where(and(eq(attendance.sessionId, session.id), eq(attendance.source, 'manual')))
                )
            )
        );
    const stale = stored.filter(({ id }) => !currentIds.has(id));
    const staleIds = stale.map(({ id }) => id);
    const squads = yield* transaction
        .selectDistinct({ id: session.id, date: session.localDate })
        .from(lineupEntry)
        .innerJoin(session, eq(session.id, lineupEntry.sessionId))
        .where(and(eq(session.communityId, communityId), gt(lineupEntry.teamOrdinal, 0)));
    const lost = squads.filter(({ id }) => withoutSquad.has(id) || staleIds.includes(id));
    const isTooMany = stale.length > imported * maxRemovedShare || lost.length > squads.length * maxRemovedShare;

    if (allowRemoval !== true && isTooMany) {
        const dates = [...new Set([...stale, ...lost].map(({ date }) => date))].toSorted();

        return yield* TooManyRemovedGamesError.make({ dates, imported });
    }

    if (isNotEmptyArray(staleIds)) {
        yield* transaction.delete(session).where(inArray(session.id, staleIds));
    }

    return stale.length;
});
