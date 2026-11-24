import { isDefined, isNotEmptyString } from '@rnw-community/shared';
import * as Option from 'effect/Option';

import { resolveGameDate } from './game-date';
import { compile, matchesAny, normalizeAlias } from './normalize';
import { addDays, instantToLocalDate, isCalendarDate } from './zoned-time';

import type { CommunityConfig } from '../config/community-config';
import type { TelegramMessage } from '../model/telegram-message.model';
import type { CancellationFact, FixtureFact, PriceFact } from './fact.model';

interface OrganizerPost {
    readonly text: string;
    readonly sentAt: Date;
}

interface FixtureContext {
    readonly message: TelegramMessage;
    readonly text: string;
    readonly localDate: string;
    readonly squads: readonly { name: string; regexes: RegExp[]; context: RegExp[] }[];
}

const cancelSignal = /отмен|отбой|не играем|не будет футбол|футбола не будет|играть .*не будем|переносим|перенос на/iu;
const reasons: readonly (readonly [CancellationFact['reason'], RegExp])[] = [
    ['weather', /дожд|снег|погод|гроз|ливень|мороз|жара|холод/iu],
    ['low_turnout', /мало люд|не набрал|недобор|мало плюс|мало народ/iu],
    ['venue', /поле занято|закрыт|ремонт|занят|ключ/iu],
    ['holiday', /праздник|выходной|пасх|рождеств|канікул|каникул/iu]
];

export const pricePattern = /по\s*(\d{1,2})\s*(?:евро|€|eur|на поле)/iu;
const scorePattern = /(?<![\d.])(\d{1,2})\s*[:–-]\s*(\d{1,2})(?![\d.:])/u;
const pairingPattern = /^(.{2,40}?)[-–—](.{2,40}?)(?:[:.]?\s*(\d{1,2})\s*[:–-]\s*(\d{1,2}))?\s*\.?$/u;
const numericDate = /(\d{2})\.(\d{2})\.(\d{4})/u;
const maxMessageLength = 600;

const organizerPost = (message: TelegramMessage, organizers: ReadonlySet<string>): Option.Option<OrganizerPost> =>
    Option.all({
        text: Option.fromNullishOr(message.text),
        sentAt: Option.fromNullishOr(message.sentAt),
        author: Option.fromNullishOr(message.author)
    }).pipe(
        Option.filter(({ author }) => organizers.has(author)),
        Option.map(({ text, sentAt }) => ({ text, sentAt }))
    );

export const extractCancellation = (
    message: TelegramMessage,
    config: CommunityConfig,
    organizers: ReadonlySet<string>
): CancellationFact | undefined =>
    organizerPost(message, organizers).pipe(
        Option.filter(({ text }) => cancelSignal.test(text) && !/\?\s*$/u.test(text) && text.length <= maxMessageLength),
        Option.map(({ text, sentAt }) => ({
            messageId: message.id,
            postedAt: sentAt,
            localDate: resolveGameDate(text, instantToLocalDate(sentAt, config.timeZone)).date,
            reason: reasons.find(([, regex]) => regex.test(text))?.[0] ?? 'organizer'
        })),
        Option.getOrUndefined
    );

const lineAt = (text: string, index: number): string =>
    text.slice(text.lastIndexOf('\n', index) + 1, text.includes('\n', index) ? text.indexOf('\n', index) : text.length);

export const extractPrice = (
    message: TelegramMessage,
    config: CommunityConfig,
    organizers: ReadonlySet<string>,
    venueOf: (text: string) => string | undefined
): PriceFact | undefined =>
    organizerPost(message, organizers).pipe(
        Option.flatMap(({ text, sentAt }) =>
            Option.fromNullishOr(pricePattern.exec(text)).pipe(
                Option.map(match => {
                    const line = lineAt(text, match.index);

                    return {
                        messageId: message.id,
                        localDate: instantToLocalDate(sentAt, config.timeZone),
                        amountCents: Number(match[1]) * 100,
                        venueKey: venueOf(text),
                        appliesTo: /вратар|воротар/iu.test(line) && !/[💷💵💶💴🟠🟢🔵]/u.test(line) ? ('gk' as const) : ('field' as const)
                    };
                })
            )
        ),
        Option.getOrUndefined
    );

const seasonOf = (isoDate: string): string => {
    const year = Number(isoDate.slice(0, 4));
    const start = Number(isoDate.slice(5, 7)) >= 7 ? year : year - 1;

    return `${start}/${String((start + 1) % 100).padStart(2, '0')}`;
};

const competitionOf = (text: string): string | undefined => {
    if (/35\s*\+|мастер/iu.test(text)) {
        return 'Masters 35+';
    }

    return Option.fromNullishOr(/(\d)[\s-]*(?:а?я\s*)?(?:лиг|liga)/iu.exec(text)).pipe(
        Option.map(level => `${level[1]}. Liga`),
        Option.getOrUndefined
    );
};

