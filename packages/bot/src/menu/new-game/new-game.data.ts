import { mainGroupOf } from '@rondo/core/community/community.repository';
import { footballHistory, plannedFootball, venueChoices } from '@rondo/core/menu/game-history.repository';
import { addDays } from '@rondo/core/utils/add-days.util';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import type { MenuUser } from '../screen.interface';
import type { NewGameData } from './draft';

const weeklyKinds = ['training'] as const;
const historyDays = 400;

export const loadNewGameData = Effect.fn('Bot.loadNewGameData')(function* (user: MenuUser) {
    const history = yield* footballHistory(user.communityId, addDays(user.today, -historyDays), weeklyKinds);
    const planned = yield* plannedFootball(user.communityId, user.today);
    const venues = yield* venueChoices(user.communityId, weeklyKinds);
    const group = yield* mainGroupOf(user.communityId);

    return { history, planned, venues, today: user.today, nowTime: user.nowTime, hasGroup: Option.isSome(group) } satisfies NewGameData;
});
