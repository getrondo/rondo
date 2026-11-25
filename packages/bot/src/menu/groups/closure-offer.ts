import { isNotEmptyArray } from '@rnw-community/shared';
import { describeAction } from '@rondo/core/actions/describe-action';
import { proposeAction } from '@rondo/core/actions/pending-action.service';
import { recordAudit } from '@rondo/core/audit/record-audit';
import { linkedChatsOf } from '@rondo/core/community/community.repository';
import { approverOf } from '@rondo/core/community/group-settings';
import { formatSessionLabel } from '@rondo/core/i18n/messages';
import { getSession } from '@rondo/core/sessions/session.service';
import { closureOf, titlesOfChats } from '@rondo/core/signups/poll-chats';
import { leftOpenAudit } from '@rondo/core/signups/signup.service';
import { escapeHtml } from '@rondo/telegram/format/html';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { menuText } from '../menu-text';

import { tellApprover, tellOwners } from './tell';

import type { Action } from '@rondo/core/actions/action.model';
import type { Locale } from '@rondo/core/i18n/locale';

const offerMs = 30 * 24 * 60 * 60_000;

// The gate kept the poll of a game open: the approver gets one button that closes it, and nothing more is written
export const offerClosure = Effect.fn('Bot.offerClosure')(function* (sessionId: string, deletes: boolean) {
    const game = yield* getSession(sessionId);
    const closes = yield* closureOf(sessionId);

    if (Option.isNone(game) || !isNotEmptyArray(closes.pollIds)) {
        return;
    }

    const { communityId } = game.value;
    const where = yield* titlesOfChats(closes.chatIds).pipe(Effect.map(titles => escapeHtml(titles)));
    const linked = yield* linkedChatsOf(communityId);
    const isClosable = closes.chatIds.every(chatId => linked.some(chat => String(chat.chatId) === chatId));
    const approver = yield* approverOf(communityId);
    const textIn = (locale: Locale) =>
        menuText(locale, 'openPollLeft', { label: escapeHtml(formatSessionLabel(locale, game.value)), where });

    if (!deletes) {
        yield* recordAudit({ communityId, actorPersonId: null, action: leftOpenAudit, entityType: 'session', entityId: sessionId });
    }

    if (Option.isNone(approver)) {
        yield* tellOwners(locale => ({ text: textIn(locale), keyboard: [] }));

        return;
    }

    const { tgUserId, locale } = approver.value;
    const action: Action = deletes
        ? { _tag: 'delete_session', sessionId, closes, isClosure: true }
        : { _tag: 'close_poll', sessionId, closes };
    const summary = yield* describeAction(action, locale, communityId);
    const actionId = yield* proposeAction({ communityId, tgUserId, action, summary, windowMs: offerMs });
    const button = { text: menuText(locale, deletes ? 'openPollDelete' : 'openPollClose'), callback_data: `act:${actionId}:y` };

    yield* tellApprover(communityId, () => ({ text: textIn(locale), keyboard: isClosable ? [[button]] : [] }));
});
