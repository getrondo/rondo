import { isDefined, isEmptyArray } from '@rnw-community/shared';
import { mainGroupOf } from '@rondo/core/community/community.repository';
import { notifyPromoted } from '@rondo/core/notify/notifier';
import { getSession } from '@rondo/core/sessions/session.service';
import { applyPollAnswer } from '@rondo/core/signups/signup.service';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { toTelegramUser } from '../context/telegram-user.mapper';

import type { PollAnswer } from 'grammy/types';

export const handlePollAnswer = Effect.fn('Bot.handlePollAnswer')(function* (answer: PollAnswer) {
    if (!isDefined(answer.user)) {
        return;
    }

    const outcome = yield* applyPollAnswer({ pollId: answer.poll_id, user: toTelegramUser(answer.user), optionIds: answer.option_ids });

    if (Option.isNone(outcome) || isEmptyArray(outcome.value.promoted)) {
        return;
    }

    const target = yield* getSession(outcome.value.sessionId);

    if (Option.isNone(target)) {
        return;
    }

    const group = yield* mainGroupOf(target.value.communityId);

    if (Option.isSome(group)) {
        yield* notifyPromoted({ target: target.value, promoted: outcome.value.promoted, group: group.value, locale: 'uk' }).pipe(
            Effect.tapCause(Effect.logWarning),
            Effect.ignore
        );
    }
});
