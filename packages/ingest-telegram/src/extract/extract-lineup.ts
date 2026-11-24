import { isDefined, isNotEmptyArray, isNotEmptyString } from '@rnw-community/shared';
import * as Option from 'effect/Option';

import { pricePattern } from './extract-signals';
import { findLocalTime, resolveGameDate } from './game-date';
import { normalizeAlias } from './normalize';
import { instantToLocalDate } from './zoned-time';

import type { CommunityConfig } from '../config/community-config';
import type { TelegramMessage } from '../model/telegram-message.model';
import type { LineupFact, LineupMember, LineupTeam } from './fact.model';

interface RosterContext {
    readonly selfAliases: ReadonlySet<string>;
    readonly mentions: NonNullable<TelegramMessage['mentions']>;
}

const gkPattern = 'вратарь|воротар|на воротах';
const newcomerPattern = 'новый|новенький|новий|новичок';
const gkMarker = new RegExp(gkPattern, 'giu');
const newcomerMarker = new RegExp(newcomerPattern, 'giu');
const isGkText = new RegExp(gkPattern, 'iu');
const isNewcomerText = new RegExp(newcomerPattern, 'iu');
const statedDateConfidence = 0.8;
const noise = /^(?:может|возможно|опозда|придет|приедет|резерв|в резерве|мяч|манишк|оплата|по \d)/iu;

const removeMarker = (text: string, marker: RegExp): string => {
    const pieces = text.split(marker);

    return pieces.map((piece, index) => (index < pieces.length - 1 ? piece.trimEnd() : piece)).join('');
};

const stripParentheses = (text: string): string => {
    const open = text.indexOf('(');
    const close = open === -1 ? -1 : text.indexOf(')', open);

    return close === -1 ? text : `${text.slice(0, open)}${stripParentheses(text.slice(close + 1))}`;
};

const stripTrailingPunctuation = (text: string): string => (/[.!:]$/u.test(text) ? stripTrailingPunctuation(text.slice(0, -1)) : text);

const splitMembers = (segment: string): string[] =>
    segment
        .split(/[,\n/;]|\.\s|\sи\s|\sі\s/u)
        .map(part => stripParentheses(part).trim())
        .filter(part => isNotEmptyString(part) && part.length <= 32 && !noise.test(part) && !/^\d+$/u.test(part));

const guestSuffix = /\+ ?(\d{1,2})$/u;

const guestsIn = (text: string): number => Number(guestSuffix.exec(text)?.[1] ?? 0);

const playerName = (text: string): string => {
    const words = text.split(/\s/u).filter(word => isNotEmptyString(word));
    const absent = words.findIndex((word, index) => index > 0 && word.toLowerCase() === 'без');
    const present = absent === -1 ? words : words.slice(0, absent);

    return present.join(' ').replace(guestSuffix, '').trim();
};

const attachLooseGuests = (segments: readonly string[]): string[] => {
    const attached: string[] = [];

    for (const segment of segments) {
        const previous = attached.at(-1);

        if (!/^\+ ?\d{1,2}$/u.test(segment)) {
            attached.push(segment);
        } else if (isDefined(previous) && guestsIn(previous) === 0) {
            attached.splice(-1, 1, `${previous} ${segment}`);
        }
    }

    return attached;
};

const mentionMarker = /\p{Co}/u;
const firstMentionMarker = 0xe0_00;

const markMentions = (text: string, mentions: NonNullable<TelegramMessage['mentions']>): string =>
    mentions.reduceRight(
        (marked, mention, index) =>
            isDefined(mention.userId)
                ? `${marked.slice(0, mention.offset + mention.text.length)}${String.fromCodePoint(firstMentionMarker + index)}${marked.slice(mention.offset + mention.text.length)}`
                : marked,
        text
    );

const mentionedUserId = (token: string, mentions: NonNullable<TelegramMessage['mentions']>): number | undefined =>
    Option.fromNullishOr(mentionMarker.exec(token)?.[0].codePointAt(0)).pipe(
        Option.flatMapNullishOr(code => mentions[code - firstMentionMarker]?.userId),
        Option.getOrUndefined
    );

const toMember = (token: string, { selfAliases, mentions }: RosterContext): LineupMember | undefined => {
    const raw = token.replace(mentionMarker, '');
    const named = stripTrailingPunctuation(removeMarker(removeMarker(raw, gkMarker), newcomerMarker).trim());
    const alias = playerName(named);
    const aliasNorm = normalizeAlias(alias);

    return Option.some({
        raw,
        userId: mentionedUserId(token, mentions),
        handle: /^@(\w+)$/u.exec(alias)?.[1],
        alias,
        aliasNorm,
        isGk: isGkText.test(raw),
        isNewcomer: isNewcomerText.test(raw),
        isSelf: selfAliases.has(aliasNorm),
        guests: guestsIn(named)
    }).pipe(
        Option.filter(member => member.aliasNorm.length >= 2 || member.isSelf),
        Option.getOrUndefined
    );
};

const escapeEmoji = (emoji: string): string => emoji.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');

const parseTeam = (rawSegment: string, context: RosterContext): LineupMember[] => {
    const segment = rawSegment.split(/\n\s*\n/u)[0] ?? '';
    const firstLine = segment.replace(/^[^:\n]*?(?:ые|ие|і|i)\s*:/iu, '').split('\n')[0] ?? '';

    return attachLooseGuests(splitMembers(firstLine))
        .map(token => toMember(token, context))
        .filter(member => isDefined(member));
};

const buildTeams = (
    text: string,
    config: CommunityConfig,
    mentions: RosterContext['mentions']
): { header: string; teams: LineupTeam[] } => {
    const splitter = new RegExp(`(${config.teamColors.map(color => escapeEmoji(color.emoji)).join('|')})`, 'u');
    const parts = markMentions(text, mentions).split(splitter);
    const context = { selfAliases: new Set(config.selfAliases.map(normalizeAlias)), mentions };
    const teams: LineupTeam[] = [];

    for (let index = 1; index < parts.length; index += 2) {
        const members = parseTeam(parts[index + 1] ?? '', context);

        if (isNotEmptyArray(members)) {
            teams.push({ ordinal: teams.length + 1, emoji: parts[index] ?? '', members });
        }
    }

    return { header: parts[0] ?? '', teams };
};

export const extractLineup = (
    message: TelegramMessage,
    config: CommunityConfig,
    venueOf: (text: string) => string | undefined
): LineupFact | undefined =>
    Option.all({ text: Option.fromNullishOr(message.text), sentAt: Option.fromNullishOr(message.sentAt) }).pipe(
        Option.filter(({ text }) => /состав|склад/iu.test(text)),
        Option.flatMap(({ text, sentAt }) => {
            const { header, teams } = buildTeams(text, config, message.mentions ?? []);
            const postedDate = instantToLocalDate(sentAt, config.timeZone);
            const headerDate = resolveGameDate(header, postedDate);

            return teams.length < 2
                ? Option.none()
                : Option.some({
                      messageId: message.id,
                      ...(isDefined(message.forwardedFrom) ? {} : { authorId: message.authorId }),
                      postedAt: sentAt,
                      localDate: headerDate.confidence >= statedDateConfidence ? headerDate.date : postedDate,
                      localTime: findLocalTime(header),
                      venueKey: venueOf(header),
                      teams,
                      priceCents: Option.fromNullishOr(pricePattern.exec(text)).pipe(
                          Option.map(price => Number(price[1]) * 100),
                          Option.getOrUndefined
                      )
                  });
        }),
        Option.getOrUndefined
    );
