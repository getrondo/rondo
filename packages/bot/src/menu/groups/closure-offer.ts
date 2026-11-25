import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { describeAction } from '@rondo/core/actions/describe-action';
import { closeUnheard, proposeAction } from '@rondo/core/actions/pending-action.service';
import { linkedChatsOf } from '@rondo/core/community/community.repository';
import { approverOf } from '@rondo/core/community/group-settings';
import { formatSessionLabel } from '@rondo/core/i18n/messages';
import { instantOf } from '@rondo/core/sessions/local-time';
import { getSession } from '@rondo/core/sessions/session.service';
import { claimOpenPollNotice } from '@rondo/core/signups/claim-open-poll-notice';
import { closureOf, titlesOfChats } from '@rondo/core/signups/poll-chats';
import { addDays } from '@rondo/core/utils/add-days.util';
import { pendingAction } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { withCommunityLock } from '@rondo/db/service/with-community-lock';
import { escapeHtml } from '@rondo/telegram/format/html';
import { and, eq, gte, sql } from 'drizzle-orm';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { actionContextFor } from '../../context/action-context';
import { menuText } from '../menu-text';

import { sendTo, tellOwners } from './tell';

import type { Action } from '@rondo/core/actions/action.model';
import type { Locale } from '@rondo/core/i18n/locale';

const offerMs = 30 * 24 * 60 * 60_000;

const hasOffer = Effect.fn('Bot.hasClosureOffer')(function* (action: Action, sessionId: string, tgUserId: bigint) {
    const db = yield* Db;
    const now = yield* DateTime.nowAsDate;
    const offers = yield* db
        .select({ id: pendingAction.id })
        .from(pendingAction)
        .where(
            and(
                eq(pendingAction.kind, action._tag),
                eq(pendingAction.status, 'proposed'),
                eq(pendingAction.requestedByTgUserId, tgUserId),
                gte(pendingAction.expiresAt, now),
                sql`${pendingAction.payload} @> ${JSON.stringify({ sessionId, ...('isClosure' in action ? { isClosure: true } : {}) })}::jsonb`
            )
        );

    return isNotEmptyArray(offers);
});

// The gate kept the poll of a game open: the approver gets one button that closes it, and nothing more is written
export const offerClosure = Effect.fn('Bot.offerClosure')(function* (sessionId: string, deletes: boolean) {
    const game = yield* getSession(sessionId);
    const closes = yield* closureOf(sessionId);

    if (Option.isNone(game) || !isNotEmptyArray(closes.pollIds)) {
        return;
    }

    const { communityId, localDate } = game.value;
    const { timezone } = yield* actionContextFor(communityId, 0n);
    const now = yield* DateTime.nowAsDate;
    const deletableMs = instantOf(addDays(localDate, 1), '00:00', timezone).getTime() - now.getTime();
    const isDeletion = deletes && deletableMs > 0;
    const where = yield* titlesOfChats(closes.chatIds).pipe(Effect.map(titles => escapeHtml(titles)));
    const linked = yield* linkedChatsOf(communityId);
    const isClosable = closes.chatIds.every(chatId => linked.some(chat => String(chat.chatId) === chatId));
    const approver = yield* approverOf(communityId).pipe(Effect.map(found => Option.getOrNull(found)));
    const textIn = (locale: Locale) =>
        menuText(locale, 'openPollLeft', { label: escapeHtml(formatSessionLabel(locale, game.value)), where });

    if (isDefined(approver) && isClosable) {
        const { tgUserId, locale } = approver;
        const action: Action = isDeletion
            ? { _tag: 'delete_session', sessionId, closes, isClosure: true }
            : { _tag: 'close_poll', sessionId, closes };

        const summary = yield* describeAction(action, locale, communityId);
        const windowMs = isDeletion ? deletableMs : offerMs;
        const propose = proposeAction({ communityId, tgUserId, action, summary, windowMs });
        const actionId = yield* withCommunityLock(
            { id: communityId },
            hasOffer(action, sessionId, tgUserId).pipe(Effect.flatMap(isOffered => (isOffered ? Effect.succeed(null) : propose)))
        );

        if (!isDefined(actionId)) {
            return;
        }

        const button = { text: menuText(locale, isDeletion ? 'openPollDelete' : 'openPollClose'), callback_data: `act:${actionId}:y` };

        // An offer that was cut off on its way is free again
        const isDelivered = yield* sendTo(tgUserId, locale, () => ({ text: textIn(locale), keyboard: [[button]] })).pipe(
            Effect.onError(() => closeUnheard(actionId).pipe(Effect.ignore))
        );

        if (isDelivered) {
            return;
        }

        yield* closeUnheard(actionId);
    }

    // Without a button it is told once per game, and the job offers it again
    if (!(yield* claimOpenPollNotice(communityId, sessionId))) {
        return;
    }

    const screenIn = (locale: Locale) => ({ text: textIn(locale), keyboard: [] });
    const isHeard = isDefined(approver) && !isClosable && (yield* sendTo(approver.tgUserId, approver.locale, screenIn));

    if (!isHeard) {
        yield* tellOwners(screenIn);
    }
});
