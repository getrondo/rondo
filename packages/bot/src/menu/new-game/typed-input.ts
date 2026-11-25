import { isDefined, isNotEmptyString } from '@rnw-community/shared';
import { addDays } from '@rondo/core/utils/add-days.util';
import { weekdayOf } from '@rondo/core/utils/weekday-of.util';

import { parseDate } from '../../utils/parse-date.util';
import { parsePreview, type PreviewInput } from '../../utils/parse-preview.util';
import { parseTime } from '../../utils/parse-time.util';

import { advance, isPastToday, withPlaces } from './new-game.flow';

import type { MenuKey } from '../menu-text';
import type { Draft, DraftView, NewGameData } from './draft';

export type TypedOutcome =
    | { readonly _tag: 'draft'; readonly draft: Draft }
    | { readonly _tag: 'invalid'; readonly notice: MenuKey }
    | { readonly _tag: 'pass' };

const invalid = (notice: MenuKey): TypedOutcome => ({ _tag: 'invalid', notice });

const dateOf = (text: string, data: NewGameData): { readonly value: string } | { readonly notice: MenuKey } | null => {
    const parsed = parseDate(text, data.today);

    switch (parsed._tag) {
        case 'date': {
            return { value: parsed.value };
        }
        case 'past': {
            return { notice: 'pastDate' };
        }
        case 'bad': {
            return { notice: 'badDate' };
        }
        case 'other': {
            return null;
        }
        default: {
            return null;
        }
    }
};

const typedDate = (draft: Draft, text: string, data: NewGameData): TypedOutcome => {
    const parsed = dateOf(text, data);

    if (!isDefined(parsed)) {
        return { _tag: 'pass' };
    }

    if ('notice' in parsed) {
        return invalid(parsed.notice);
    }

    return isPastToday(data, parsed.value, draft.localTime)
        ? invalid('pastTime')
        : { _tag: 'draft', draft: advance({ ...draft, localDate: parsed.value }) };
};

const typedTime = (draft: Draft, text: string, data: NewGameData): TypedOutcome => {
    const parsed = parseTime(text);

    if (parsed._tag === 'other') {
        return { _tag: 'pass' };
    }

    if (parsed._tag === 'bad') {
        return invalid('badTime');
    }

    return isPastToday(data, draft.localDate, parsed.value)
        ? invalid('pastTime')
        : { _tag: 'draft', draft: advance({ ...draft, localTime: parsed.value }) };
};

const typedPlaces = (draft: Draft, text: string): TypedOutcome => {
    const value = text.trim();

    if (!/^\d+$/u.test(value)) {
        return { _tag: 'pass' };
    }

    const places = Number(value);

    return places >= 1 && places <= 99 ? { _tag: 'draft', draft: withPlaces(draft, places) } : invalid('badPlaces');
};

const previewDate = (input: PreviewInput, draft: Draft, data: NewGameData) => {
    if (isDefined(input.weekday)) {
        const tomorrow = addDays(data.today, 1);

        return { value: addDays(tomorrow, (input.weekday - weekdayOf(tomorrow) + 7) % 7) };
    }

    return isDefined(input.date) ? dateOf(input.date, data) : { value: draft.localDate };
};

const typedPreview = (draft: Draft, text: string, data: NewGameData): TypedOutcome => {
    const input = isDefined(draft.sessionId) ? null : parsePreview(text);
    const date = isDefined(input) ? previewDate(input, draft, data) : null;

    if (!isDefined(input) || !isDefined(date)) {
        return { _tag: 'pass' };
    }

    if ('notice' in date) {
        return invalid(date.notice);
    }

    const localTime = input.time ?? draft.localTime;
    const places = input.places ?? draft.places;

    if (isDefined(input.places) && input.places < 1) {
        return invalid('badPlaces');
    }

    if (isPastToday(data, date.value, localTime) || (isDefined(input.time) && parseTime(input.time)._tag !== 'time')) {
        return invalid(isDefined(input.time) && parseTime(input.time)._tag !== 'time' ? 'badTime' : 'pastTime');
    }

    return {
        _tag: 'draft',
        draft: advance({ ...draft, localDate: date.value, localTime, places, custom: draft.custom || isDefined(input.places) })
    };
};

const typedBy: Partial<Record<DraftView, (draft: Draft, text: string, data: NewGameData) => TypedOutcome>> = {
    main: typedPreview,
    day: typedDate,
    time: typedTime,
    size: (draft, text) => typedPlaces(draft, text),
    note: (draft, text) => ({
        _tag: 'draft',
        draft: advance({
            ...draft,
            note: text
                .split('\n')
                .map(line => line.trim())
                .filter(line => isNotEmptyString(line))
                .join('\n')
        })
    })
};

export const applyText = (draft: Draft, text: string, data: NewGameData): TypedOutcome =>
    typedBy[draft.view]?.(draft, text, data) ?? { _tag: 'pass' };
