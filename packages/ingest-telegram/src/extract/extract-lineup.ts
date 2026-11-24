import { isDefined, isNotEmptyArray, isNotEmptyString } from '@rnw-community/shared';
import * as Option from 'effect/Option';

import { pricePattern } from './extract-signals';
import { findLocalTime, resolveGameDate } from './game-date';
import { normalizeAlias } from './normalize';
import { instantToLocalDate } from './zoned-time';

import type { CommunityConfig } from '../config/community-config';
import type { TelegramMessage } from '../model/telegram-message.model';
import type { LineupFact, LineupMember, LineupTeam } from './fact.model';

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
        .filter(part => isNotEmptyString(part) && part.length <= 32 && !noise.test(part) && !/^\+?\d+$/u.test(part));

const playerName = (text: string): string => {
    const words = text.split(/\s/u).filter(word => isNotEmptyString(word));
    const absent = words.findIndex((word, index) => index > 0 && word.toLowerCase() === 'без');
    const present = absent === -1 ? words : words.slice(0, absent);

    return present
        .join(' ')
        .replace(/\+ ?\d+$/u, '')
        .trim();
};

const toMember = (raw: string, selfAliases: ReadonlySet<string>): LineupMember | undefined => {
    const alias = playerName(stripTrailingPunctuation(removeMarker(removeMarker(raw, gkMarker), newcomerMarker)).trim());
    const aliasNorm = normalizeAlias(alias);

    return Option.some({
        alias,
        aliasNorm,
        isGk: isGkText.test(raw),
        isNewcomer: isNewcomerText.test(raw),
        isSelf: selfAliases.has(aliasNorm)
    }).pipe(
        Option.filter(member => member.aliasNorm.length >= 2 || member.isSelf),
        Option.getOrUndefined
    );
};

const escapeEmoji = (emoji: string): string => emoji.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');

const parseTeam = (rawSegment: string, selfAliases: ReadonlySet<string>): LineupMember[] => {
    const segment = rawSegment.split(/\n\s*\n/u)[0] ?? '';
    const firstLine = segment.replace(/^[^:\n]*?(?:ые|ие|і|i)\s*:/iu, '').split('\n')[0] ?? '';

    return splitMembers(firstLine)
        .map(raw => toMember(raw, selfAliases))
        .filter(member => isDefined(member));
};

const buildTeams = (text: string, config: CommunityConfig): { header: string; teams: LineupTeam[] } => {
    const splitter = new RegExp(`(${config.teamColors.map(color => escapeEmoji(color.emoji)).join('|')})`, 'u');
    const parts = text.split(splitter);
    const selfAliases = new Set(config.selfAliases.map(normalizeAlias));
    const teams: LineupTeam[] = [];

    for (let index = 1; index < parts.length; index += 2) {
        const members = parseTeam(parts[index + 1] ?? '', selfAliases);

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
            const { header, teams } = buildTeams(text, config);
            const postedDate = instantToLocalDate(sentAt, config.timeZone);
            const headerDate = resolveGameDate(header, postedDate);

            return teams.length < 2
                ? Option.none()
                : Option.some({
                      messageId: message.id,
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
