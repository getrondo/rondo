import { isDefined, isNotEmptyArray, isNotEmptyString } from '@rnw-community/shared';
import { clearHistory } from '@rondo/assistant/history/conversation.repository';
import { runAssistant } from '@rondo/assistant/run-assistant';
import { communityProfile } from '@rondo/core/community/community.repository';
import { resolveLocale } from '@rondo/core/i18n/locale';
import { text } from '@rondo/core/i18n/messages';
import { displayNameOf, ensureMembership, upsertTelegramUser } from '@rondo/core/identity/telegram-user';
import { clearAdminState, loadAdminState } from '@rondo/core/menu/admin-state.repository';
import { Telegram } from '@rondo/telegram/service/telegram.service';
import { adminCommands } from '@rondo/telegram/webhook/bot-commands';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

import { noFollowUp, type FollowUp } from '../context/follow-up';
import { sendProposal } from '../context/send-proposal';
import { toTelegramUser } from '../context/telegram-user.mapper';
import { handleGameInput } from '../menu/game-actions/card-input';
import { gamesScreen } from '../menu/games.screen';
import { homeScreen, startScreen } from '../menu/home.screen';
import { menuUserOf } from '../menu/menu-user';
import { DraftSchema } from '../menu/new-game/draft';
import { handleNewGameInput, openNewGame, showNotUnderstood } from '../menu/new-game/new-game.handler';
import { showScreen } from '../menu/show-screen';

import type { MenuUser } from '../menu/screen.interface';
import type { Message } from 'grammy/types';

const telegramMessageLimit = 4000;
const commandPattern = /^\/(\w+)(?:@\w+)?/u;
const decodeDraft = Schema.decodeUnknownOption(DraftSchema);

const commandScreen = (user: MenuUser, command: string, firstName: string) => {
    if (command === 'games') {
        return gamesScreen(user);
    }

    return command === 'start' || command === 'help' ? startScreen(user, firstName) : homeScreen(user);
};

const runCommand = Effect.fn('Bot.runCommand')(function* (user: MenuUser, command: string, firstName: string) {
    const telegram = yield* Telegram;

    if (command === 'newgame') {
        yield* openNewGame(user, null);

        return;
    }

    yield* clearAdminState(user.tgUserId);

    if (command === 'reset') {
        yield* clearHistory(user.tgUserId);
        yield* telegram.call('sendMessage', api => api.sendMessage(user.chatId, '🧹'));

        return;
    }

    const shown = yield* commandScreen(user, command, firstName);
    yield* showScreen(user.chatId, null, shown);
    yield* telegram
        .call('setMyCommands', api => api.setMyCommands([...adminCommands[user.locale]], { scope: { type: 'chat', chat_id: user.chatId } }))
        .pipe(Effect.ignore);
});

const typedInput = Effect.fn('Bot.typedInput')(function* (user: MenuUser, message: Message) {
    const state = yield* loadAdminState(user.tgUserId, user.now);
    const draft = state.pipe(Option.flatMap(row => decodeDraft(row.draft)));

    if (Option.isNone(state) || !isDefined(state.value.awaiting)) {
        return false;
    }

    if (Option.isNone(draft)) {
        return yield* handleGameInput(user, state.value, message.text?.trim() ?? '');
    }

    const location = isDefined(message.location) ? { lat: message.location.latitude, lng: message.location.longitude } : null;

    return yield* handleNewGameInput(user, state.value, draft.value, { text: message.text?.trim() ?? null, location });
});

const assistantReply = Effect.fn('Bot.assistantReply')(function* (user: MenuUser, message: Message, body: string) {
    const telegram = yield* Telegram;
    const sender = toTelegramUser(message.from ?? { id: 0, is_bot: false, first_name: '' });
    const send = (reply: string) => telegram.call('sendMessage', api => api.sendMessage(user.chatId, reply.slice(0, telegramMessageLimit)));
    const personId = yield* upsertTelegramUser(sender);
    yield* ensureMembership(user.communityId, personId);
    const profile = yield* communityProfile(user.communityId);
    yield* telegram.call('sendChatAction', api => api.sendChatAction(user.chatId, 'typing')).pipe(Effect.ignore);

    const reply = yield* runAssistant({
        communityId: user.communityId,
        tgUserId: user.tgUserId,
        locale: user.locale,
        userText: body,
        prompt: {
            communityName: Option.match(profile, { onNone: () => 'Rondo', onSome: value => value.name }),
            timezone: user.timezone,
            today: user.today,
            weekday: new Intl.DateTimeFormat('en-GB', { timeZone: user.timezone, weekday: 'long' }).format(user.now),
            locale: user.locale,
            adminName: displayNameOf(sender),
            adminPersonId: personId
        }
    }).pipe(
        Effect.tapCause(Effect.logError),
        Effect.catchCause(() => Effect.succeed({ text: '', proposals: [] }))
    );

    if (!isNotEmptyString(reply.text) && !isNotEmptyArray(reply.proposals)) {
        yield* showNotUnderstood(user);

        return;
    }

    if (isNotEmptyString(reply.text)) {
        yield* send(reply.text);
    }

    for (const proposal of reply.proposals) {
        yield* sendProposal(user.chatId, user.locale, proposal);
    }
});

export const handlePrivateMessage = Effect.fn('Bot.handlePrivateMessage')(function* (message: Message) {
    const telegram = yield* Telegram;
    const sender = message.from;
    const body = message.text?.trim() ?? '';

    if (!isDefined(sender) || sender.is_bot || (!isNotEmptyString(body) && !isDefined(message.location))) {
        return noFollowUp;
    }

    yield* upsertTelegramUser(toTelegramUser(sender));
    const user = yield* menuUserOf(sender);

    if (Option.isNone(user)) {
        yield* telegram.call('sendMessage', api => api.sendMessage(message.chat.id, text(resolveLocale(sender.language_code), 'notAdmin')));

        return noFollowUp;
    }

    const command = commandPattern.exec(body)?.[1];

    if (isDefined(command)) {
        yield* runCommand(user.value, command, sender.first_name);

        return noFollowUp;
    }

    if ((yield* typedInput(user.value, message)) || !isNotEmptyString(body)) {
        return noFollowUp;
    }

    const followUp: FollowUp = Option.some(
        assistantReply(user.value, message, body).pipe(
            Effect.tapCause(cause => Effect.logError('[assistant] reply failed', cause)),
            Effect.ignore
        )
    );

    return followUp;
});
