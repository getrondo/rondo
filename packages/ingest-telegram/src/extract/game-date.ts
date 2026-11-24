import { isDefined } from '@rnw-community/shared';

import { addDays, weekdayOf } from './zoned-time';

const weekdays: readonly (readonly [number, RegExp])[] = [
    [1, /понед[еі]л/iu],
    [2, /вторн|вівтор/iu],
    [3, /сред[ауы]|серед/iu],
    [4, /четв/iu],
    [5, /пятниц|пʼятниц|п'ятниц|пятн/iu],
    [6, /суббот|субот/iu],
    [0, /воскрес|неділ/iu]
];

const months: readonly (readonly [number, RegExp])[] = [
    [1, /январ|січ/iu],
    [2, /феврал|лют/iu],
    [3, /март|берез/iu],
    [4, /апрел|квіт/iu],
    [5, /ма[яйе]\b|травн/iu],
    [6, /июн|черв/iu],
    [7, /июл|лип/iu],
    [8, /август|серп/iu],
    [9, /сентябр|верес/iu],
    [10, /октябр|жовт/iu],
    [11, /ноябр|нобяр|листоп/iu],
    [12, /декабр|груд/iu]
];

const explicitDatePattern = /(\d{1,2})\s*(?:-?го\s+)?([\p{Script=Cyrillic}ʼ']+)/giu;
const localTimePattern = /(?<!\d)(1\d|2[0-3]|0?9)\s?[.:-]\s?(00|15|30|45)(?!\d)/gu;

const findWeekday = (text: string): number | undefined => weekdays.find(([, regex]) => regex.test(text))?.[0];

const toIsoDate = (month: number, day: number, postedDate: string): string => {
    const postedYear = Number(postedDate.slice(0, 4));
    const postedMonth = Number(postedDate.slice(5, 7));
    const year = month < postedMonth - 6 ? postedYear + 1 : postedYear;

    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const explicitDate = (text: string, postedDate: string): string | undefined =>
    text
        .matchAll(explicitDatePattern)
        .toArray()
        .flatMap(match => {
            const day = Number(match[1]);
            const month = months.find(([, regex]) => regex.test(match[2] ?? ''))?.[0];

            return isDefined(month) && day >= 1 && day <= 31 ? [toIsoDate(month, day, postedDate)] : [];
        })
        .at(0);

export const resolveGameDate = (text: string, postedDate: string): { date: string; confidence: number } => {
    const explicit = explicitDate(text, postedDate);

    if (isDefined(explicit)) {
        return { date: explicit, confidence: 0.95 };
    }

    if (/сегодня|сьогодні/iu.test(text)) {
        return { date: postedDate, confidence: 0.9 };
    }

    if (/завтра/iu.test(text)) {
        return { date: addDays(postedDate, 1), confidence: 0.9 };
    }

    const weekday = findWeekday(text);

    if (isDefined(weekday)) {
        const delta = (weekday - weekdayOf(postedDate) + 7) % 7;

        return { date: addDays(postedDate, delta), confidence: 0.8 };
    }

    return { date: postedDate, confidence: 0.4 };
};

export const findLocalTime = (text: string): string | undefined =>
    text
        .matchAll(localTimePattern)
        .toArray()
        .map(match => `${(match[1] ?? '').padStart(2, '0')}:${match[2]}`)
        .at(0);
