import { isDefined } from '@rnw-community/shared';
import { isAdminOf } from '@rondo/core/access/admin-access';
import { communityProfile, findLinkedChat, moveChat } from '@rondo/core/community/community.repository';
import { resolveLocale } from '@rondo/core/i18n/locale';
import { displayNameOf, syncMember } from '@rondo/core/identity/telegram-user';
import { ingestGroupMessage } from '@rondo/core/live/live-ingest';
import { recordPollCopy } from '@rondo/core/signups/record-poll-copy';
import { recordLineupCopy } from '@rondo/core/teams/record-lineup-copy';
import { learnVenuePin } from '@rondo/core/venues/venue.service';
import { Telegram } from '@rondo/telegram/service/telegram.service';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { noFollowUp, type FollowUp } from '../context/follow-up';
import { sendPrivate } from '../context/private-chat';
import { proposeToAdmin } from '../context/propose-to-admin';
import { toTelegramUser } from '../context/telegram-user.mapper';
import { topicOf } from '../context/topic-of';
import { bindTopic, isTopicAwaited } from '../menu/groups/topic-awaited';
import { menuText } from '../menu/menu-text';

import { tellMoved } from './bot-membership.handler';
import { syncGroupUsers } from './chat-member.handler';
import { proposeUnknownPlace } from './unknown-place.handler';

import type { Message } from '@rondo/telegram/webhook/telegram-update.model';

const recordBotCopy = Effect.fn('Bot.recordBotCopy')(function* (communityId: string, message: Message, body: string) {
    const chatId = BigInt(message.chat.id);

    if (isDefined(message.poll)) {
        return yield* recordPollCopy({ communityId, pollId: message.poll.id, chatId, messageId: message.message_id });
    }

    const { botId } = yield* Telegram;

    if (message.forward_origin?.sender_user?.id === botId) {
        yield* recordLineupCopy({ communityId, chatId, messageId: message.message_id, text: body });

        return true;
    }

    return false;
});

export const handleGroupMessage = Effect.fn('Bot.handleGroupMessage')(function* (message: Message) {
    const sender = message.from;
    const body = message.text ?? message.caption;

    if (isDefined(message.migrate_to_chat_id)) {
        yield* moveChat(BigInt(message.chat.id), BigInt(message.migrate_to_chat_id));
        yield* tellMoved(message.migrate_to_chat_id);

        return noFollowUp;
    }

    if (!isDefined(sender) || sender.is_bot) {
        return noFollowUp;
    }

    if (yield* isTopicAwaited(sender.id, message.chat.id)) {
        yield* bindTopic(sender.id, message.chat, topicOf(message));
    }

    const chat = yield* findLinkedChat(BigInt(message.chat.id));

    if (Option.isNone(chat)) {
        return noFollowUp;
    }

    const { communityId, topicId, purpose, title: groupTitle } = chat.value;
    const user = toTelegramUser(sender);
    const personId = yield* syncMember(communityId, user, 'active');
    const isTrusted = topicOf(message) === topicId && (yield* isAdminOf(user.id, communityId));
    yield* syncGroupUsers(communityId, message.new_chat_members ?? [], 'active');
    yield* syncGroupUsers(communityId, isDefined(message.left_chat_member) ? [message.left_chat_member] : [], 'left');

    if (isDefined(message.venue) && isTrusted) {
        const { title, address, location } = message.venue;
        yield* learnVenuePin({
            communityId,
            actorPersonId: personId,
            title,
            address,
            lat: location.latitude,
            lng: location.longitude
        });
    }

    if (yield* recordBotCopy(communityId, message, body ?? '')) {
        return noFollowUp;
    }

    const profile = yield* communityProfile(communityId);
    const config = profile.pipe(Option.flatMap(value => value.config));

    if (Option.isNone(config)) {
        return noFollowUp;
    }

    const result = yield* ingestGroupMessage(communityId, config.value, {
        chatId: BigInt(message.chat.id),
        isMain: purpose === 'main',
        messageId: message.message_id,
        sentAt: DateTime.toDate(DateTime.makeUnsafe(message.date * 1000)),
        senderPersonId: personId,
        senderTgUserId: user.id,
        senderName: displayNameOf(user),
        isTrusted,
        ...(isDefined(body) ? { text: body } : {}),
        ...(isDefined(message.poll)
            ? { poll: { question: message.poll.question, answers: message.poll.options.map(option => option.text) } }
            : {})
    });

    if (result.isSquadSkipped === true) {
        yield* sendPrivate(sender.id, menuText(resolveLocale(sender.language_code), 'squadSkipped', { title: groupTitle })).pipe(
            Effect.catchTag('TelegramApiError', error => Effect.logWarning('[group] skipped squad not told', error))
        );
    }

    if (isDefined(result.cancellation)) {
        // Telegram refuses a private message to an admin who never opened the bot, and that must not fail the update
        yield* proposeToAdmin(communityId, user, { _tag: 'cancel_session', ...result.cancellation, notify: false }).pipe(
            Effect.catchTag('TelegramApiError', error => Effect.logWarning('[group] proposal not delivered', error))
        );
    }

    if (result.poll || result.lineup || isDefined(result.cancellation)) {
        yield* Effect.logInfo('[group] extracted', {
            poll: result.poll,
            lineup: result.lineup,
            cancellation: isDefined(result.cancellation),
            unknownPlace: isDefined(result.unknownPlace)
        });
    }

    const followUp: FollowUp = Option.fromNullishOr(result.unknownPlace).pipe(
        Option.map(place => proposeUnknownPlace(communityId, user, place))
    );

    return followUp;
});
