import { isDefined, isNotEmptyString } from '@rnw-community/shared';

export interface PreviewInput {
    readonly weekday?: number;
    readonly date?: string;
    readonly time?: string;
    readonly places?: number;
}

const weekdays: Readonly<Record<string, number>> = {
    пн: 1,
    по: 1,
    вт: 2,
    ср: 3,
    чт: 4,
    че: 4,
    пт: 5,
    пя: 5,
    пʼ: 5,
    "п'": 5,
    сб: 6,
    су: 6,
    вс: 0,
    во: 0,
    нд: 0,
    не: 0
};

const placeWord = /^(?:місць|місця|місце|мест|места|место)$/u;

const tokenOf = (token: string): PreviewInput | null => {
    if (/^\d{1,2}:\d{2}$/u.test(token)) {
        return { time: token.padStart(5, '0') };
    }

    if (/^\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?$/u.test(token)) {
        return { date: token };
    }

    if (/^\d{1,2}$/u.test(token)) {
        return { places: Number(token) };
    }

    const weekday = /^[\p{Script=Cyrillic}ʼ']{2,12}$/u.test(token)
        ? Object.entries(weekdays).find(([prefix]) => token.startsWith(prefix))
        : null;

    return isDefined(weekday) ? { weekday: weekday[1] } : null;
};

export const parsePreview = (text: string): PreviewInput | null => {
    const words = text
        .trim()
        .toLowerCase()
        .split(/[\s,]+/u)
        .filter(word => isNotEmptyString(word));
    const tokens = words.filter((word, index) => !(placeWord.test(word) && /^\d{1,2}$/u.test(words[index - 1] ?? '')));
    const parsed = tokens.map(token => tokenOf(token));

    if (tokens.length > 3 || parsed.some(entry => !isDefined(entry))) {
        return null;
    }

    const found = parsed.filter(entry => isDefined(entry));
    const weekday = found.find(entry => isDefined(entry.weekday))?.weekday;
    const date = found.find(entry => isDefined(entry.date))?.date;
    const time = found.find(entry => isDefined(entry.time))?.time;
    const places = found.find(entry => isDefined(entry.places))?.places;

    return {
        ...(isDefined(weekday) ? { weekday } : {}),
        ...(isDefined(date) ? { date } : {}),
        ...(isDefined(time) ? { time } : {}),
        ...(isDefined(places) ? { places } : {})
    };
};
