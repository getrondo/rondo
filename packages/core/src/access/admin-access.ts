import { isDefined, isEmptyArray } from '@rnw-community/shared';
import { telegramAccount } from '@rondo/db/schema/identity.schema';
import { community, roleGrant } from '@rondo/db/schema/org.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq, inArray, sql } from 'drizzle-orm';
import * as Config from 'effect/Config';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';

const adminRoles = ['owner', 'organizer'] as const;

export interface AccessPolicy {
    readonly ownerTgUserIds: ReadonlySet<bigint>;
}

const parseIds = (raw: string): ReadonlySet<bigint> =>
    new Set(
        raw
            .split(',')
            .map(part => part.trim())
            .filter(part => /^\d+$/u.test(part))
            .map(BigInt)
    );

export class Access extends Context.Service<Access, AccessPolicy>()('@rondo/core/Access') {
    static readonly layer = Layer.effect(
        Access,
        Effect.gen(function* () {
            const raw = yield* Config.String('RONDO_OWNER_TG_USER_IDS').pipe(Config.withDefault(''));

            return { ownerTgUserIds: parseIds(raw) };
        })
    );

    static readonly layerFor = (ownerTgUserIds: readonly bigint[]) => Layer.succeed(Access, { ownerTgUserIds: new Set(ownerTgUserIds) });
}

export const adminCommunityIds = Effect.fn('Core.adminCommunityIds')(function* (tgUserId: bigint) {
    const db = yield* Db;
    const access = yield* Access;

    if (access.ownerTgUserIds.has(tgUserId)) {
        const all = yield* db.select({ id: community.id }).from(community);

        return all.map(row => row.id);
    }

    const rows = yield* db
        .selectDistinct({ communityId: roleGrant.communityId })
        .from(roleGrant)
        .innerJoin(telegramAccount, eq(telegramAccount.personId, roleGrant.personId))
        .where(and(eq(telegramAccount.tgUserId, tgUserId), inArray(roleGrant.role, adminRoles), sql`${roleGrant.valid} @> now()`));

    return rows.map(row => row.communityId);
});

export const isAdminOf = Effect.fn('Core.isAdminOf')(function* (tgUserId: bigint, communityId: string) {
    const ids = yield* adminCommunityIds(tgUserId);

    return ids.includes(communityId);
});

export const grantAdmin = Effect.fn('Core.grantAdmin')(function* (input: {
    readonly communityId: string;
    readonly personId: string;
    readonly grantedBy: string | null;
}) {
    const db = yield* Db;
    const existing = yield* db
        .select({ id: roleGrant.id })
        .from(roleGrant)
        .where(
            and(
                eq(roleGrant.communityId, input.communityId),
                eq(roleGrant.personId, input.personId),
                eq(roleGrant.role, 'organizer'),
                sql`${roleGrant.valid} @> now()`
            )
        );

    if (isEmptyArray(existing)) {
        yield* db
            .insert(roleGrant)
            .values({ communityId: input.communityId, personId: input.personId, role: 'organizer', grantedBy: input.grantedBy });
    }
});

export const adminPersonIds = Effect.fn('Core.adminPersonIds')(function* (communityId: string) {
    const db = yield* Db;
    const access = yield* Access;
    const granted = yield* db
        .select({ personId: roleGrant.personId })
        .from(roleGrant)
        .where(and(eq(roleGrant.communityId, communityId), inArray(roleGrant.role, adminRoles), sql`${roleGrant.valid} @> now()`));
    const owners = isEmptyArray([...access.ownerTgUserIds])
        ? []
        : yield* db
              .select({ personId: telegramAccount.personId })
              .from(telegramAccount)
              .where(inArray(telegramAccount.tgUserId, [...access.ownerTgUserIds]));

    return new Set([...granted, ...owners].map(row => row.personId).filter(personId => isDefined(personId)));
});
