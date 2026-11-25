import { isDefined, isNotEmptyString } from '@rnw-community/shared';
import { personIdOfTelegramUser } from '@rondo/core/identity/telegram-user';
import { takeAwaiting } from '@rondo/core/menu/admin-state.repository';
import { requireSession } from '@rondo/core/sessions/session.service';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

import { parseDate } from '../../utils/parse-date.util';
import { parseTime } from '../../utils/parse-time.util';
import { loadNewGameData } from '../new-game/new-game.data';
import { placeOfName } from '../new-game/place-input';

import { GameDraftSchema, type GameDraft } from './game-draft';
import { showConfirm, showGameList } from './show-confirm';

import type { MenuKey } from '../menu-text';
import type { NewGameData } from '../new-game/draft';
import type { MenuUser } from '../screen.interface';
import type { Action } from '@rondo/core/actions/action.model';
import type { AdminStateRow } from '@rondo/core/menu/admin-state.interface';
import type { SessionView } from '@rondo/core/sessions/session.model';

type Typed =
    | { readonly _tag: 'change'; readonly change: Partial<Extract<Action, { _tag: 'update_session' }>> }
    | { readonly _tag: 'notice'; readonly notice: MenuKey }
    | null;

const decodeGameDraft = Schema.decodeUnknownOption(GameDraftSchema);

const isPast = (data: NewGameData, localDate: string, localTime: string): boolean => localDate === data.today && localTime <= data.nowTime;

const typedDay = (game: SessionView, text: string, data: NewGameData): Typed => {
    const parsed = parseDate(text, data.today);
    const notices: Readonly<Record<string, MenuKey>> = { past: 'pastDate', bad: 'badDate' };

    if (parsed._tag !== 'date') {
        const notice = notices[parsed._tag];

        return isDefined(notice) ? { _tag: 'notice', notice } : null;
    }

    return isPast(data, parsed.value, game.localTime)
        ? { _tag: 'notice', notice: 'pastTime' }
        : { _tag: 'change', change: { localDate: parsed.value } };
};

const typedTime = (game: SessionView, text: string, data: NewGameData): Typed => {
    const parsed = parseTime(text);

    if (parsed._tag === 'other') {
        return null;
    }

    if (parsed._tag === 'bad') {
        return { _tag: 'notice', notice: 'badTime' };
    }

    return isPast(data, game.localDate, parsed.value)
        ? { _tag: 'notice', notice: 'pastTime' }
        : { _tag: 'change', change: { localTime: parsed.value } };
};

const typedSize = (text: string): Typed => {
    if (!/^\d+$/u.test(text)) {
        return null;
    }

    const places = Number(text);

    return places >= 1 && places <= 99 ? { _tag: 'change', change: { capacityMax: places } } : { _tag: 'notice', notice: 'badPlaces' };
};

const typedOf = (draft: GameDraft, game: SessionView, text: string, data: NewGameData): Typed => {
    switch (draft.view) {
        case 'day': {
            return typedDay(game, text, data);
        }
        case 'time': {
            return typedTime(game, text, data);
        }
        case 'size': {
            return typedSize(text);
        }
        case 'place':
        case 'venues':
        case 'venue_name':
        case 'cancel':
        case 'teams':
        case 'confirm': {
            return null;
        }
        default: {
            return null;
        }
    }
};

const newPlace = Effect.fn('Bot.cardNewPlace')(function* (user: MenuUser, name: string) {
    const actorPersonId = yield* personIdOfTelegramUser(user.tgUserId);

    return yield* placeOfName(user, name, actorPersonId).pipe(
        Effect.map((venueId): Typed => ({ _tag: 'change', change: { venueId } })),
        Effect.catchTag('ActionFailedError', () => Effect.succeed<Typed>({ _tag: 'notice', notice: 'newPlaceName' }))
    );
});

export const handleGameInput = Effect.fn('Bot.handleGameInput')(function* (user: MenuUser, row: AdminStateRow, text: string) {
    const draft = decodeGameDraft(row.draft);

    if (Option.isNone(draft) || draft.value.view === 'confirm') {
        return false;
    }

    const game = yield* requireSession(user.communityId, draft.value.sessionId).pipe(Effect.option);

    if (Option.isNone(game)) {
        return false;
    }

    const data = yield* loadNewGameData(user);
    const typed =
        draft.value.view === 'venue_name' && isNotEmptyString(text)
            ? yield* newPlace(user, text)
            : typedOf(draft.value, game.value, text, data);

    if (!isDefined(typed)) {
        return false;
    }

    const taken = yield* takeAwaiting(user.tgUserId, row.revision, user.now);

    if (Option.isNone(taken)) {
        return false;
    }

    if (typed._tag === 'notice') {
        yield* showGameList(user, game.value, data, {
            view: draft.value.view,
            page: draft.value.page,
            notice: typed.notice,
            messageId: null
        });

        return true;
    }

    yield* showConfirm(user, { _tag: 'update_session', sessionId: game.value.id, notify: true, ...typed.change }, null);

    return true;
});
