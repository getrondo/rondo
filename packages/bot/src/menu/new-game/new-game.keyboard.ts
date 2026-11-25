import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { countOf } from '@rondo/core/i18n/messages';
import { dayChoices, placeSizes, rankTimes, rankVenues, timeChoices } from '@rondo/core/menu/game-suggestions';

import { buttonBudget } from '../../utils/button-budget.util';
import { dayLabel } from '../../utils/day-label.util';
import { fitLabel } from '../../utils/fit-label.util';
import { labelWidth } from '../../utils/label-width.util';
import { toShortId } from '../../utils/to-short-id.util';
import { menuText } from '../menu-text';

import { audienceOfDraft, destinationChoices, destinationTitles, isSelfAudience, quotedTitles } from './audience';
import { candidatesOf } from './new-game.flow';

import type { MenuButton } from '../screen.interface';
import type { Draft, NewGameData, VenueChoice } from './draft';
import type { Locale } from '@rondo/core/i18n/locale';

type Rows = MenuButton[][];
type ButtonOf = (text: string, op: string, arg?: string) => MenuButton;

const pageSize = 5;
const full = buttonBudget(1);
const newPlaceSizes = [14, 18, 22];

const chunk = (buttons: readonly MenuButton[], size: number): Rows =>
    Array.from({ length: Math.ceil(buttons.length / size) }, (_, index) => buttons.slice(index * size, index * size + size));

const marked = (label: string, isCurrent: boolean): string => (isCurrent ? `✓ ${label}` : label);

export const venueLabel = (data: NewGameData, venueId: string | null): string =>
    data.venues.find(entry => entry.id === venueId)?.label ?? '—';

const fitted = (locale: Locale, key: Parameters<typeof menuText>[1], titles: readonly string[]): string => {
    const room = full - labelWidth(menuText(locale, key, { where: '' }));

    return menuText(locale, key, { where: fitLabel(quotedTitles(titles, locale), room) });
};

const postLabel = (draft: Draft, data: NewGameData, locale: Locale): string => {
    if (draft.uncertain) {
        return menuText(locale, 'retrySend');
    }

    const announce = isDefined(draft.sessionId);

    if (isSelfAudience(draft, data)) {
        return menuText(locale, announce ? 'sendExistingMe' : 'sendMe');
    }

    const titles = destinationTitles(draft, data);

    return titles.length > 1
        ? menuText(locale, announce ? 'postExistingBoth' : 'postBoth')
        : fitted(locale, announce ? 'postExistingTo' : 'postTo', titles);
};

const otherRows = (draft: Draft, data: NewGameData, locale: Locale, button: ButtonOf): Rows => {
    const other = candidatesOf(data).find(candidate => candidate.localDate !== draft.localDate);

    if (!isDefined(other) || draft.manual) {
        return [];
    }

    const short = dayLabel(locale, other.localDate).slice(0, 2);
    const what =
        other._tag === 'new' ? `${short} ${other.localTime} · ${venueLabel(data, other.venueId)}` : dayLabel(locale, other.localDate);

    return [[button(fitLabel(menuText(locale, 'otherGame', { what }), full), 'a', other.localDate.replaceAll('-', ''))]];
};

const mainRows = (draft: Draft, data: NewGameData, locale: Locale, button: ButtonOf): Rows => {
    const last = [
        ...(data.hasGroup ? [button(menuText(locale, 'where'), 'au')] : []),
        button(menuText(locale, 'manual'), 'm'),
        button(menuText(locale, 'close'), 'x')
    ];
    const first = [[button(postLabel(draft, data, locale), 'ok')]];

    if (isDefined(draft.sessionId)) {
        return [...first, ...otherRows(draft, data, locale, button), last];
    }

    const manualRows = draft.manual ? [[button(menuText(locale, 'note'), 'nt')], [button(menuText(locale, 'save'), 'sv')]] : [];

    return [
        ...first,
        [button('👥 −', 'p-'), button(`👥 ${draft.places ?? '♾'}`, 'pz'), button('👥 +', 'p+')],
        [
            button(`🕖 ${draft.localTime ?? '—'}`, 't'),
            button(`📅 ${isDefined(draft.localDate) ? dayLabel(locale, draft.localDate) : '—'}`, 'd')
        ],
        [button(fitLabel(`📍 ${venueLabel(data, draft.venueId)}`, full), 'v')],
        ...manualRows,
        ...otherRows(draft, data, locale, button),
        last
    ];
};

