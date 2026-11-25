import { isDefined } from '@rnw-community/shared';
import { community, telegramChat } from '@rondo/db/schema/org.schema';
import { messageRef, pollForward, telegramPoll } from '@rondo/db/schema/platform.schema';
import { lineupDelivery } from '@rondo/db/schema/play.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

import { CommunityConfigSchema, type CommunityConfig } from '../config/community-config';
import { resolveLocale, type Locale } from '../i18n/locale';

import { moveImportedChat } from './move-imported-chat';

import type { GroupTarget } from '../interface/group-target.interface';

export interface CommunityProfile {
    readonly id: string;
    readonly slug: string;
    readonly name: string;
    readonly timezone: string;
    readonly locale: Locale;
    readonly config: Option.Option<CommunityConfig>;
}

const SettingsSchema = Schema.Struct({ ingest: Schema.optional(CommunityConfigSchema) });
const decodeSettings = Schema.decodeUnknownOption(SettingsSchema);

export const communityProfile = Effect.fn('Core.communityProfile')(function* (communityId: string) {
    const db = yield* Db;
    const [row] = yield* db.select().from(community).where(eq(community.id, communityId));

    return Option.fromNullishOr(row).pipe(
        Option.map((found): CommunityProfile => ({
            id: found.id,
            slug: found.slug,
            name: found.name,
            timezone: found.timezone,
            locale: resolveLocale(found.defaultLocale),
            config: decodeSettings(found.settings).pipe(Option.flatMap(settings => Option.fromNullishOr(settings.ingest)))
        }))
    );
});

export const groupLocaleOf = (communityId: string) =>
    communityProfile(communityId).pipe(Effect.map(Option.match({ onNone: () => resolveLocale(null), onSome: ({ locale }) => locale })));

export const findLinkedChat = Effect.fn('Core.findLinkedChat')(function* (chatId: bigint) {
    const db = yield* Db;
    const [row] = yield* db
        .select({
            communityId: telegramChat.communityId,
            topicId: telegramChat.topicId,
            purpose: telegramChat.purpose,
            title: telegramChat.title
        })
        .from(telegramChat)
        .where(eq(telegramChat.chatId, chatId));

    return Option.fromNullishOr(row);
});

// Linked groups, and whether the bot may write there
export const linkedChatsOf = Effect.fn('Core.linkedChatsOf')(function* (communityId: string) {
    const db = yield* Db;

    return yield* db
        .select({
            chatId: telegramChat.chatId,
            topicId: telegramChat.topicId,
            title: telegramChat.title,
            purpose: telegramChat.purpose,
            isPosting: telegramChat.isPosting,
            isMentioning: telegramChat.isMentioning
        })
        .from(telegramChat)
        .where(and(eq(telegramChat.communityId, communityId), inArray(telegramChat.purpose, ['main', 'other'])))
        .orderBy(asc(telegramChat.purpose), asc(telegramChat.createdAt), asc(telegramChat.chatId));
});

export const postingChatsOf = (communityId: string) =>
    linkedChatsOf(communityId).pipe(Effect.map(chats => chats.filter(({ isPosting }) => isPosting)));

// The group of an action that names none: the main one, and never a stand-in for it
export const mainGroupOf = (communityId: string) =>
    postingChatsOf(communityId).pipe(
        Effect.map(chats => Option.fromNullishOr(chats.find(({ purpose }) => purpose === 'main'))),
        Effect.map(Option.map(({ chatId, topicId }): GroupTarget => ({ chatId, topicId })))
    );

export const moveChat = Effect.fn('Core.moveChat')(function* (from: bigint, to: bigint) {
    const db = yield* Db;

    yield* db.transaction(() =>
        Effect.gen(function* () {
            const [taken] = yield* db.select({ chatId: telegramChat.chatId }).from(telegramChat).where(eq(telegramChat.chatId, to));

            yield* isDefined(taken)
                ? db.delete(telegramChat).where(eq(telegramChat.chatId, from))
                : db.update(telegramChat).set({ chatId: to, kind: 'supergroup' }).where(eq(telegramChat.chatId, from));
            yield* db.execute(sql`
                delete from comms.message_ref old
                where old.chat_id = ${from}
                  and exists (select 1 from comms.message_ref kept where kept.chat_id = ${to} and kept.message_id = old.message_id)`);
            yield* moveImportedChat(Number(from), Number(to));
            yield* db.update(messageRef).set({ chatId: to }).where(eq(messageRef.chatId, from));
            yield* db.update(telegramPoll).set({ chatId: to }).where(eq(telegramPoll.chatId, from));
            yield* db.execute(sql`
                delete from comms.poll_forward stale
                using comms.poll_forward other
                where stale.poll_id = other.poll_id
                  and ((stale.chat_id = ${from} and other.chat_id = ${to} and stale.claimed_at <= other.claimed_at)
                    or (stale.chat_id = ${to} and other.chat_id = ${from} and stale.claimed_at < other.claimed_at))`);

            yield* db.update(pollForward).set({ chatId: to }).where(eq(pollForward.chatId, from));
            yield* db.execute(sql`
                delete from play.lineup_delivery stale
                using play.lineup_delivery other
                where stale.session_id = other.session_id
                  and ((stale.chat_id = ${from} and other.chat_id = ${to} and stale.updated_at <= other.updated_at)
                    or (stale.chat_id = ${to} and other.chat_id = ${from} and stale.updated_at < other.updated_at))`);

            return yield* db.update(lineupDelivery).set({ chatId: to }).where(eq(lineupDelivery.chatId, from));
        })
    );
});
