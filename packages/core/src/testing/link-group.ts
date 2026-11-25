import { isDefined } from '@rnw-community/shared';
import { community, telegramChat } from '@rondo/db/schema/org.schema';
import { Db } from '@rondo/db/service/db.service';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { personIdOfTelegramUser, upsertTelegramUser } from '../identity/telegram-user';

interface LinkedGroup {
    readonly chatId: number;
    readonly title?: string;
    readonly topicId?: number | null;
    readonly purpose?: 'main' | 'other';
    readonly isPosting?: boolean;
    readonly isMentioning?: boolean;
}

export const ownerApproval = { _tag: 'approver', tgUserId: 42n } as const;

const setApprover = Effect.fn('Testing.setApprover')(function* (communityId: string, tgUserId: bigint) {
    const db = yield* Db;
    const known = yield* personIdOfTelegramUser(tgUserId);
    const approverPersonId = known ?? (yield* upsertTelegramUser({ id: tgUserId, firstName: 'Owner' }));
    yield* db.update(community).set({ approverPersonId }).where(eq(community.id, communityId));
});

// A group the approver has linked and switched on
export const linkGroup = Effect.fn('Testing.linkGroup')(function* (
    communityId: string,
    { chatId, ...group }: LinkedGroup,
    approver?: number
) {
    const db = yield* Db;
    const state = { communityId, title: 'Main', topicId: null, isPosting: true, isMentioning: true, ...group };
    const [home] = yield* db.select({ approver: community.approverPersonId }).from(community).where(eq(community.id, communityId));

    if (isDefined(approver) || !isDefined(home?.approver)) {
        yield* setApprover(communityId, BigInt(approver ?? 42));
    }

    yield* db
        .insert(telegramChat)
        .values({ chatId: BigInt(chatId), kind: 'supergroup', ...state })
        .onConflictDoUpdate({ target: telegramChat.chatId, set: state });
});
