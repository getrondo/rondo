import { isEmptyArray, isNotEmptyArray, isNotEmptyString } from '@rnw-community/shared';
import * as Effect from 'effect/Effect';

import { ActionFailedError } from '../error/action-failed.error';
import { titlesOfChats } from '../signups/poll-chats';

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
    const groups = yield* titlesOfChats(chatIds.filter(chatId => chatId < 0n).map(chatId => `${chatId}`));

    return [groups, chatIds.some(chatId => chatId > 0n) ? privately : ''].filter(part => isNotEmptyString(part)).join(', ');
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
