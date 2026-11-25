import { isDefined, isNotEmptyArray, isNotEmptyString } from '@rnw-community/shared';
import { cancelReasonText, formatSessionLabel } from '@rondo/core/i18n/messages';
import { dayChoices, placeSizes, rankVenues, timeChoices } from '@rondo/core/menu/game-suggestions';
import { escapeHtml } from '@rondo/telegram/format/html';

import { buttonBudget } from '../../utils/button-budget.util';
import { dayLabel } from '../../utils/day-label.util';
import { fitLabel } from '../../utils/fit-label.util';
import { toShortId } from '../../utils/to-short-id.util';
import { navRow } from '../games.screen';
import { menuText, type MenuKey } from '../menu-text';
import { venuePage } from '../venue-page';

import type { NewGameData } from '../new-game/draft';
import type { MenuButton, MenuUser, Screen } from '../screen.interface';
import type { GameListView } from './game-draft';
import type { SessionView } from '@rondo/core/sessions/session.model';

type ButtonOf = (text: string, choice: string, arg: string) => MenuButton;

interface ListContext {
    readonly user: MenuUser;
    readonly game: SessionView;
    readonly data: NewGameData;
    readonly page: number;
    readonly button: ButtonOf;
}

const reasons = ['weather', 'low_turnout', 'venue', 'holiday', 'organizer', 'other'] as const;
const full = buttonBudget(1);
const newPlaceSizes = [14, 18, 22];

const chunk = (buttons: readonly MenuButton[], size: number): MenuButton[][] =>
    Array.from({ length: Math.ceil(buttons.length / size) }, (_, index) => buttons.slice(index * size, index * size + size));

const capitalized = (value: string): string => `${value.charAt(0).toUpperCase()}${value.slice(1)}`;

const timeRows = ({ user, game, data, button }: ListContext) => {
    const times = timeChoices(data.history, game.venueId, game.localDate, game.localTime).filter(
        time => time !== game.localTime && (game.localDate !== data.today || time > data.nowTime)
    );

    return isNotEmptyArray(times)
        ? chunk(
              times.map(time => button(time, 'ts', time.replace(':', ''))),
              3
          )
        : [[button(menuText(user.locale, 'otherDay'), 'dd', '')]];
};

const dayRows = ({ user, game, data, button }: ListContext) => {
    const days = dayChoices(data.history, data.today, { today: false })
        .toSorted()
        .filter(day => day !== game.localDate);
    const withToday = game.localDate !== data.today && data.nowTime < game.localTime;
    const today = menuText(user.locale, 'todayLabel', { date: dayLabel(user.locale, data.today).slice(3) });

    return [
        ...chunk(
            days.map(day => button(dayLabel(user.locale, day), 'ds', day.replaceAll('-', ''))),
            2
        ),
        ...(withToday ? [[button(today, 'ds', data.today.replaceAll('-', ''))]] : [])
    ];
};

const placeRows = ({ user, game, data, button }: ListContext) => {
    const others = data.venues.filter(venue => venue.id !== game.venueId);
    const top = rankVenues(data.history, others, game.localDate).slice(0, 3);

    return [
        ...top.map(venue => [button(fitLabel(venue.name, full), 'vs', toShortId(venue.id))]),
        [
            ...(others.length > top.length ? [button(menuText(user.locale, 'allPlacesButton'), 'vl', '0')] : []),
            button(menuText(user.locale, 'newPlace'), 'vn', '')
        ]
    ];
};

const venueRows = ({ user, game, data, page, button }: ListContext) => {
    const { shown, pages } = venuePage(
        data.venues.filter(venue => venue.id !== game.venueId),
        page
    );

    return [
        ...shown.map(venue => [button(fitLabel(venue.name, full), 'vs', toShortId(venue.id))]),
        ...(isNotEmptyArray(pages) ? [pages.map(entry => button(entry.label, 'vl', String(entry.page)))] : []),
        [button(menuText(user.locale, 'newPlace'), 'vn', '')]
    ];
};

const sizeRows = ({ user, game, data, button }: ListContext) => {
    const current = game.capacityMax;
    const known = placeSizes(data.history, game.venueId);
    const sizes = (isNotEmptyArray(known) ? known : newPlaceSizes).filter(size => size !== current).toSorted((left, right) => left - right);
    const step = isDefined(current)
        ? [
              [
                  ...(current > 1 ? [button('−1', 'zs', String(current - 1))] : []),
                  button(`👥 ${current}`, 'z', ''),
                  ...(current < 99 ? [button('+1', 'zs', String(current + 1))] : [])
              ]
          ]
        : [];

    return [
        ...step,
        ...chunk(
            sizes.map(size => button(`👥 ${size}`, 'zs', String(size))),
            3
        ),
        ...(isDefined(current) ? [[button(menuText(user.locale, 'noLimit'), 'zs', '0')]] : [])
    ];
};

const rowsOf: Readonly<Record<GameListView, (context: ListContext) => MenuButton[][]>> = {
    time: timeRows,
    day: dayRows,
    place: placeRows,
    venues: venueRows,
    venue_name: () => [],
    size: sizeRows,
    cancel: ({ user, button }) => reasons.map(reason => [button(capitalized(cancelReasonText(user.locale, reason)), 'xr', reason)]),
    teams: ({ user, button }) => [[2, 3].map(count => button(menuText(user.locale, 'teamCount', { count }), 'kn', String(count)))]
};

const prompts: Readonly<Record<GameListView, MenuKey>> = {
    time: 'pickTime',
    day: 'pickDay',
    place: 'pickPlace',
    venues: 'allPlaces',
    venue_name: 'newPlaceName',
    size: 'pickSize',
    cancel: 'cancelWhy',
    teams: 'teams'
};

export const gameListScreen = (
    user: MenuUser,
    game: SessionView,
    data: NewGameData,
    list: { readonly view: GameListView; readonly page: number; readonly notice: MenuKey | null }
): Screen => {
    const id = toShortId(game.id);
    const button: ButtonOf = (text, pick, arg) => ({ text, callback_data: `c:${pick}:${id}${isNotEmptyString(arg) ? `:${arg}` : ''}` });
    const back = list.view === 'venues' || list.view === 'venue_name' ? `c:v:${id}` : `m:g:${id}`;

    return {
        text: `⚽ <b>${escapeHtml(formatSessionLabel(user.locale, game))}</b>\n${menuText(user.locale, list.notice ?? prompts[list.view])}`,
        keyboard: [...rowsOf[list.view]({ user, game, data, page: list.page, button }), navRow(user.locale, back)]
    };
};
