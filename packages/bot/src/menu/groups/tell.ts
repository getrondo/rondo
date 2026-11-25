import { Access } from '@rondo/core/access/admin-access';
import { recipientsOf } from '@rondo/core/access/recipients-of';
import { approverOf } from '@rondo/core/community/group-settings';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { notifyOwnersOfFailure } from '../../jobs/notify-owners';
import { showScreen } from '../show-screen';

import type { Screen } from '../screen.interface';
import type { Locale } from '@rondo/core/i18n/locale';

type ScreenIn = (locale: Locale) => Screen;

const send = (tgUserId: bigint, locale: Locale, screenIn: ScreenIn) =>
    showScreen(Number(tgUserId), null, screenIn(locale)).pipe(
        Effect.as(true),
        Effect.catchTag('TelegramApiError', error =>
            Effect.logWarning('[groups] not told', { isUncertain: error.isUncertain }).pipe(Effect.as(error.isUncertain))
        )
    );

export const tellOwners = Effect.fn('Bot.tellOwners')(function* (screenIn: ScreenIn) {
    const access = yield* Access;

    for (const owner of yield* recipientsOf([...access.ownerTgUserIds])) {
        yield* send(owner.tgUserId, owner.locale, screenIn);
    }
});

export const tellNoApprover = DateTime.nowAsDate.pipe(Effect.flatMap(now => notifyOwnersOfFailure('ownerNoApprover', 1, now)));

// Nobody else can answer for a group, so the owners learn when the approver does not hear it
export const tellApprover = Effect.fn('Bot.tellApprover')(function* (communityId: string, screenIn: ScreenIn) {
    const approver = yield* approverOf(communityId);
    const isHeard = Option.isSome(approver) && (yield* send(approver.value.tgUserId, approver.value.locale, screenIn));

    if (!isHeard) {
        yield* tellNoApprover;
    }
});
