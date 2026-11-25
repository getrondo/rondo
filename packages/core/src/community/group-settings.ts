import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { person, telegramAccount } from '@rondo/db/schema/identity.schema';
import { community } from '@rondo/db/schema/org.schema';
import { Db } from '@rondo/db/service/db.service';
import { withCommunityLock } from '@rondo/db/service/with-community-lock';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

import { adminCommunityIds } from '../access/admin-access';
import { ActionFailedError } from '../error/action-failed.error';
import { resolveLocale } from '../i18n/locale';
import { arePeopleOf } from '../people/people.service';

const weekdayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

const KnownChatSchema = Schema.Struct({
    chatId: Schema.Int,
    title: Schema.String,
    purpose: Schema.Literals(['main', 'other']),
    weekdays: Schema.Array(Schema.Literals(weekdayNames)),
    topicId: Schema.optional(Schema.Int)
});

const isOneMain = Schema.makeFilter(
    (chats: readonly (typeof KnownChatSchema.Type)[]) =>
        new Set(chats.map(({ chatId }) => chatId)).size === chats.length && chats.filter(({ purpose }) => purpose === 'main').length <= 1
);

const GroupsSchema = Schema.Struct({ chats: Schema.Array(KnownChatSchema).check(isOneMain) });

export const GroupsFileSchema = Schema.Struct({ slug: Schema.String, approverPersonId: Schema.String, ...GroupsSchema.fields });

export type KnownChat = typeof KnownChatSchema.Type;

const decodeSettings = Schema.decodeUnknownOption(Schema.Struct({ groups: GroupsSchema }));

const chatsIn = (settings: unknown): readonly KnownChat[] =>
    decodeSettings(settings).pipe(
        Option.map(({ groups }) => groups.chats),
        Option.getOrElse(() => [])
    );

export const isUsualDay = ({ weekdays }: Pick<KnownChat, 'weekdays'>, weekday: number): boolean =>
    weekdays.some(name => weekdayNames[weekday] === name);

export const knownChatsOf = Effect.fn('Core.knownChatsOf')(function* (communityId: string) {
    const db = yield* Db;
    const [row] = yield* db.select({ settings: community.settings }).from(community).where(eq(community.id, communityId));

    return chatsIn(row?.settings);
});

export const findKnownChat = Effect.fn('Core.findKnownChat')(function* (chatId: number) {
    const db = yield* Db;
    const [row] = yield* db
        .select({ communityId: community.id, settings: community.settings })
        .from(community)
        .where(sql`${community.settings} #> '{groups,chats}' @> jsonb_build_array(jsonb_build_object('chatId', ${chatId}::bigint))`);
    const chat = chatsIn(row?.settings).find(entry => entry.chatId === chatId);

    return isDefined(row) && isDefined(chat) ? Option.some({ communityId: row.communityId, chat }) : Option.none();
});

// The last used account of the approver speaks for them, and only while they are an admin
export const approverOf = Effect.fn('Core.approverOf')(function* (communityId: string) {
    const db = yield* Db;
    const accounts = yield* db
        .select({ tgUserId: telegramAccount.tgUserId, languageCode: telegramAccount.languageCode, name: person.displayName })
        .from(community)
        .innerJoin(person, eq(person.id, community.approverPersonId))
        .innerJoin(telegramAccount, eq(telegramAccount.personId, person.id))
        .where(and(eq(community.id, communityId), isNull(person.anonymizedAt)))
        .orderBy(desc(telegramAccount.lastSeenAt));
    const [last] = accounts;

    return isDefined(last) && (yield* adminCommunityIds(last.tgUserId)).includes(communityId)
        ? Option.some({
              tgUserId: last.tgUserId,
              tgUserIds: accounts.map(({ tgUserId }) => tgUserId),
              name: last.name,
              locale: resolveLocale(last.languageCode)
          })
        : Option.none();
});

export const isApproverOf = (tgUserId: bigint, communityId: string) =>
    approverOf(communityId).pipe(Effect.map(Option.exists(({ tgUserIds }) => tgUserIds.includes(tgUserId))));

export const loadGroups = Effect.fn('Core.loadGroups')(({ slug, approverPersonId, chats }: typeof GroupsFileSchema.Type) =>
    withCommunityLock(
        { slug },
        Effect.gen(function* () {
            const db = yield* Db;
            const updated = yield* db
                .update(community)
                .set({
                    approverPersonId,
                    settings: sql`${community.settings} || jsonb_build_object('groups', ${JSON.stringify({ chats })}::jsonb)`
                })
                .where(eq(community.slug, slug))
                .returning({ id: community.id });

            return isNotEmptyArray(updated) && (yield* arePeopleOf(updated[0].id, [approverPersonId]))
                ? { chats: chats.length }
                : yield* ActionFailedError.make({ failure: { code: 'person_not_found' } });
        })
    )
);
