import { grantAdmin } from '@rondo/core/access/admin-access';
import { loadGroups, type KnownChat } from '@rondo/core/community/group-settings';
import { ensureMembership, upsertTelegramUser } from '@rondo/core/identity/telegram-user';
import { telegramChat } from '@rondo/db/schema/org.schema';
import { Db } from '@rondo/db/service/db.service';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { handleUpdate } from '../../src/handle-update';

export const bot = { id: 0, is_bot: true as const, first_name: 'Rondo', username: 'rondo_bot' };

export const groupOf = (id: number, title = 'Games') => ({ id, type: 'supergroup' as const, title });

export const knownChat = (chatId: number, change: Partial<KnownChat> = {}): KnownChat => ({
    chatId,
    title: 'Games',
    purpose: 'main',
    weekdays: ['fri'],
    ...change
});

// The organizer opened the bot before, so they can be asked
export const seedGroups = Effect.fn('test.seedGroups')(function* (
    community: { readonly communityId: string; readonly slug: string },
    approverId: number,
    chats: readonly KnownChat[]
) {
    const personId = yield* upsertTelegramUser({ id: BigInt(approverId), firstName: `Admin ${approverId}`, languageCode: 'uk' });
    yield* grantAdmin({ communityId: community.communityId, personId, grantedBy: null });
    yield* ensureMembership(community.communityId, personId);
    yield* loadGroups({ slug: community.slug, approverPersonId: personId, chats });
});

let updateId = 700_000;

type Status = 'member' | 'administrator' | 'left' | 'kicked' | 'restricted';

export const botIs = (chatId: number, from: Status, to: Status, rights: Readonly<Record<string, boolean>> = {}) => {
    updateId += 1;

    return handleUpdate({
        update_id: updateId,
        my_chat_member: {
            chat: groupOf(chatId),
            from: { id: 5, is_bot: false, first_name: 'Adder' },
            date: 0,
            old_chat_member: { status: from, user: bot },
            new_chat_member: { status: to, user: bot, ...rights }
        }
    });
};

export { linkGroup } from '@rondo/core/testing/link-group';

export const chatRow = Effect.fn('test.chatRow')(function* (chatId: number) {
    const db = yield* Db;
    const [row] = yield* db
        .select()
        .from(telegramChat)
        .where(eq(telegramChat.chatId, BigInt(chatId)));

    return row;
});
