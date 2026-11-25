import { expect, layer } from '@effect/vitest';
import { isEmptyString, isNotEmptyArray } from '@rnw-community/shared';
import { syncMember, upsertTelegramUser } from '@rondo/core/identity/telegram-user';
import { ingestGroupMessage } from '@rondo/core/live/live-ingest';
import { erasePerson } from '@rondo/core/people/erase-person';
import { addGuests } from '@rondo/core/signups/roster.service';
import { localPostgresLayer, raceDatabaseUrl } from '@rondo/core/testing/local-postgres.layer';
import { seedCommunity, seedConfig } from '@rondo/core/testing/seed-community';
import { seedGame } from '@rondo/core/testing/seed-game';
import { person, telegramAccount, telegramAuthor } from '@rondo/db/schema/identity.schema';
import { signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { eq, sql } from 'drizzle-orm';
import * as Deferred from 'effect/Deferred';
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import * as Option from 'effect/Option';
import * as Schedule from 'effect/Schedule';

import { importMessages } from '../src/ingest.effect';

const oldName = 'Old Secret';
const newName = 'New Secret';

const prepare = Effect.fn('test.prepare')(function* (id: bigint) {
    const slug = `erase-race-${performance.now()}`;
    const { communityId } = yield* seedCommunity(seedConfig(slug));
    const personId = yield* syncMember(communityId, { id, firstName: oldName }, 'active');
    const message = ingestGroupMessage(communityId, seedConfig(slug), {
        chatId: -1n,
        isMain: true,
        messageId: 1,
        sentAt: new Date('2025-05-01T09:00:00Z'),
        senderPersonId: personId,
        senderTgUserId: id,
        senderName: newName,
        isTrusted: false,
        text: 'hello'
    });

    return { slug, communityId, personId, message, rename: upsertTelegramUser({ id, firstName: newName }) };
});

// Waits until another session waits for this one
const othersWait = Effect.gen(function* () {
    const db = yield* Db;
    const { rows } = yield* db.execute(
        sql`select 1 from pg_locks waiting where not waiting.granted and pg_backend_pid() = any(pg_blocking_pids(waiting.pid)) limit 1`
    );

    return yield* isNotEmptyArray(rows) ? Effect.void : Effect.fail('nobody waits');
}).pipe(Effect.retry({ schedule: Schedule.spaced('20 millis'), times: 250 }));

// Runs the blocker, starts the rival while its locks are held, then lets it finish
const whileHeld = Effect.fn('test.whileHeld')(function* <First, FirstError, Second, SecondError>(
    first: Effect.Effect<First, FirstError, Db>,
    second: Effect.Effect<Second, SecondError, Db>,
    last: Effect.Effect<unknown, FirstError, Db> = Effect.void
) {
    const db = yield* Db;
    const held = yield* Deferred.make<boolean>();
    const holder = yield* Effect.forkChild(
        db.transaction(() => first.pipe(Effect.andThen(Deferred.succeed(held, true)), Effect.andThen(othersWait), Effect.andThen(last)))
    );
    yield* Deferred.await(held);
    const rival = yield* Effect.forkChild(second);
    yield* Fiber.join(holder);

    return yield* Fiber.join(rival);
});

const namesOf = Effect.fn('test.namesOf')(function* (id: bigint, communityId: string) {
    const db = yield* Db;
    const people = yield* db
        .select({ displayName: person.displayName, firstName: telegramAccount.firstName })
        .from(person)
        .innerJoin(telegramAccount, eq(telegramAccount.personId, person.id))
        .where(eq(telegramAccount.tgUserId, id));
    const authors = yield* db
        .select({ displayName: telegramAuthor.displayName })
        .from(telegramAuthor)
        .where(eq(telegramAuthor.communityId, communityId));

    return [...people.flatMap(({ displayName, firstName }) => [displayName, firstName]), ...authors.map(({ displayName }) => displayName)];
});

const isClean = (names: readonly unknown[]): boolean =>
    isNotEmptyArray(names) && names.every(name => name === 'Former player' || String(name).startsWith('erased '));

const uniqueId = () => BigInt(Math.floor(performance.timeOrigin * 1000 + performance.now() * 1000));

layer(localPostgresLayer(raceDatabaseUrl), { timeout: 60_000, excludeTestServices: true })('erasing a person, on a real Postgres', it => {
    it.effect.skipIf(isEmptyString(raceDatabaseUrl))(
        'waits for a message that holds the account and renames the person, without a deadlock',
        () =>
            Effect.gen(function* () {
                const db = yield* Db;
                const id = uniqueId();
                const { communityId, personId, rename, message } = yield* prepare(id);
                const lockAccount = db.select().from(telegramAccount).where(eq(telegramAccount.tgUserId, id)).for('update');
                yield* whileHeld(lockAccount, erasePerson({ communityId, personId }), rename.pipe(Effect.andThen(message)));

                expect(isClean(yield* namesOf(id, communityId))).toBe(true);
            })
    );

    it.effect.skipIf(isEmptyString(raceDatabaseUrl))(
        'makes an account update and an author record that started meanwhile write nothing',
        () =>
            Effect.gen(function* () {
                for (const part of ['rename', 'message'] as const) {
                    const id = uniqueId();
                    const { communityId, personId, rename, message } = yield* prepare(id);
                    yield* whileHeld(
                        erasePerson({ communityId, personId }),
                        part === 'rename' ? rename.pipe(Effect.asVoid) : message.pipe(Effect.asVoid)
                    );

                    expect(isClean(yield* namesOf(id, communityId))).toBe(true);
                }
            })
    );

    it.effect.skipIf(isEmptyString(raceDatabaseUrl))('takes turns with an import, whichever comes first', () =>
        Effect.gen(function* () {
            for (const isImportFirst of [true, false]) {
                const id = uniqueId();
                const { slug, communityId, personId } = yield* prepare(id);
                const importing = importMessages({
                    config: seedConfig(slug),
                    messages: [
                        {
                            id: 1,
                            kind: 'message',
                            sentAt: new Date('2025-05-01T09:00:00Z'),
                            author: oldName,
                            authorId: Number(id),
                            text: 'hello',
                            media: []
                        }
                    ],
                    fileSha256: 'sha',
                    snapshot: Option.some({
                        users: new Map([
                            [
                                Number(id),
                                { id: Number(id), first: newName, last: newName, username: null, bot: false, deleted: false, member: true }
                            ]
                        ]),
                        pollIdByMessage: new Map(),
                        votes: []
                    })
                }).pipe(Effect.asVoid);
                const erasing = erasePerson({ communityId, personId }).pipe(Effect.asVoid);
                yield* isImportFirst ? whileHeld(importing, erasing) : whileHeld(erasing, importing);

                expect(isClean(yield* namesOf(id, communityId))).toBe(true);
            }
        })
    );

    it.effect.skipIf(isEmptyString(raceDatabaseUrl))('scrubs guests that are added meanwhile, whichever comes first', () =>
        Effect.gen(function* () {
            const db = yield* Db;

            for (const isGuestFirst of [true, false]) {
                const { communityId, sessionId } = yield* seedGame(`erase-race-guests-${performance.now()}`);
                const personId = yield* syncMember(communityId, { id: uniqueId(), firstName: oldName }, 'active');
                yield* db.insert(signup).values({ sessionId, personId, status: 'in' });
                const adding = addGuests(
                    { communityId, sessionId, actorPersonId: null },
                    { hostPersonId: personId, count: 1, name: null }
                ).pipe(Effect.asVoid);
                const erasing = erasePerson({ communityId, personId }).pipe(Effect.asVoid);
                yield* isGuestFirst ? whileHeld(adding, erasing) : whileHeld(erasing, adding);
                const guests = yield* db
                    .select({ name: person.displayName })
                    .from(person)
                    .where(sql`${person.id} in (select person_id from scheduling.signup where guest_of_person_id = ${personId}::uuid)`);

                expect(guests).toEqual([{ name: 'Former player +1' }]);
            }
        })
    );
});
