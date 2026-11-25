import { isEmptyArray, isNotEmptyArray } from '@rnw-community/shared';
import { telegramChat } from '@rondo/db/schema/org.schema';
import { Db } from '@rondo/db/service/db.service';
import { inArray } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { ActionFailedError } from '../error/action-failed.error';

import { postHtml } from './notifier';

import type { Locale } from '../i18n/locale';
import type { GroupTarget } from '../interface/group-target.interface';
import type { Approval } from '../telegram/write-to-chat';

interface Notice {
    readonly approval: Approval;
    readonly locale: Locale;
    readonly html: string;
    readonly targets: readonly GroupTarget[];
}

const privately = '👤';

const titlesOf = Effect.fn('Core.titlesOf')(function* (chatIds: readonly bigint[]) {
    const db = yield* Db;
    const rows = isNotEmptyArray(chatIds)
        ? yield* db
              .select({ title: telegramChat.title })
              .from(telegramChat)
              .where(inArray(telegramChat.chatId, [...chatIds]))
        : [];

    return [...rows.map(({ title }) => `«${title}»`), ...(chatIds.some(chatId => chatId > 0n) ? [privately] : [])].join(', ');
});

// Every destination is tried once, and one that fails does not stop the others
export const deliverNotices = Effect.fn('Core.deliverNotices')(function* (notice: Notice) {
    const outcomes: { readonly chatId: bigint; readonly status: 'sent' | 'refused' | 'uncertain' }[] = [];

    for (const { chatId, topicId } of notice.targets) {
        const status = yield* postHtml({ chatId, topicId }, notice.html, notice).pipe(
            Effect.as('sent' as const),
            Effect.catch(error =>
                Effect.logWarning('[notice] not delivered', error).pipe(
                    Effect.as(error._tag === 'TelegramApiError' && error.isUncertain ? ('uncertain' as const) : ('refused' as const))
                )
            )
        );
        outcomes.push({ chatId, status });
    }

    const idsOf = (isSent: boolean) => outcomes.filter(({ status }) => (status === 'sent') === isSent).map(({ chatId }) => chatId);
    const [sent, missed] = [idsOf(true), idsOf(false)];
    const isUnknown = outcomes.some(({ status }) => status === 'uncertain');

    if (isNotEmptyArray(missed) && isEmptyArray(sent)) {
        const isGroup = missed.some(chatId => chatId < 0n);

        if (isUnknown || !isGroup) {
            return yield* ActionFailedError.make({ failure: { code: isUnknown ? 'result_uncertain' : 'telegram_refused' } });
        }
    }

    if (isNotEmptyArray(missed)) {
        return yield* ActionFailedError.make({
            failure: { code: 'notice_missed', chats: yield* titlesOf(missed), sent: isEmptyArray(sent) ? '—' : yield* titlesOf(sent) }
        });
    }

    return sent.length;
});
