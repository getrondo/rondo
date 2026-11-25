import { isDefined } from '@rnw-community/shared';
import { community, telegramChat } from '@rondo/db/schema/org.schema';
import { Db } from '@rondo/db/service/db.service';
import { CommunityConfigSchema, type CommunityConfig } from '@rondo/ingest-telegram/config/community-config';
import { and, asc, eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

import { resolveLocale, type Locale } from '../i18n/locale';

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

export const findCommunityBySlug = Effect.fn('Core.findCommunityBySlug')(function* (slug: string) {
    const db = yield* Db;
    const [row] = yield* db.select({ id: community.id }).from(community).where(eq(community.slug, slug));

    return Option.fromNullishOr(row?.id);
});

export const findLinkedChat = Effect.fn('Core.findLinkedChat')(function* (chatId: bigint) {
    const db = yield* Db;
    const [row] = yield* db
        .select({ communityId: telegramChat.communityId, topicId: telegramChat.topicId })
        .from(telegramChat)
        .where(eq(telegramChat.chatId, chatId));

    return Option.fromNullishOr(row);
});

export const mainGroupOf = Effect.fn('Core.mainGroupOf')(function* (communityId: string) {
    const db = yield* Db;
    const [row]: GroupTarget[] = yield* db
        .select({ chatId: telegramChat.chatId, topicId: telegramChat.topicId })
        .from(telegramChat)
        .where(and(eq(telegramChat.communityId, communityId), eq(telegramChat.purpose, 'main')))
        .orderBy(asc(telegramChat.createdAt), asc(telegramChat.chatId))
        .limit(1);

    return Option.fromNullishOr(row);
});

export const linkedChatsOf = Effect.fn('Core.linkedChatsOf')(function* (communityId: string) {
    const db = yield* Db;

    return yield* db
        .select({ chatId: telegramChat.chatId, topicId: telegramChat.topicId, title: telegramChat.title })
        .from(telegramChat)
        .where(and(eq(telegramChat.communityId, communityId), eq(telegramChat.purpose, 'main')))
        .orderBy(asc(telegramChat.createdAt), asc(telegramChat.chatId));
});

export const moveChat = Effect.fn('Core.moveChat')(function* (from: bigint, to: bigint) {
    const db = yield* Db;
    const [taken] = yield* db.select({ chatId: telegramChat.chatId }).from(telegramChat).where(eq(telegramChat.chatId, to));

    if (isDefined(taken)) {
        yield* db.delete(telegramChat).where(eq(telegramChat.chatId, from));

        return;
    }

    yield* db.update(telegramChat).set({ chatId: to, kind: 'supergroup' }).where(eq(telegramChat.chatId, from));
});

export const bindChat = Effect.fn('Core.bindChat')(function* (input: {
    readonly communityId: string;
    readonly chatId: bigint;
    readonly topicId: number | null;
    readonly kind: 'group' | 'supergroup';
    readonly title: string;
}) {
    const db = yield* Db;

    yield* db
        .insert(telegramChat)
        .values({ ...input, purpose: 'main' })
        .onConflictDoUpdate({
            target: telegramChat.chatId,
            set: { communityId: input.communityId, title: input.title, kind: input.kind, topicId: input.topicId }
        });
});