const isEdgeCharacter = (character: string): boolean => /[\s.\-–:/]/u.test(character);

const cleanTeam = (value: string): string => {
    const characters = value.match(/./gsu) ?? [];
    const first = characters.findIndex(character => !isEdgeCharacter(character));
    const last = characters.findLastIndex(character => !isEdgeCharacter(character));

    return first === -1
        ? ''
        : characters
              .slice(first, last + 1)
              .join('')
              .replaceAll(/\s+/gu, ' ');
};

const resolveLocalDate = (text: string, postedDate: string): string => {
    const numeric = numericDate.exec(text);
    const isNumericValid = isDefined(numeric) && isCalendarDate(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]));
    const playedOn = isNumericValid ? `${numeric[3]}-${numeric[2]}-${numeric[1]}` : resolveGameDate(text, postedDate).date;
    const yearTypo = playedOn < addDays(postedDate, -60) ? `${postedDate.slice(0, 4)}${playedOn.slice(4)}` : playedOn;

    return yearTypo > postedDate ? postedDate : yearTypo;
};

const scoreOf = (pairing: RegExpExecArray, following: readonly string[]): Option.Option<{ goalsLeft: number; goalsRight: number }> =>
    isDefined(pairing[3])
        ? Option.some({ goalsLeft: Number(pairing[3]), goalsRight: Number(pairing[4]) })
        : Option.fromNullishOr(following.map(candidate => scorePattern.exec(candidate)).find(match => isDefined(match))).pipe(
              Option.map(match => ({ goalsLeft: Number(match[1]), goalsRight: Number(match[2]) }))
          );

interface Pairing {
    readonly match: RegExpExecArray;
    readonly left: string;
    readonly right: string;
    readonly home: boolean;
}

const pairingOf = (line: string, isOurs: (side: string) => boolean): Option.Option<Pairing> =>
    Option.fromNullishOr(pairingPattern.exec(line)).pipe(
        Option.flatMap(match => {
            const left = cleanTeam((match[1] ?? '').split(':').at(-1) ?? '');
            const right = cleanTeam(match[2] ?? '');
            const home = isOurs(left);

            return home === isOurs(right) ? Option.none() : Option.some({ match, left, right, home });
        })
    );

const untilNextPairing = (following: readonly string[], isOurs: (side: string) => boolean): readonly string[] => {
    const next = following.findIndex(line => Option.isSome(pairingOf(line, isOurs)));

    return next === -1 ? following : following.slice(0, next);
};

const fixtureFromLine = (
    context: FixtureContext,
    isOurs: (side: string) => boolean,
    lines: readonly string[],
    index: number
): Option.Option<FixtureFact> =>
    pairingOf(lines[index] ?? '', isOurs).pipe(
        Option.flatMap(({ match, left, right, home }) =>
            scoreOf(match, untilNextPairing(lines.slice(index + 1, index + 4), isOurs)).pipe(
                Option.map(({ goalsLeft, goalsRight }) => {
                    const ours = normalizeAlias(home ? left : right);
                    const squad =
                        context.squads.find(
                            candidate => matchesAny(context.text, candidate.context) || matchesAny(ours, candidate.regexes)
                        ) ?? context.squads.at(-1);

                    return {
                        messageId: context.message.id,
                        localDate: context.localDate,
                        squadName: squad?.name ?? 'Team',
                        competition: competitionOf(context.text),
                        season: seasonOf(context.localDate),
                        opponent: home ? right : left,
                        goalsFor: home ? goalsLeft : goalsRight,
                        goalsAgainst: home ? goalsRight : goalsLeft,
                        home
                    };
                })
            )
        )
    );

export const makeFixtureExtractor = (config: CommunityConfig, organizers: ReadonlySet<string>) => {
    const squads = config.squads.map(squad => ({
        name: squad.name,
        regexes: compile(squad.patterns),
        context: compile(squad.contextPatterns)
    }));
    const isOurs = (side: string): boolean => squads.some(squad => matchesAny(normalizeAlias(side), squad.regexes));

    return (message: TelegramMessage): FixtureFact[] =>
        organizerPost(message, organizers).pipe(
            Option.filter(({ text }) => text.length <= maxMessageLength),
            Option.map(({ text, sentAt }) => {
                const context = {
                    message,
                    text,
                    localDate: resolveLocalDate(text, instantToLocalDate(sentAt, config.timeZone)),
                    squads
                };
                const lines = text
                    .split(/\n|\s\/\s|\.\s+/u)
                    .map(line => line.trim())
                    .filter(line => isNotEmptyString(line));

                return lines.flatMap((_line, index) => fixtureFromLine(context, isOurs, lines, index).pipe(Option.toArray));
            }),
            Option.getOrElse((): FixtureFact[] => [])
        );
};
