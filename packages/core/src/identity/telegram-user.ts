import { isDefined, isNotEmptyString } from '@rnw-community/shared';
import { person, telegramAccount } from '@rondo/db/schema/identity.schema';
import { membership } from '@rondo/db/schema/org.schema';
import { Db } from '@rondo/db/service/db.service';
import { eq, sql } from 'drizzle-orm';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';

import { resolveLocale } from '../i18n/locale';

export interface TelegramUser {
    readonly id: bigint;
    readonly firstName: string;
    readonly lastName?: string;
    readonly username?: string;
    readonly languageCode?: string;
}

export const displayNameOf = (user: TelegramUser): string =>
    [user.firstName, user.lastName].filter(part => isNotEmptyString(part)).join(' ');

export const upsertTelegramUser = Effect.fn('Core.upsertTelegramUser')(function* (user: TelegramUser) {
    const db = yield* Db;

    return yield* db.transaction(transaction =>
        Effect.gen(function* () {
            const [account] = yield* transaction
                .insert(telegramAccount)
                .values({
                    tgUserId: user.id,
                    username: user.username,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    languageCode: user.languageCode
                })
                .onConflictDoUpdate({
                    target: telegramAccount.tgUserId,
                    set: {
                        username: user.username ?? null,
                        firstName: user.firstName,
                        lastName: user.lastName ?? null,
                        languageCode: user.languageCode ?? null,
                        lastSeenAt: sql`now()`
                    }
                })
                .returning({ personId: telegramAccount.personId });

            if (isDefined(account?.personId)) {
                return account.personId;
            }

            const [created] = yield* transaction
                .insert(person)
                .values({ displayName: displayNameOf(user), locale: resolveLocale(user.languageCode), source: 'bot' })
                .returning({ id: person.id });
            const personId = created?.id ?? '';
            yield* transaction.update(telegramAccount).set({ personId }).where(eq(telegramAccount.tgUserId, user.id));

            return personId;
        })
    );
});

export const ensureMembership = Effect.fn('Core.ensureMembership')(function* (communityId: string, personId: string) {
    const db = yield* Db;

    const joinedAt = yield* DateTime.nowAsDate;

    yield* db.insert(membership).values({ communityId, personId, joinedAt }).onConflictDoNothing();
});

export const personIdOfTelegramUser = Effect.fn('Core.personIdOfTelegramUser')(function* (tgUserId: bigint) {
    const db = yield* Db;
    const [row] = yield* db
        .select({ personId: telegramAccount.personId })
        .from(telegramAccount)
        .where(eq(telegramAccount.tgUserId, tgUserId));

    return row?.personId ?? null;
});
