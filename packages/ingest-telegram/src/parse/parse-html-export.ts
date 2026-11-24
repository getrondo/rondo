import { isDefined, isNotEmptyString } from '@rnw-community/shared';
import * as Option from 'effect/Option';
import { parse, type HTMLElement } from 'node-html-parser';

import { zonedToInstant } from '../extract/zoned-time';

import type { TelegramMessage } from '../model/telegram-message.model';

const mediaSelectors = [
    ['photo', '.photo_wrap'],
    ['video', '.video_file_wrap'],
    ['voice', '.media_voice_message'],
    ['sticker', '.sticker_wrap'],
    ['gif', '.animated_wrap'],
    ['file', '.media_file']
] as const;

const monthNames = [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december'
];

const offsetTitlePattern = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2}) UTC([+-]\d{2}):(\d{2})/u;
const namedTitlePattern = /^(\d{1,2}) ([A-Za-z]+) (\d{4}), (\d{2}):(\d{2}):(\d{2})$/u;

const textOf = (element: HTMLElement | null): string | undefined =>
    Option.fromNullishOr(element).pipe(
        Option.map(found => found.structuredText.trim()),
        Option.filter(text => isNotEmptyString(text)),
        Option.getOrUndefined
    );

const parseOffsetTitle = (title: string): Option.Option<Date> =>
    Option.fromNullishOr(offsetTitlePattern.exec(title)).pipe(
        Option.map(
            ([, day, month, year, hour, minute, second, offsetHour, offsetMinute]) =>
                new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${offsetHour}:${offsetMinute}`)
        )
    );

const parseNamedTitle = (title: string, timeZone: string): Option.Option<Date> =>
    Option.fromNullishOr(namedTitlePattern.exec(title.trim())).pipe(
        Option.flatMap(([, day, monthName, year, hour, minute, second]) => {
            const month = monthNames.indexOf((monthName ?? '').toLowerCase()) + 1;

            return month === 0
                ? Option.none()
                : Option.some(
                      zonedToInstant(
                          {
                              year: Number(year),
                              month,
                              day: Number(day),
                              hour: Number(hour),
                              minute: Number(minute),
                              second: Number(second)
                          },
                          timeZone
                      )
                  );
        })
    );

const parseDateTitle = (title: string | undefined, timeZone: string): Date | undefined =>
    Option.fromNullishOr(title).pipe(
        Option.flatMap(value => Option.orElse(parseOffsetTitle(value), () => parseNamedTitle(value, timeZone))),
        Option.getOrUndefined
    );

const parseLocation = (body: HTMLElement): TelegramMessage['location'] =>
    Option.fromNullishOr(body.querySelector('.media_location')?.getAttribute('href')).pipe(
        Option.flatMap(href => Option.fromNullishOr(/q=(-?\d+\.\d+),(-?\d+\.\d+)/u.exec(href))),
        Option.map(match => ({ lat: Number(match[1]), lng: Number(match[2]) })),
        Option.getOrUndefined
    );

const parsePoll = (body: HTMLElement): TelegramMessage['poll'] =>
    Option.fromNullishOr(body.querySelector('.media_poll')).pipe(
        Option.map(poll => ({
            question: textOf(poll.querySelector('.question')) ?? '',
            answers: poll.querySelectorAll('.answer').map(answer => answer.text.trim().replace(/^-\s*/u, ''))
        })),
        Option.getOrUndefined
    );

const parseReplyTo = (body: HTMLElement): number | undefined =>
    Option.fromNullishOr(body.querySelector('.reply_to a')?.getAttribute('onclick')).pipe(
        Option.flatMap(onclick => Option.fromNullishOr(/GoToMessage\((\d+)\)/u.exec(onclick))),
        Option.map(match => Number(match[1])),
        Option.getOrUndefined
    );

const parseUserMessage = (id: number, body: HTMLElement, author: string | undefined, timeZone: string): TelegramMessage => ({
    id,
    kind: 'message',
    sentAt: parseDateTitle(body.querySelector('.date')?.getAttribute('title'), timeZone),
    author,
    replyTo: parseReplyTo(body),
    forwardedFrom: textOf(body.querySelector('.forwarded_from'))?.replace(/^Forwarded from\s*/u, ''),
    text: textOf(body.querySelector(':scope > .text')),
    poll: parsePoll(body),
    location: parseLocation(body),
    media: mediaSelectors.filter(([, selector]) => isDefined(body.querySelector(selector))).map(([kind]) => kind)
});

export const parseHtmlPage = (
    html: string,
    previousAuthor: string | undefined,
    timeZone: string
): { messages: TelegramMessage[]; lastAuthor: string | undefined } => {
    const messages: TelegramMessage[] = [];
    let author = previousAuthor;

    for (const element of parse(html).querySelectorAll('div.message')) {
        const idMatch = /^message(-?\d+)$/u.exec(element.id);
        const body = element.querySelector('.body');

        if (!isDefined(idMatch)) {
            continue;
        }

        const id = Number(idMatch[1]);

        if (element.classList.contains('service')) {
            messages.push({ id, kind: 'service', text: textOf(body), media: [] });
            continue;
        }

        if (!isDefined(body)) {
            continue;
        }

        author = textOf(body.querySelector(':scope > .from_name')) ?? author;
        messages.push(parseUserMessage(id, body, author, timeZone));
    }

    return { messages, lastAuthor: author };
};
