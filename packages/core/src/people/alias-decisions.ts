import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { aliasLink } from '@rondo/db/schema/identity.schema';
import { lineupEntry } from '@rondo/db/schema/play.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq, inArray, ne } from 'drizzle-orm';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';

import { ActionFailedError } from '../error/action-failed.error';

import type { Alias } from '../interface/directory.interface';

interface Decision {
    readonly alias: Pick<Alias, 'id' | 'communityId'>;
    readonly personId: string;
    readonly status: 'approved' | 'rejected';
    readonly actorPersonId: string | null;
}

const always = '(,)';

export const recordDecision = Effect.fn('Core.recordDecision')(function* ({ alias, personId, status, actorPersonId }: Decision) {
    const db = yield* Db;
    const decidedAt = yield* DateTime.nowAsDate;

    yield* db.delete(aliasLink).where(and(eq(aliasLink.aliasId, alias.id), eq(aliasLink.personId, personId)));
    yield* db.insert(aliasLink).values({
        communityId: alias.communityId,
        aliasId: alias.id,
        personId,
        during: always,
        method: 'admin',
        status,
        decidedBy: actorPersonId,
        decidedAt
    });
});

export const linkedPersonsOf = Effect.fn('Core.linkedPersonsOf')(function* (alias: Alias) {
    const db = yield* Db;
    const entries = yield* db
        .selectDistinct({ personId: lineupEntry.personId })
        .from(lineupEntry)
        .where(and(eq(lineupEntry.aliasId, alias.id), eq(lineupEntry.isGuest, false), inArray(lineupEntry.resolvedBy, ['vote', 'alias'])));
    const approvals = yield* db
        .selectDistinct({ personId: aliasLink.personId })
        .from(aliasLink)
        .where(and(eq(aliasLink.aliasId, alias.id), eq(aliasLink.status, 'approved')));

    return new Set([...entries, ...approvals].map(({ personId }) => personId).filter(personId => isDefined(personId)));
});

export const requireNoOtherPeriod = Effect.fn('Core.requireNoOtherPeriod')(function* (alias: Alias, personId: string) {
    const db = yield* Db;
    const persons = [...(yield* linkedPersonsOf(alias))].filter(other => other !== personId);
    const isWhole = persons.every(other => other === alias.personId) && alias.resolution === 'vote';
    const approved = yield* db
        .select({ id: aliasLink.id })
        .from(aliasLink)
        .where(and(eq(aliasLink.aliasId, alias.id), eq(aliasLink.status, 'approved'), ne(aliasLink.personId, personId)));

    if (isNotEmptyArray(approved) || (isNotEmptyArray(persons) && !isWhole)) {
        return yield* ActionFailedError.make({ reason: 'another player has a period under this nickname, undo that first' });
    }

    return personId;
});
