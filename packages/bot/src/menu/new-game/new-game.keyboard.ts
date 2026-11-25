import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { dayChoices, placeSizes, rankTimes, rankVenues, timeChoices } from '@rondo/core/menu/game-suggestions';

import { buttonBudget } from '../../utils/button-budget.util';
import { dayLabel } from '../../utils/day-label.util';
import { fitLabel } from '../../utils/fit-label.util';
import { labelWidth } from '../../utils/label-width.util';
import { toShortId } from '../../utils/to-short-id.util';
import { menuText } from '../menu-text';

import { candidatesOf, destinationOf, isSelfAudience } from './new-game.flow';

import type { MenuButton } from '../screen.interface';
import type { Draft, NewGameData, VenueChoice } from './draft';
import type { Locale } from '@rondo/core/i18n/locale';

type Rows = MenuButton[][];

const pageSize = 5;

const chunk = (buttons: readonly MenuButton[], size: number): Rows =>
    Array.from({ length: Math.ceil(buttons.length / size) }, (_, index) => buttons.slice(index * size, index * size + size));

const marked = (label: string, isCurrent: boolean): string => (isCurrent ? `✓ ${label}` : label);

export const venueLabel = (data: NewGameData, venueId: string | null): string =>
    data.venues.find(entry => entry.id === venueId)?.label ?? '—';

const full = buttonBudget(1);

const destinationLabel = (draft: Draft, data: NewGameData, locale: Locale): string => {
    const announce = isDefined(draft.sessionId);

    if (isSelfAudience(draft, data)) {
        return menuText(locale, announce ? 'sendExistingMe' : 'sendMe');
    }

    const key = announce ? 'postExistingTo' : 'postTo';
    const room = full - labelWidth(menuText(locale, key, { where: '' }));

    return menuText(locale, key, { where: fitLabel(destinationOf(draft, data), room) });
};

const mainRows = (
    draft: Draft,
    data: NewGameData,
    locale: Locale,
    button: (text: string, op: string, arg?: string) => MenuButton
): Rows => {
    const other = candidatesOf(data).find(candidate => candidate.localDate !== draft.localDate);
    const otherLabel =
        other?._tag === 'new'
            ? fitLabel(`${dayLabel(locale, other.localDate)} ${other.localTime} · ${venueLabel(data, other.venueId)}`, full)
            : `📣 ${isDefined(other) ? dayLabel(locale, other.localDate) : ''}`;
    const otherRow = isDefined(other) && !draft.manual ? [[button(otherLabel, 'a', other.localDate.replaceAll('-', ''))]] : [];
    const first = [button(destinationLabel(draft, data, locale), 'ok')];
    const closing = [button(menuText(locale, 'where'), 'au'), button(menuText(locale, 'manual'), 'm'), button('✖️', 'x')];

    if (isDefined(draft.sessionId)) {
        return [first, ...otherRow, closing];
    }

    const venue = data.venues.find(entry => entry.id === draft.venueId);
    const manualRow = draft.manual ? [[button(menuText(locale, 'save'), 'sv'), button(menuText(locale, 'note'), 'nt')]] : [];
    const addressRow = isDefined(venue) && !venue.located ? [[button(menuText(locale, 'address'), 'ad')]] : [];

    return [
        first,
        ...otherRow,
        ...manualRow,
        [button('👥 −', 'p-'), button(`👥 ${draft.places ?? '♾'}`, 'pz'), button('👥 +', 'p+')],
        [
            button(`🕖 ${draft.localTime ?? '—'}`, 't'),
            button(`📅 ${isDefined(draft.localDate) ? dayLabel(locale, draft.localDate) : '—'}`, 'd')
        ],
        [button(fitLabel(`📍 ${venueLabel(data, draft.venueId)}`, full), 'v')],
        ...addressRow,
        closing
    ];
};

