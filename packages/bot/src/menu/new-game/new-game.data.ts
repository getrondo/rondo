import { isNotEmptyArray } from '@rnw-community/shared';
import { linkedChatsOf } from '@rondo/core/community/community.repository';
import { footballHistory, lastPollChatOf, plannedFootball, venueChoices } from '@rondo/core/menu/game-history.repository';
import { addDays } from '@rondo/core/utils/add-days.util';
import * as Effect from 'effect/Effect';

import type { MenuUser } from '../screen.interface';
import type { NewGameData } from './draft';

const weeklyKinds = ['training'] as const;
const historyDays = 400;

export const loadNewGameData = Effect.fn('Bot.loadNewGameData')(function* (user: MenuUser) {
    const history = yield* footballHistory(user.communityId, addDays(user.today, -historyDays), weeklyKinds);
    const planned = yield* plannedFootball(user.communityId, user.today);
    const venues = yield* venueChoices(user.communityId, weeklyKinds);
    const linked = yield* linkedChatsOf(user.communityId);
    const chats = linked.map(chat => ({ id: String(chat.chatId), title: chat.title }));
    const lastChatId = yield* lastPollChatOf(user.tgUserId);

    return {
        history,
        planned,
        venues,
        today: user.today,
        nowTime: user.nowTime,
        hasGroup: isNotEmptyArray(chats),
        chats,
        selfChatId: String(user.tgUserId),
        lastChatId
    } satisfies NewGameData;
});
