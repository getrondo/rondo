import { describeAction } from '@rondo/core/actions/describe-action';
import { proposeAction } from '@rondo/core/actions/pending-action.service';
import { resolveLocale } from '@rondo/core/i18n/locale';
import * as Effect from 'effect/Effect';

import { sendProposal } from './private-chat';

import type { Action } from '@rondo/core/actions/action.model';
import type { TelegramUser } from '@rondo/core/identity/telegram-user';

export const proposeToAdmin = Effect.fn('Bot.proposeToAdmin')(function* (communityId: string, admin: TelegramUser, action: Action) {
    const locale = resolveLocale(admin.languageCode);
    const summary = yield* describeAction(action, locale, communityId);
    const actionId = yield* proposeAction({ communityId, tgUserId: admin.id, action, summary });
    yield* sendProposal(Number(admin.id), locale, { actionId, summary });
});
