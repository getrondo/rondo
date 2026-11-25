import { isDefined } from '@rnw-community/shared';
import { adminCommunityIds } from '@rondo/core/access/admin-access';
import { communityProfile } from '@rondo/core/community/community.repository';
import { resolveLocale } from '@rondo/core/i18n/locale';
import { localTimeOf, todayIn } from '@rondo/core/sessions/local-time';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import type { MenuUser } from './screen.interface';
import type { User } from '@rondo/telegram/webhook/telegram-update.model';

export const menuUserOf = Effect.fn('Bot.menuUserOf')(function* (from: User) {
    const tgUserId = BigInt(from.id);
    const [communityId] = yield* adminCommunityIds(tgUserId);

    if (!isDefined(communityId)) {
        return Option.none<MenuUser>();
    }

    const profile = yield* communityProfile(communityId);
    const timezone = Option.match(profile, { onNone: () => 'Europe/Vienna', onSome: value => value.timezone });
    const now = yield* DateTime.nowAsDate;

    return Option.some<MenuUser>({
        tgUserId,
        chatId: from.id,
        communityId,
        locale: resolveLocale(from.language_code),
        now,
        today: todayIn(timezone, now),
        nowTime: localTimeOf(now, timezone),
        timezone
    });
});