const venueButtons = (venues: readonly VenueChoice[], draft: Draft, button: ButtonOf) =>
    venues.map(venue => [button(fitLabel(marked(venue.name, venue.id === draft.venueId), full), 'vs', toShortId(venue.id))]);

const dayRows = (draft: Draft, data: NewGameData, locale: Locale, button: ButtonOf): Rows => {
    const withToday = data.nowTime < (draft.localTime ?? '23:00');
    const days = dayChoices(data.history, data.today, { today: false }).toSorted();
    const today = withToday
        ? [
              button(
                  marked(menuText(locale, 'todayLabel', { date: dayLabel(locale, data.today).slice(3) }), draft.localDate === data.today),
                  'ds',
                  data.today.replaceAll('-', '')
              )
          ]
        : [];

    return [
        ...chunk(
            days.map(day => button(marked(dayLabel(locale, day), day === draft.localDate), 'ds', day.replaceAll('-', ''))),
            2
        ),
        ...(isNotEmptyArray(today) ? [today] : [])
    ];
};

const sizeRows = (draft: Draft, data: NewGameData, locale: Locale, button: ButtonOf): Rows => {
    const known = placeSizes(data.history, draft.venueId).slice(0, 4);
    const sizes = [
        ...new Set([...(isDefined(draft.places) ? [draft.places] : []), ...(isNotEmptyArray(known) ? known : newPlaceSizes)])
    ].toSorted((left, right) => left - right);

    return [
        ...chunk(
            sizes.map(size => button(marked(`👥 ${size}`, draft.sized && size === draft.places), 'ps', String(size))),
            3
        ),
        [button(marked(menuText(locale, 'noLimit'), draft.sized && !isDefined(draft.places)), 'ps', '0')],
        [1, 2, 3].map(count => button(marked(countOf(locale, 'field', count), draft.fields === count), 'pf', String(count)))
    ];
};

const destinationRows = (draft: Draft, data: NewGameData, locale: Locale, button: ButtonOf): Rows => {
    const current = audienceOfDraft(draft, data).join(',');

    return destinationChoices(data).map(choice => {
        const label =
            choice.key === 'me'
                ? menuText(locale, 'onlyMe')
                : quotedTitles(
                      data.chats.filter(chat => choice.audience.includes(chat.id)).map(chat => chat.title),
                      locale
                  );

        return [button(fitLabel(marked(label, choice.audience.join(',') === current), full), 'to', choice.key)];
    });
};

const placeRows = (draft: Draft, data: NewGameData, locale: Locale, button: ButtonOf): Rows => {
    const localDate = draft.localDate ?? data.today;
    const top = rankVenues(data.history, data.venues, localDate).slice(0, 3);
    const venue = data.venues.find(entry => entry.id === draft.venueId);

    return [
        ...venueButtons(top, draft, button),
        [button(menuText(locale, 'otherPlace'), 'vl', '0'), button(menuText(locale, 'newPlace'), 'vn')],
        ...(isDefined(venue) && !venue.located ? [[button(menuText(locale, 'addAddress'), 'ad')]] : [])
    ];
};

const listRows = (draft: Draft, data: NewGameData, locale: Locale, button: ButtonOf): Rows => {
    const localDate = draft.localDate ?? data.today;

    switch (draft.view) {
        case 'day': {
            return dayRows(draft, data, locale, button);
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
            return placeRows(draft, data, locale, button);
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
            return sizeRows(draft, data, locale, button);
        }
        case 'dest': {
            return destinationRows(draft, data, locale, button);
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
    const button: ButtonOf = (text, op, arg) => ({ text, callback_data: `n:${revision}:${op}${isDefined(arg) ? `:${arg}` : ''}` });

    if (draft.view === 'main') {
        return mainRows(draft, data, locale, button);
    }

    const firstManualStep = draft.manual && draft.view === 'day' && !isDefined(draft.restore);

    return [
        ...listRows(draft, data, locale, button),
        [button(menuText(locale, firstManualStep ? 'close' : 'back'), firstManualStep ? 'x' : 'b')]
    ];
};
