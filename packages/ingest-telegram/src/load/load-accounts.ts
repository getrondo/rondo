import { isDefined, isNotEmptyString } from '@rnw-community/shared';
import { person, telegramAccount } from '@rondo/db/schema/identity.schema';
import { membership } from '@rondo/db/schema/org.schema';
import { and, inArray, not, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { releaseUsernames } from '../identity/release-usernames';
import { chunks } from '../utils/chunks.util';
import { insertMany } from '../utils/insert-many.util';

import type { LoadContext } from '../interface/load-context.interface';

const unnamed = 'Deleted account';

const collectAccounts = ({ plan, snapshot }: LoadContext) => {
    const factById = new Map(plan.facts.accounts.map(fact => [fact.userId, fact]));
    const ids = new Set([...factById.keys(), ...(snapshot?.votes ?? []).map(vote => vote.userId)]);

    return [...ids].flatMap(userId => {
        const fact = factById.get(userId);
        const user = snapshot?.users.get(userId);

        return user?.bot === true
            ? []
            : [
                  {
                      tgUserId: BigInt(userId),
                      firstName: [user?.first, fact?.displayName].find(name => isNotEmptyString(name)) ?? unnamed,
                      lastName: isNotEmptyString(user?.last) ? user.last : null,
                      username: isNotEmptyString(user?.username) ? user.username : null,
                      firstSeenAt: fact?.firstSeenAt,
                      lastSeenAt: fact?.lastSeenAt,
                      member: user?.member === true
                  }
              ];
    });
};

export const loadAccounts = Effect.fn('IngestTelegram.loadAccounts')(function* (context: LoadContext) {
    const { transaction, communityId, snapshot } = context;
    const accounts = collectAccounts(context);

    yield* releaseUsernames(accounts.flatMap(({ username }) => (isDefined(username) ? [username] : [])));
    yield* insertMany(accounts, batch =>
        transaction
            .insert(telegramAccount)
            .values(batch.map(({ member, ...account }) => account))
            .onConflictDoUpdate({
                target: telegramAccount.tgUserId,
                set: {
                    firstSeenAt: sql`least(${telegramAccount.firstSeenAt}, excluded.first_seen_at)`,
                    lastSeenAt: sql`greatest(${telegramAccount.lastSeenAt}, excluded.last_seen_at)`,
                    ...(isDefined(snapshot)
                        ? {
                              firstName: sql`excluded.first_name`,
                              lastName: sql`excluded.last_name`,
                              username: sql`excluded.username`
                          }
                        : {})
                }
            })
    );

    const stored = yield* transaction
        .select()
        .from(telegramAccount)
        .where(
            inArray(
                telegramAccount.tgUserId,
                accounts.map(account => account.tgUserId)
            )
        );
    const personIdByAccount = new Map(stored.map(row => [row.tgUserId, row.personId]));

    for (const batch of chunks(stored.filter(row => !isDefined(row.personId)))) {
        const people = yield* transaction
            .insert(person)
            .values(
                batch.map(({ firstName, lastName }) => ({
                    displayName: [firstName, lastName].filter(part => isNotEmptyString(part)).join(' '),
                    source: 'import' as const
                }))
            )
            .returning({ id: person.id });

        for (const [index, { tgUserId }] of batch.entries()) {
            const personId = people[index]?.id ?? '';
            personIdByAccount.set(tgUserId, personId);
            yield* transaction
                .update(telegramAccount)
                .set({ personId })
                .where(sql`${telegramAccount.tgUserId} = ${tgUserId}`);
        }
    }

    if (isDefined(snapshot)) {
        const activeByPerson = new Map<string, boolean>();

        for (const { tgUserId, member } of accounts) {
            const personId = personIdByAccount.get(tgUserId) ?? '';
            activeByPerson.set(personId, member || activeByPerson.get(personId) === true);
        }

        yield* insertMany([...activeByPerson], batch =>
            transaction
                .insert(membership)
                .values(
                    batch.map(([personId, active]) => ({ communityId, personId, status: active ? ('active' as const) : ('left' as const) }))
                )
                .onConflictDoUpdate({
                    target: [membership.communityId, membership.personId],
                    set: { status: sql`excluded.status` },
                    setWhere: not(and(sql`${membership.status} = 'removed'`, sql`excluded.status = 'left'`) ?? sql`false`)
                })
        );
    }

    return accounts.length;
});
