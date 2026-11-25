import { isDefined, isNotEmptyArray, isNotEmptyString } from '@rnw-community/shared';
import * as Option from 'effect/Option';

import { defaultGuestPatterns, type CommunityConfig } from '../config/community-config';

import { pricePattern } from './extract-signals';
import { findLocalTime, resolveGameDate, statedDateConfidence } from './game-date';
import { compile, normalizeAlias } from './normalize';
import { instantToLocalDate } from './zoned-time';

import type { TelegramMessage } from '../model/telegram-message.model';
import type { LineupFact, LineupMember, LineupTeam } from './fact.model';

interface RosterContext {
    readonly selfAliases: ReadonlySet<string>;
    readonly guestPatterns: readonly RegExp[];
    readonly mentions: NonNullable<TelegramMessage['mentions']>;
}

const gkPattern = 'вратарь|воротар|на воротах';
const newcomerPattern = 'новый|новенький|новий|новичок';
const gkMarker = new RegExp(gkPattern, 'giu');
const newcomerMarker = new RegExp(newcomerPattern, 'giu');
const isGkText = new RegExp(gkPattern, 'iu');
const isNewcomerText = new RegExp(newcomerPattern, 'iu');
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

const maxNameLength = 32;

const splitMembers = (segment: string): string[] =>
    segment
        .split(/[,\n/;]|\.\s|\sи\s|\sі\s/u)
        .map(part => stripParentheses(part).trim())
        .filter(part => isNotEmptyString(part) && part.length <= maxNameLength && !noise.test(part) && !/^\d+$/u.test(part));

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

const describedGuest = (raw: string, guestPatterns: readonly RegExp[]): LineupMember['guest'] =>
    Option.fromNullishOr(guestPatterns.map(pattern => pattern.exec(raw)).find(match => isDefined(match))).pipe(
        Option.map(({ groups }) => ({ host: groups?.host, count: Number(groups?.count ?? 1) })),
        Option.getOrUndefined
    );

