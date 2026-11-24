import { isDefined } from '@rnw-community/shared';
import { aliasLink, personAlias } from '@rondo/db/schema/identity.schema';
import { lineupEntry } from '@rondo/db/schema/play.schema';
import { session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, asc, eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { insertMany } from '../utils/insert-many.util';

import { dayRange, rangesOf, type DatedLink } from './link-ranges';

export const storeAutoLinks = Effect.fn('IngestTelegram.storeAutoLinks')(function* (
    communityId: string,
    scores: ReadonlyMap<string, number>
) {
    const db = yield* Db;
    const entries = yield* db
        .select({
            aliasId: personAlias.id,
            kind: personAlias.kind,
            personId: lineupEntry.personId,
            resolvedBy: lineupEntry.resolvedBy,
            date: session.localDate
        })
        .from(lineupEntry)
        .innerJoin(personAlias, eq(personAlias.id, lineupEntry.aliasId))
        .innerJoin(session, eq(session.id, lineupEntry.sessionId))
        .where(and(eq(personAlias.communityId, communityId), eq(lineupEntry.isGuest, false)))
        .orderBy(asc(session.localDate));
    const timelines = new Map<string, DatedLink[]>();
    const shared = new Set<string>();

    for (const { aliasId, kind, personId, resolvedBy, date } of entries) {
        timelines.set(aliasId, [...(timelines.get(aliasId) ?? []), { date, personId: resolvedBy === 'vote' ? personId : null }]);

        if (kind === 'placeholder') {
            shared.add(aliasId);
        }
    }

    const rows = [...timelines].flatMap(([aliasId, timeline]) => {
        const isShared = shared.has(aliasId);
        const links = isShared
            ? timeline.flatMap(({ date, personId }) => (isDefined(personId) ? [{ personId, during: dayRange(date, date) }] : []))
            : rangesOf(timeline);

        return links.map(({ personId, during }) => ({
            communityId,
            aliasId,
            personId,
            during,
            method: isShared ? ('shared_vote' as const) : ('vote' as const),
            confidence: scores.get(`${aliasId}|${personId}`) ?? null,
            status: 'auto' as const
        }));
    });

    yield* db.delete(aliasLink).where(and(eq(aliasLink.communityId, communityId), eq(aliasLink.status, 'auto')));
    yield* insertMany(rows, batch => db.insert(aliasLink).values(batch).onConflictDoNothing());

    return rows.length;
});
