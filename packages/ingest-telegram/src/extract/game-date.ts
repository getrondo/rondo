import { isDefined } from '@rnw-community/shared';
import * as Option from 'effect/Option';

import { addDays, isCalendarDate, weekdayOf } from './zoned-time';

export const statedDateConfidence = 0.8;

const weekdays: readonly (readonly [number, RegExp])[] = [
    [1, /(?:понедельник|понеділ(?:ок|ка))(?!\p{L})/iu],
    [2, /(?:вторник|вівтор(?:ок|ка))(?!\p{L})/iu],
    [3, /(?:сред[ауы]|серед[аиу])(?!\p{L})/iu],
    [4, /(?:четверг|четвер)(?!\p{L})/iu],
    [5, /(?:пятниц|пʼятниц|п'ятниц)[аеуыію]?(?!\p{L})/iu],
    [6, /(?:суббот|субот)[аеуыи]?(?!\p{L})/iu],
    [0, /(?:воскресень[ея]|неділ[яюі])(?!\p{L})/iu]
];

const months: readonly (readonly [number, RegExp])[] = [
    [1, /январ|січ/iu],
    [2, /феврал|лют/iu],
    [3, /март|берез/iu],
    [4, /апрел|квіт/iu],
    [5, /ма[яйе](?!\p{L})|травн/iu],
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

const toIsoDate = (month: number, day: number, postedDate: string): Option.Option<string> => {
    const postedYear = Number(postedDate.slice(0, 4));
    const postedMonth = Number(postedDate.slice(5, 7));
    const year = month < postedMonth - 6 ? postedYear + 1 : postedYear;

    return isCalendarDate(year, month, day)
        ? Option.some(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
        : Option.none();
};

const explicitDate = (text: string, postedDate: string): string | undefined =>
    text
        .matchAll(explicitDatePattern)
        .toArray()
        .flatMap(match => {
            const day = Number(match[1]);
            const month = months.find(([, regex]) => regex.test(match[2] ?? ''))?.[0];

            return isDefined(month) ? Option.toArray(toIsoDate(month, day, postedDate)) : [];
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

const weekdayDate = (text: string, postedDate: string): Option.Option<string> =>
    Option.fromNullishOr(findWeekday(text)).pipe(Option.map(weekday => addDays(postedDate, (weekday - weekdayOf(postedDate) + 7) % 7)));

export const withoutNumericDates = (text: string): string => text.replaceAll(/(?<!\d)\d{1,2}\.\d{1,2}(?=\D*\p{L})/gu, '');

export const resolvePollDate = (text: string, postedDate: string): { date: string; confidence: number } => {
    const resolved = resolveGameDate(text, postedDate);

    return resolved.date < postedDate
        ? weekdayDate(text, postedDate).pipe(
              Option.map(date => ({ date, confidence: statedDateConfidence })),
              Option.getOrElse(() => resolved)
          )
        : resolved;
};

export const findLocalTime = (text: string): string | undefined =>
    text
        .matchAll(localTimePattern)
        .toArray()
        .map(match => `${(match[1] ?? '').padStart(2, '0')}:${match[2]}`)
        .at(0);