const toMember = (token: string, { selfAliases, mentions, guestPatterns }: RosterContext): LineupMember | undefined => {
    const raw = token.replace(mentionMarker, '').trim();
    const guest = describedGuest(raw, guestPatterns);

    if (isDefined(guest)) {
        return {
            raw,
            alias: raw,
            aliasNorm: normalizeAlias(raw),
            isGk: isGkText.test(raw),
            isNewcomer: isNewcomerText.test(raw),
            isSelf: false,
            guests: 0,
            guest
        };
    }

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

export const nicknameOf = (raw: string, config: CommunityConfig): { readonly nickname: string; readonly aliasNorm: string } => {
    const member = toMember(raw, {
        selfAliases: new Set(config.selfAliases.map(normalizeAlias)),
        guestPatterns: [],
        mentions: []
    });

    return { nickname: member?.alias ?? raw, aliasNorm: member?.aliasNorm ?? normalizeAlias(raw) };
};

const escapeEmoji = (emoji: string): string => emoji.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');

const colorLabel = /^[^:\n]*?(?:ые|ие|і|i)\s*:/iu;

const parseTeam = (rawSegment: string, context: RosterContext): LineupMember[] => {
    const segment = rawSegment.split(/\n\s*\n/u)[0] ?? '';
    const firstLine = segment.replace(colorLabel, '').split('\n')[0] ?? '';

    return attachLooseGuests(splitMembers(firstLine))
        .map(token => toMember(token, context))
        .filter(member => isDefined(member));
};

const minNamesPerTeam = 4;
const minNamesForUnknownEmoji = 3;
const maxWordsInName = 4;
const teamLine = /^[ \t]*(\p{Extended_Pictographic})(.*)$/u;

const clockTime = /\d{1,2}[.:]\d{2}/u;

interface TeamLine {
    readonly emoji: string;
    readonly names: readonly string[];
}

const isNameList = (names: readonly string[], least: number): boolean =>
    names.length >= least &&
    names.every(
        name =>
            !name.includes(':') &&
            !clockTime.test(name) &&
            name.trim().split(/\s+/u).length <= maxWordsInName &&
            name.trim().length <= maxNameLength
    );

const teamLinesOf = (text: string, config: CommunityConfig): TeamLine[] =>
    text.split('\n').flatMap(line => {
        const [, emoji, rest = ''] = teamLine.exec(line) ?? [];
        const isKnown = config.teamColors.some(color => color.emoji === emoji);
        const names = (isKnown ? rest.replace(colorLabel, '') : rest)
            .split(/[,;]/u)
            .map(part => stripParentheses(part))
            .filter(part => /\p{L}|\+\s?\d/u.test(part));

        return isDefined(emoji) ? [{ emoji, names }] : [];
    });

const teamEmojis = (lines: readonly TeamLine[], config: CommunityConfig): string[] => {
    const known = config.teamColors.map(color => color.emoji);
    const isSquad = lines.some(({ emoji, names }) => known.includes(emoji) && isNameList(names, 1));
    const unknown = lines.filter(({ emoji, names }) => isSquad && !known.includes(emoji) && isNameList(names, minNamesForUnknownEmoji));

    return [...known, ...new Set(unknown.map(({ emoji }) => emoji))];
};

const isSquadByStructure = (lines: readonly TeamLine[], config: CommunityConfig): boolean => {
    const known = new Set(config.teamColors.map(color => color.emoji));
    const squads = lines.filter(({ emoji, names }) => known.has(emoji) && isNameList(names, minNamesPerTeam));

    return new Set(squads.map(({ emoji }) => emoji)).size >= 2;
};

const withoutSecondList = (teams: readonly LineupTeam[]): LineupTeam[] => {
    const repeated = teams.findIndex((team, index) => {
        const before = teams.slice(0, index);
        const listed = new Set(before.flatMap(({ members }) => members.map(({ aliasNorm }) => aliasNorm)));
        const again = team.members.filter(({ aliasNorm }) => listed.has(aliasNorm));

        return before.some(({ emoji }) => emoji === team.emoji) && again.length * 2 > team.members.length;
    });

    return repeated === -1 ? [...teams] : teams.slice(0, repeated);
};

const isCaptainsOnly = (teams: readonly LineupTeam[]): boolean => teams.every(({ members }) => members.length === 1);

const buildTeams = (
    text: string,
    config: CommunityConfig,
    mentions: RosterContext['mentions']
): { header: string; teams: LineupTeam[] } => {
    const emojis = teamEmojis(teamLinesOf(text, config), config).map(emoji => escapeEmoji(emoji));
    const parts = markMentions(text, mentions).split(new RegExp(`(?<!\\d ?)(${emojis.join('|')})`, 'u'));
    const context = {
        selfAliases: new Set(config.selfAliases.map(normalizeAlias)),
        guestPatterns: compile(config.guestPatterns ?? defaultGuestPatterns),
        mentions
    };
    const teams: LineupTeam[] = [];

    for (let index = 1; index < parts.length; index += 2) {
        const members = parseTeam(parts[index + 1] ?? '', context);

        if (isNotEmptyArray(members)) {
            teams.push({ ordinal: teams.length + 1, emoji: parts[index] ?? '', members });
        }
    }

    return { header: parts[0] ?? '', teams: withoutSecondList(teams) };
};

export const extractLineup = (
    message: TelegramMessage,
    config: CommunityConfig,
    venueOf: (text: string) => string | undefined
): LineupFact | undefined =>
    Option.all({ text: Option.fromNullishOr(message.text), sentAt: Option.fromNullishOr(message.sentAt) }).pipe(
        Option.filter(({ text }) => /состав|склад/iu.test(text) || isSquadByStructure(teamLinesOf(text, config), config)),
        Option.flatMap(({ text, sentAt }) => {
            const { header, teams } = buildTeams(text, config, message.mentions ?? []);
            const postedDate = instantToLocalDate(sentAt, config.timeZone);
            const headerDate = resolveGameDate(header, postedDate);

            return teams.length < 2 || isCaptainsOnly(teams)
                ? Option.none()
                : Option.some({
                      messageId: message.id,
                      ...(isDefined(message.forwardedFrom) ? {} : { authorId: message.authorId }),
                      postedAt: sentAt,
                      postedDate,
                      localDate: headerDate.confidence >= statedDateConfidence ? headerDate.date : postedDate,
                      localTime: findLocalTime(header),
                      venueKey: venueOf(header),
                      title: header.trim().split(/\n\s*\n/u)[0] ?? '',
                      teams,
                      priceCents: Option.fromNullishOr(pricePattern.exec(text)).pipe(
                          Option.map(price => Number(price[1]) * 100),
                          Option.getOrUndefined
                      )
                  });
        }),
        Option.getOrUndefined
    );