const venueButtons = (venues: readonly VenueChoice[], draft: Draft, button: (text: string, op: string, arg?: string) => MenuButton) =>
    venues.map(venue => [button(fitLabel(marked(venue.name, venue.id === draft.venueId), full), 'vs', toShortId(venue.id))]);

const listRows = (
    draft: Draft,
    data: NewGameData,
    locale: Locale,
    button: (text: string, op: string, arg?: string) => MenuButton
): Rows => {
    const localDate = draft.localDate ?? data.today;

    switch (draft.view) {
        case 'day': {
            const today = data.nowTime < (draft.localTime ?? '23:00');
            const days = dayChoices(data.history, data.today, { today });

            return chunk(
                days.map(day => button(marked(dayLabel(locale, day), day === draft.localDate), 'ds', day.replaceAll('-', ''))),
                2
            );
        }
        case 'time': {
            const times = isDefined(draft.localTime)
                ? timeChoices(data.history, draft.venueId, localDate, draft.localTime)
                : rankTimes(data.history, draft.venueId, localDate).slice(0, 6).toSorted();
            const ahead = times.filter(time => localDate !== data.today || time > data.nowTime);

            return chunk(
                ahead.map(time => button(marked(time, time === draft.localTime), 'ts', time.replace(':', ''))),
                3
            );
        }
        case 'place': {
            const top = rankVenues(data.history, data.venues, localDate).slice(0, 3);

            return [
                ...venueButtons(top, draft, button),
                [button(menuText(locale, 'otherPlace'), 'vl', '0'), button(menuText(locale, 'newPlace'), 'vn')]
            ];
        }
        case 'venues': {
            const all = data.venues.toSorted((left, right) => left.name.localeCompare(right.name));
            const page = all.slice(draft.page * pageSize, draft.page * pageSize + pageSize);
            const paging = [
                ...(draft.page > 0 ? [button('◀️', 'vl', String(draft.page - 1))] : []),
                ...((draft.page + 1) * pageSize < all.length ? [button('▶️', 'vl', String(draft.page + 1))] : [])
            ];

            return [
                ...venueButtons(page, draft, button),
                ...(isNotEmptyArray(paging) ? [paging] : []),
                [button(menuText(locale, 'newPlace'), 'vn')]
            ];
        }
        case 'size': {
            const sizes = [
                ...new Set([...(isDefined(draft.places) ? [draft.places] : []), ...placeSizes(data.history, draft.venueId).slice(0, 4)])
            ].toSorted((left, right) => left - right);

            return [
                ...chunk(
                    sizes.map(size => button(marked(`👥 ${size}`, draft.sized && size === draft.places), 'ps', String(size))),
                    3
                ),
                [button(marked(menuText(locale, 'noLimit'), draft.sized && !isDefined(draft.places)), 'ps', '0')],
                [1, 2, 3].map(count => button(marked(menuText(locale, 'fields', { count }), draft.fields === count), 'pf', String(count)))
            ];
        }
        case 'map':
        case 'address': {
            return [[button(menuText(locale, 'skip'), 'ms')]];
        }
        case 'note': {
            return [[button(menuText(locale, 'noNote'), 'nn')]];
        }
        case 'main':
        case 'venue_name': {
            return [];
        }
        default: {
            return [];
        }
    }
};

export const newGameKeyboard = (draft: Draft, data: NewGameData, locale: Locale, revision: number): Rows => {
    const button = (text: string, op: string, arg?: string): MenuButton => ({
        text,
        callback_data: `n:${revision}:${op}${isDefined(arg) ? `:${arg}` : ''}`
    });

    if (draft.view === 'main') {
        return mainRows(draft, data, locale, button);
    }

    const back = draft.manual && draft.view === 'day' ? [] : [[button(menuText(locale, 'back'), 'b')]];

    return [...listRows(draft, data, locale, button), ...back, ...(draft.manual && draft.view === 'day' ? [[button('✖️', 'x')]] : [])];
};
