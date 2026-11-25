import { isDefined } from '@rnw-community/shared';
import { erasedKey, isErasedKey, maskLineups } from '@rondo/core/identity/mask-erased';
import { person, telegramAccount, telegramAuthor } from '@rondo/db/schema/identity.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import type { ImportPlan } from '../extract/assemble-plan';
import type { TelegramSnapshot } from '@rondo/core/model/telegram-snapshot.model';

export const maskErased = Effect.fn('IngestTelegram.maskErased')(function* (
    communityId: string,
    plan: ImportPlan,
    snapshot: TelegramSnapshot | undefined
) {
    const db = yield* Db;
    const accounts = yield* db
        .select({ tgUserId: telegramAccount.tgUserId })
        .from(telegramAccount)
        .innerJoin(person, eq(person.id, telegramAccount.personId))
        .where(isNotNull(person.anonymizedAt));
    const authors = yield* db
        .select({ key: telegramAuthor.displayName })
        .from(telegramAuthor)
        .where(and(eq(telegramAuthor.communityId, communityId), isErasedKey(telegramAuthor.displayName)));
    const lineups = yield* maskLineups(
        communityId,
        plan.sessions.flatMap(({ lineup }) => (isDefined(lineup) ? [lineup] : []))
    );
    const lineupOf = new Map(lineups.map(lineup => [lineup.messageId, lineup]));
    const ids = new Set(accounts.map(({ tgUserId }) => Number(tgUserId)));
    const names = new Set(plan.facts.accounts.filter(({ userId }) => ids.has(userId)).map(({ displayName }) => displayName));

    // An earlier name of an erased account, stored by an import without ids
    yield* db
        .delete(telegramAuthor)
        .where(
            and(
                eq(telegramAuthor.communityId, communityId),
                isNull(telegramAuthor.tgUserId),
                isNull(telegramAuthor.personId),
                inArray(telegramAuthor.displayName, [...names])
            )
        );
    const keys = new Set(authors.map(({ key }) => key));

    return {
        plan: {
            ...plan,
            sessions: plan.sessions.map(planned =>
                isDefined(planned.lineup) ? { ...planned, lineup: lineupOf.get(planned.lineup.messageId) } : planned
            ),
            facts: {
                ...plan.facts,
                authors: plan.facts.authors.filter(
                    ({ displayName }) => !names.has(displayName) && !keys.has(erasedKey(communityId, displayName))
                )
            }
        },
        snapshot: isDefined(snapshot) ? { ...snapshot, users: new Map([...snapshot.users].filter(([id]) => !ids.has(id))) } : snapshot
    };
});
