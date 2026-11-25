import { isDefined, isEmptyArray } from '@rnw-community/shared';
import { person, telegramAccount } from '@rondo/db/schema/identity.schema';
import { community, telegramChat } from '@rondo/db/schema/org.schema';
import { pendingAction } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { withCommunityLock } from '@rondo/db/service/with-community-lock';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

import { adminCommunityIds } from '../access/admin-access';
import { ActionFailedError } from '../error/action-failed.error';
import { resolveLocale } from '../i18n/locale';
import { personIdOfTelegramUser } from '../identity/telegram-user';
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

export const GroupsFileSchema = Schema.Struct({ slug: Schema.String, approverTgUserId: Schema.Int, ...GroupsSchema.fields });

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

const supergroupsFrom = -1_000_000_000_000;

// A basic group that becomes a supergroup shows up under a new id, sometimes before Telegram says so
export const isUpgrading = Effect.fn('Core.isUpgrading')(function* (title: string) {
    const db = yield* Db;
    const known = yield* db.select({ settings: community.settings }).from(community);
    const linked = yield* db.select({ chatId: telegramChat.chatId, title: telegramChat.title }).from(telegramChat);

    return [...known.flatMap(({ settings }) => chatsIn(settings)), ...linked].some(
        chat => chat.title === title && Number(chat.chatId) > supergroupsFrom
    );
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

// One designated account, and only while it is an admin: another account of the same person is not the approver
export const approverOf = Effect.fn('Core.approverOf')(function* (communityId: string) {
    const db = yield* Db;
    const [row] = yield* db
        .select({ tgUserId: telegramAccount.tgUserId, languageCode: telegramAccount.languageCode, name: person.displayName })
        .from(community)
        .innerJoin(telegramAccount, eq(telegramAccount.tgUserId, community.approverTgUserId))
        .innerJoin(person, eq(person.id, telegramAccount.personId))
        .where(and(eq(community.id, communityId), isNull(person.anonymizedAt)));

    return isDefined(row) && (yield* adminCommunityIds(row.tgUserId)).includes(communityId)
        ? Option.some({ tgUserId: row.tgUserId, name: row.name, locale: resolveLocale(row.languageCode) })
        : Option.none();
});

export const isApproverOf = (tgUserId: bigint, communityId: string) =>
    approverOf(communityId).pipe(Effect.map(Option.exists(approver => approver.tgUserId === tgUserId)));

const foreignChats = Effect.fn('Core.foreignChats')(function* (communityId: string, chats: readonly KnownChat[]) {
    const db = yield* Db;
    const others = yield* db.select({ settings: community.settings }).from(community).where(ne(community.id, communityId));
    const linked = yield* db.select().from(telegramChat).where(ne(telegramChat.communityId, communityId));
    const taken = new Set([...others.flatMap(({ settings }) => chatsIn(settings)), ...linked].map(({ chatId }) => Number(chatId)));

    return chats.filter(({ chatId }) => taken.has(chatId));
});

const refused = (code: 'chat_not_linked' | 'person_not_found') => ActionFailedError.make({ failure: { code } });

const storeGroups = Effect.fn('Core.storeGroups')(function* ({ slug, approverTgUserId, chats }: typeof GroupsFileSchema.Type) {
    const db = yield* Db;
    const approver = BigInt(approverTgUserId);
    const [home] = yield* db.select().from(community).where(eq(community.slug, slug));
    const personId = yield* personIdOfTelegramUser(approver);

    if (!isDefined(home) || !isDefined(personId) || !(yield* arePeopleOf(home.id, [personId]))) {
        return yield* refused('person_not_found');
    }

    const foreign = yield* foreignChats(home.id, chats);

    if (!isEmptyArray(foreign)) {
        return yield* refused('chat_not_linked');
    }

    yield* db
        .update(community)
        .set({
            approverTgUserId: approver,
            settings: sql`${community.settings} || jsonb_build_object('groups', ${JSON.stringify({ chats })}::jsonb)`
        })
        .where(eq(community.id, home.id));

    if (home.approverTgUserId !== approver) {
        yield* db
            .update(pendingAction)
            .set({ status: 'expired' })
            .where(
                and(
                    eq(pendingAction.communityId, home.id),
                    eq(pendingAction.status, 'proposed'),
                    ne(pendingAction.approverTgUserId, approver)
                )
            );
    }

    return { chats: chats.length };
});

// One load at a time, whatever the community: a chat belongs to one of them
export const loadGroups = Effect.fn('Core.loadGroups')((file: typeof GroupsFileSchema.Type) =>
    withCommunityLock({ slug: '' }, withCommunityLock({ slug: file.slug }, storeGroups(file)))
);
