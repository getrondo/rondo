import { isNotEmptyArray, isNotEmptyString } from '@rnw-community/shared';
import { telegramChat } from '@rondo/db/schema/org.schema';
import { noticeDelivery } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq, inArray } from 'drizzle-orm';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';

import { ActionFailedError } from '../error/action-failed.error';

import { postHtml } from './notifier';

import type { Locale } from '../i18n/locale';
import type { GroupTarget } from '../interface/group-target.interface';
import type { Approval } from '../telegram/write-to-chat';

interface Notice {
    readonly actionId: string;
    readonly approval: Approval;
    readonly locale: Locale;
    readonly html: string;
    readonly targets: readonly GroupTarget[];
}

const titlesOf = Effect.fn('Core.titlesOf')(function* (chatIds: readonly bigint[]) {
    const db = yield* Db;
    const rows = yield* db
        .select({ title: telegramChat.title })
        .from(telegramChat)
        .where(inArray(telegramChat.chatId, [...chatIds]));

    return rows.map(({ title }) => `«${title}»`).join(', ');
});

// Every destination has its own receipt, is tried once, and one that fails does not stop the others
export const deliverNotices = Effect.fn('Core.deliverNotices')(function* (notice: Notice) {
    const db = yield* Db;
    const { actionId } = notice;
    const missed: { readonly chatId: bigint; readonly status: 'refused' | 'uncertain' }[] = [];

    for (const target of notice.targets) {
        const claimed = yield* db
            .insert(noticeDelivery)
            .values({ actionId, chatId: target.chatId })
            .onConflictDoNothing()
            .returning({ chatId: noticeDelivery.chatId });

        if (isNotEmptyArray(claimed)) {
            const receipt = yield* postHtml(target, notice.html, notice).pipe(
                Effect.map(({ messageId }) => ({ status: 'sent' as const, messageId })),
                Effect.catch(error =>
                    Effect.logWarning('[notice] not delivered', error).pipe(
                        Effect.as({
                            status: error._tag === 'TelegramApiError' && error.isUncertain ? ('uncertain' as const) : ('refused' as const),
                            messageId: null
                        })
                    )
                )
            );
            const updatedAt = yield* DateTime.nowAsDate;
            yield* db
                .update(noticeDelivery)
                .set({ ...receipt, updatedAt })
                .where(and(eq(noticeDelivery.actionId, actionId), eq(noticeDelivery.chatId, target.chatId)));
            missed.push(...(receipt.status === 'sent' ? [] : [{ chatId: target.chatId, status: receipt.status }]));
        }
    }

    if (missed.some(({ status }) => status === 'uncertain')) {
        return yield* ActionFailedError.make({ failure: { code: 'result_uncertain' } });
    }

    const chats = yield* titlesOf(missed.map(({ chatId }) => chatId));

    if (isNotEmptyArray(missed)) {
        return yield* ActionFailedError.make({
            failure: isNotEmptyString(chats) ? { code: 'notice_missed', chats } : { code: 'telegram_refused' }
        });
    }

    return notice.targets.length;
});
