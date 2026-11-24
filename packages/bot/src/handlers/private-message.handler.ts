import { isDefined, isNotEmptyString } from '@rnw-community/shared';
import { clearHistory } from '@rondo/assistant/history/conversation.repository';
import { runAssistant } from '@rondo/assistant/run-assistant';
import { adminCommunityIds } from '@rondo/core/access/admin-access';
import { communityProfile } from '@rondo/core/community/community.repository';
import { resolveLocale } from '@rondo/core/i18n/locale';
import { text } from '@rondo/core/i18n/messages';
import { displayNameOf, ensureMembership, upsertTelegramUser } from '@rondo/core/identity/telegram-user';
import { todayIn } from '@rondo/core/sessions/local-time';
import { Telegram } from '@rondo/telegram/service/telegram.service';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { sendProposal } from '../context/send-proposal';
import { toTelegramUser } from '../context/telegram-user.mapper';

import type { Message } from 'grammy/types';

const telegramMessageLimit = 4000;

export const handlePrivateMessage = Effect.fn('Bot.handlePrivateMessage')(function* (message: Message) {
    const telegram = yield* Telegram;
    const sender = message.from;
    const body = message.text?.trim();

    if (!isDefined(sender) || sender.is_bot || !isNotEmptyString(body)) {
        return;
    }

    const user = toTelegramUser(sender);
    const locale = resolveLocale(user.languageCode);
    const chatId = message.chat.id;
    const send = (reply: string) => telegram.call('sendMessage', api => api.sendMessage(chatId, reply.slice(0, telegramMessageLimit)));
    const personId = yield* upsertTelegramUser(user);
    const [communityId] = yield* adminCommunityIds(user.id);

    if (!isDefined(communityId)) {
        yield* send(text(locale, 'notAdmin'));

        return;
    }

    if (body.startsWith('/start') || body.startsWith('/help')) {
        yield* send(text(locale, 'adminGreeting'));

        return;
    }

    if (body.startsWith('/reset')) {
        yield* clearHistory(user.id);
        yield* send('🧹');

        return;
    }

    yield* ensureMembership(communityId, personId);
    const profile = yield* communityProfile(communityId);
    const timezone = Option.match(profile, { onNone: () => 'Europe/Vienna', onSome: value => value.timezone });
    const now = yield* DateTime.nowAsDate;
    yield* telegram.call('sendChatAction', api => api.sendChatAction(chatId, 'typing')).pipe(Effect.ignore);

    const reply = yield* runAssistant({
        communityId,
        tgUserId: user.id,
        locale,
        userText: body,
        prompt: {
            communityName: Option.match(profile, { onNone: () => 'Rondo', onSome: value => value.name }),
            timezone,
            today: todayIn(timezone, now),
            weekday: new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'long' }).format(now),
            locale,
            adminName: displayNameOf(user),
            adminPersonId: personId
        }
    }).pipe(
        Effect.tapCause(Effect.logError),
        Effect.catchCause(() => Effect.succeed({ text: text(locale, 'aiError'), proposals: [] }))
    );

    if (isNotEmptyString(reply.text)) {
        yield* send(reply.text);
    }

    for (const proposal of reply.proposals) {
        yield* sendProposal(chatId, locale, proposal);
    }
});
