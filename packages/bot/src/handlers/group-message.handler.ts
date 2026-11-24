import { isDefined } from '@rnw-community/shared';
import { adminCommunityIds, isAdminOf } from '@rondo/core/access/admin-access';
import { bindChat, communityProfile, findLinkedChat, findCommunityBySlug } from '@rondo/core/community/community.repository';
import { text } from '@rondo/core/i18n/messages';
import { displayNameOf, syncMember } from '@rondo/core/identity/telegram-user';
import { ingestGroupMessage } from '@rondo/core/live/live-ingest';
import { topicOptions } from '@rondo/core/utils/topic-options.util';
import { learnVenuePin } from '@rondo/core/venues/venue.service';
import { Telegram } from '@rondo/telegram/service/telegram.service';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { proposeToAdmin } from '../context/propose-to-admin';
import { toTelegramUser } from '../context/telegram-user.mapper';
import { topicOf } from '../context/topic-of';

import { syncGroupUsers } from './chat-member.handler';
import { proposeUnknownPlace } from './unknown-place.handler';

import type { Message } from 'grammy/types';

const linkCommand = /^\/link(?:@\w+)?\s+(\S+)/u;

const handleLink = Effect.fn('Bot.handleLink')(function* (message: Message, slug: string) {
    const telegram = yield* Telegram;
    const sender = message.from;
    const reply = (body: string) =>
        telegram.call('sendMessage', api =>
            api.sendMessage(message.chat.id, body, {
                reply_parameters: { message_id: message.message_id },
                ...topicOptions({ topicId: topicOf(message) })
            })
        );
    const communityId = yield* findCommunityBySlug(slug);

    if (!isDefined(sender) || Option.isNone(communityId) || !(yield* adminCommunityIds(BigInt(sender.id))).includes(communityId.value)) {
        yield* reply(text('uk', 'unknownCommunity'));

        return;
    }

    if (message.chat.type !== 'group' && message.chat.type !== 'supergroup') {
        return;
    }

    yield* bindChat({
        communityId: communityId.value,
        chatId: BigInt(message.chat.id),
        topicId: topicOf(message),
        kind: message.chat.type,
        title: message.chat.title
    });
    yield* reply(`${text('uk', 'linked')}: ${slug}`);
});

export const handleGroupMessage = Effect.fn('Bot.handleGroupMessage')(function* (message: Message) {
    const sender = message.from;
    const body = message.text ?? message.caption;

    if (!isDefined(sender) || sender.is_bot) {
        return;
    }

    const link = linkCommand.exec(body ?? '');

    if (isDefined(link)) {
        yield* handleLink(message, link[1] ?? '');

        return;
    }

    const chat = yield* findLinkedChat(BigInt(message.chat.id));

    if (Option.isNone(chat)) {
        return;
    }

    const { communityId, topicId } = chat.value;
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

    const profile = yield* communityProfile(communityId);
    const config = profile.pipe(Option.flatMap(value => value.config));

    if (Option.isNone(config)) {
        return;
    }

    const result = yield* ingestGroupMessage(communityId, config.value, {
        chatId: BigInt(message.chat.id),
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

    if (isDefined(result.cancellation)) {
        // Telegram refuses a private message to an admin who never opened the bot, and that must not fail the update
        yield* proposeToAdmin(communityId, user, { _tag: 'cancel_session', ...result.cancellation, notify: false }).pipe(
            Effect.catchTag('TelegramApiError', error => Effect.logWarning('[group] proposal not delivered', error))
        );
    }

    if (isDefined(result.unknownPlace)) {
        yield* proposeUnknownPlace(communityId, user, result.unknownPlace);
    }

    if (result.poll || result.lineup || isDefined(result.cancellation)) {
        yield* Effect.logInfo('[group] extracted', result);
    }
});
