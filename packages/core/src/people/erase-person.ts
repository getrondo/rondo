import { isDefined, isEmptyArray, isNotEmptyString } from '@rnw-community/shared';
import { person, personAlias, telegramAccount, telegramAuthor } from '@rondo/db/schema/identity.schema';
import { membership, roleGrant } from '@rondo/db/schema/org.schema';
import { adminState, assistantMessage, pendingAction } from '@rondo/db/schema/platform.schema';
import { lineupDelivery, lineupEntry } from '@rondo/db/schema/play.schema';
import { Db } from '@rondo/db/service/db.service';
import { withCommunityLock } from '@rondo/db/service/with-community-lock';
import { and, eq, inArray, isNotNull, isNull, ne, not, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';

import { recordAudit } from '../audit/record-audit';
import { ActionFailedError } from '../error/action-failed.error';
import { ErasePreviewError } from '../error/erase-preview.error';
import { normalizeAlias } from '../extract/normalize';
import { erasedKey, erasedName, isErasedKey, scrubErasedEntries } from '../identity/mask-erased';

import { arePeopleOf } from './people.service';

interface Erasure {
    readonly communityId: string;
    readonly personId: string;
}

const minSearchedLength = 3;

const mentions = (column: AnyColumn, texts: readonly string[]) =>
    or(...texts.map(text => sql`strpos(lower(${column}::text), lower(${text})) > 0`));

const mergedInto = (personId: string) => sql`(
    with recursive merged as (
        select ${personId}::uuid as id union select gone.id from identity.person gone join merged on gone.merged_into_person_id = merged.id
    ) select id from merged
)`;

// A nickname another player is known by too stays: it is that player's name as well
const ownNicknames = Effect.fn('Core.ownNicknames')(function* (personIds: readonly string[]) {
    const db = yield* Db;
    const ids = sql.param([...personIds]);
    const isOwn = sql`= any(${ids}::uuid[])`;
    const isOther = (column: SQL) => sql`${column} <> all(${ids}::uuid[]) and ${column} is distinct from ${personAlias.guestPersonId}`;

    return yield* db
        .select()
        .from(personAlias)
        .where(
            and(
                eq(personAlias.kind, 'nickname'),
                not(isErasedKey(personAlias.aliasNorm)),
                sql`(${personAlias.personId} ${isOwn}
                    or exists (select 1 from identity.alias_link link where link.alias_id = ${personAlias.id} and link.status = 'approved' and link.person_id ${isOwn})
                    or exists (select 1 from play.lineup_entry entry where entry.alias_id = ${personAlias.id} and entry.person_id ${isOwn}))`,
                sql`not exists (select 1 from identity.alias_link link where link.alias_id = ${personAlias.id} and link.status = 'approved'
                    and ${isOther(sql`link.person_id`)})`,
                sql`not exists (select 1 from play.lineup_entry entry where entry.alias_id = ${personAlias.id} and entry.resolved_by <> 'manual'
                    and ${isOther(sql`entry.person_id`)})`
            )
        );
});

const maskNickname = Effect.fn('Core.maskNickname')(function* ({
    id,
    communityId,
    aliasNorm,
    guestPersonId
}: typeof personAlias.$inferSelect) {
    const db = yield* Db;
    const key = erasedKey(communityId, aliasNorm);
    const anonymizedAt = yield* DateTime.nowAsDate;

    yield* db.update(personAlias).set({ alias: erasedName, aliasNorm: key }).where(eq(personAlias.id, id));
    yield* db
        .update(lineupEntry)
        .set({ raw: key })
        .where(and(eq(lineupEntry.aliasId, id), isNotNull(lineupEntry.raw)));

    if (isDefined(guestPersonId)) {
        yield* db
            .update(person)
            .set({ displayName: erasedName, anonymizedAt })
            .where(
                and(
                    eq(person.id, guestPersonId),
                    sql`not exists (select 1 from identity.telegram_account account where account.person_id = ${person.id})`,
                    sql`not exists (select 1 from identity.person_alias other where other.id <> ${id}::uuid
                        and ${person.id} in (other.person_id, other.guest_person_id))`
                )
            );
    }
});

const eraseAuthors = Effect.fn('Core.eraseAuthors')(function* (
    personIds: readonly string[],
    tgUserIds: readonly bigint[],
    names: readonly string[]
) {
    const db = yield* Db;
    const authors = yield* db
        .select()
        .from(telegramAuthor)
        .where(
            and(
                not(isErasedKey(telegramAuthor.displayName)),
                or(
                    inArray(telegramAuthor.personId, [...personIds]),
                    inArray(telegramAuthor.tgUserId, [...tgUserIds]),
                    and(isNull(telegramAuthor.tgUserId), isNull(telegramAuthor.personId), inArray(telegramAuthor.displayName, [...names]))
                )
            )
        );

    for (const { id, communityId, displayName } of authors) {
        yield* db
            .update(telegramAuthor)
            .set({ displayName: erasedKey(communityId, displayName), tgUserId: null, personId: null })
            .where(eq(telegramAuthor.id, id));
    }

    return authors.map(({ displayName }) => displayName);
});

const eraseTexts = Effect.fn('Core.eraseTexts')(function* (
    personIds: readonly string[],
    tgUserIds: readonly bigint[],
    names: readonly string[]
) {
    const db = yield* Db;
    const decidedAt = yield* DateTime.nowAsDate;
    const texts = [...personIds, ...names.filter(name => name !== erasedName && name.length >= minSearchedLength)];
    const actions = yield* db
        .update(pendingAction)
        .set({
            payload: {},
            summary: '',
            result: null,
            status: sql`case when ${pendingAction.status} = 'proposed' then 'rejected' else ${pendingAction.status} end`,
            decidedAt: sql`coalesce(${pendingAction.decidedAt}, ${decidedAt.toISOString()}::timestamptz)`
        })
        .where(
            and(
                ne(pendingAction.summary, ''),
                or(
                    inArray(pendingAction.requestedByTgUserId, [...tgUserIds]),
                    mentions(pendingAction.summary, texts),
                    mentions(pendingAction.payload, texts),
                    mentions(pendingAction.result, texts)
                )
            )
        )
        .returning({ id: pendingAction.id });
    const states = yield* db
        .delete(adminState)
        .where(or(inArray(adminState.tgUserId, [...tgUserIds]), mentions(adminState.draft, texts), mentions(adminState.awaiting, texts)))
        .returning({ id: adminState.tgUserId });
    const conversation = yield* db
        .delete(assistantMessage)
        .where(or(inArray(assistantMessage.tgUserId, [...tgUserIds]), mentions(assistantMessage.content, texts)))
        .returning({ id: assistantMessage.id });
    yield* db.update(lineupDelivery).set({ text: null }).where(mentions(lineupDelivery.text, texts));

    return { pendingActions: actions.length, adminStates: states.length, assistantMessages: conversation.length };
});

const eraseInLock = Effect.fn('Core.eraseInLock')(function* ({ communityId, personId }: Erasure) {
    const db = yield* Db;

    if (!(yield* arePeopleOf(communityId, [personId]))) {
        return yield* ActionFailedError.make({ failure: { code: 'person_not_found' } });
    }

    // Accounts before people, the order in which a live update locks them
    const accounts = yield* db
        .select()
        .from(telegramAccount)
        .where(sql`${telegramAccount.personId} in ${mergedInto(personId)}`)
        .for('update');
    const people = yield* db
        .select({ id: person.id, displayName: person.displayName })
        .from(person)
        .where(sql`${person.id} in ${mergedInto(personId)}`);
    const personIds = people.map(({ id }) => id);
    const tgUserIds = accounts.map(({ tgUserId }) => tgUserId);
    const usernames = accounts.flatMap(({ username }) => (isNotEmptyString(username) ? [username] : []));
    const fullNames = accounts.map(({ firstName, lastName }) => [firstName, lastName].filter(part => isNotEmptyString(part)).join(' '));
    const handles = usernames.map(username => ({
        communityId,
        personId,
        alias: username,
        aliasNorm: normalizeAlias(username),
        resolution: 'guest' as const
    }));

    if (!isEmptyArray(handles)) {
        yield* db.insert(personAlias).values(handles).onConflictDoNothing();
    }

    const nicknames = yield* ownNicknames(personIds);

    for (const nickname of nicknames) {
        yield* maskNickname(nickname);
    }

    const anonymizedAt = yield* DateTime.nowAsDate;
    yield* db.update(person).set({ displayName: erasedName, birthDate: null, anonymizedAt }).where(inArray(person.id, personIds));
    yield* db
        .update(telegramAccount)
        .set({ username: null, firstName: erasedName, lastName: null, languageCode: null })
        .where(inArray(telegramAccount.personId, personIds));
    yield* scrubErasedEntries(communityId);
    const names = [...people.map(({ displayName }) => displayName), ...fullNames];
    const authors = yield* eraseAuthors(personIds, tgUserIds, names);
    const texts = yield* eraseTexts(personIds, tgUserIds, [...names, ...usernames, ...authors, ...nicknames.map(({ alias }) => alias)]);
    yield* db.delete(roleGrant).where(inArray(roleGrant.personId, personIds));
    yield* db
        .update(membership)
        .set({ status: 'left', leftAt: sql`coalesce(${membership.leftAt}, now())` })
        .where(and(inArray(membership.personId, personIds), ne(membership.status, 'removed')));
    const erased = {
        people: people.length,
        accounts: accounts.length,
        nicknames: nicknames.length,
        authors: authors.length,
        ...texts
    };
    yield* recordAudit({
        communityId,
        actorPersonId: null,
        action: 'person.erase',
        entityType: 'person',
        entityId: personId,
        diff: erased
    });

    return erased;
});

export const erasePerson = Effect.fn('Core.erasePerson')((erasure: Erasure) =>
    withCommunityLock({ id: erasure.communityId }, eraseInLock(erasure))
);

// The preview does the whole work and rolls it back
export const previewErasure = Effect.fn('Core.previewErasure')((erasure: Erasure) =>
    withCommunityLock(
        { id: erasure.communityId },
        eraseInLock(erasure).pipe(Effect.flatMap(counts => Effect.fail(ErasePreviewError.make({ counts }))))
    ).pipe(Effect.catchTag('ErasePreviewError', ({ counts }) => Effect.succeed(counts)))
);
