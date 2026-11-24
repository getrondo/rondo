import * as Option from 'effect/Option';

import { findLocalTime, resolveGameDate } from './game-date';
import { compile, matchesAny } from './normalize';
import { instantToLocalDate } from './zoned-time';

import type { CommunityConfig } from '../config/community-config';
import type { TelegramMessage } from '../model/telegram-message.model';
import type { PollFact, Sport } from './fact.model';

const sportPatterns: readonly (readonly [Sport, RegExp])[] = [
    ['basketball', /баскет/iu],
    ['beach_volleyball', /пляж|beach/iu],
    ['volleyball', /волейб/iu],
    ['table_tennis', /теннис|теніс|пинг/iu],
    ['boxing', /бокс/iu],
    ['futsal', /футзал|школ|зал(?!ь)/iu]
];

const gameSignal = /[+✔✅➕]|буду|игр|гра[єюи]|поле|матч|футбол|чел|мест/iu;

const detectSport = (text: string): Sport => sportPatterns.find(([, regex]) => regex.test(text))?.[0] ?? 'football';

export const makeVenueMatcher = (config: CommunityConfig) => {
    const compiled = config.venues.map(venue => ({ key: venue.key, regexes: compile(venue.patterns) }));

    return (text: string): string | undefined => compiled.find(candidate => matchesAny(text, candidate.regexes))?.key;
};

const capacityOf = (text: string): number | undefined => {
    const match = /(\d{2})\s*(?:чел|мест|осіб|людей)/iu.exec(text) ?? /максимум\s*(\d{2})|(\d{2})\s*максимум/iu.exec(text);

    return Option.fromNullishOr(match?.[1] ?? match?.[2]).pipe(
        Option.map(Number),
        Option.filter(value => Number.isFinite(value) && value >= 6 && value <= 60),
        Option.getOrUndefined
    );
};

const fieldsOf = (text: string): number | undefined =>
    Option.fromNullishOr(/(\d)\s*пол[еяю]/iu.exec(text)).pipe(
        Option.map(match => Number(match[1])),
        Option.getOrUndefined
    );

const formatOf = (text: string): string | undefined => /\b(\d{1,2})\s?[xхX×]\s?(\d{1,2})\b/u.exec(text)?.slice(1, 3).join('x');

const buildPollFact = (
    message: TelegramMessage,
    { poll, sentAt }: { poll: NonNullable<TelegramMessage['poll']>; sentAt: Date },
    config: CommunityConfig,
    venueOf: (text: string) => string | undefined
): PollFact => {
    const title = poll.question;
    const { date, confidence } = resolveGameDate(title, instantToLocalDate(sentAt, config.timeZone));

    return {
        messageId: message.id,
        postedAt: sentAt,
        localDate: date,
        localTime: findLocalTime(title),
        venueKey: venueOf(title),
        sport: detectSport(title),
        capacityMax: capacityOf(title),
        fieldsPlanned: fieldsOf(title),
        format: formatOf(title),
        isReserve: /резерв/iu.test(title) || /кто там/iu.test(poll.answers.join(' ')),
        isChoice: poll.answers.length > 2,
        title,
        confidence
    };
};

export const extractPoll = (
    message: TelegramMessage,
    config: CommunityConfig,
    venueOf: (text: string) => string | undefined
): PollFact | undefined =>
    Option.all({ poll: Option.fromNullishOr(message.poll), sentAt: Option.fromNullishOr(message.sentAt) }).pipe(
        Option.filter(({ poll }) => gameSignal.test(`${poll.question} ${poll.answers.join(' ')}`)),
        Option.map(input => buildPollFact(message, input, config, venueOf)),
        Option.getOrUndefined
    );
