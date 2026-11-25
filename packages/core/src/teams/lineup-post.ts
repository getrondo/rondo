import { isDefined, isNotEmptyString } from '@rnw-community/shared';
import { escapeHtml, mentionHtml } from '@rondo/telegram/format/html';

import { badgeOfEmoji } from './badges';

import type { Locale } from '../i18n/locale';
import type { BadgeColour } from './interface/badge.interface';
import type { LineupPost, PostMember, PostTeam } from './interface/lineup-post.interface';

const telegramLimit = 4096;
const shortName = 24;

const words: Readonly<
    Record<
        Locale,
        {
            readonly title: string;
            readonly updated: string;
            readonly fromLosers: string;
            readonly friend: string;
            readonly guest: string;
            readonly team: string;
        }
    >
> = {
    uk: {
        title: 'Склади',
        updated: 'Оновлені склади',
        fromLosers: 'з команди, що програла',
        friend: 'друг',
        guest: 'гість',
        team: 'Команда'
    },
    ru: { title: 'Составы', updated: 'Обновлённые составы', fromLosers: 'от проигравших', friend: 'друг', guest: 'гость', team: 'Команда' }
};

const teamNames: Readonly<Record<Locale, Readonly<Record<BadgeColour, string>>>> = {
    uk: { red: 'Червоні', blue: 'Сині', green: 'Зелені', yellow: 'Жовті', white: 'Білі', orange: 'Помаранчеві' },
    ru: { red: 'Красные', blue: 'Синие', green: 'Зелёные', yellow: 'Жёлтые', white: 'Белые', orange: 'Оранжевые' }
};

export const teamName = (locale: Locale, badge: string, index: number): string => {
    const colour = badgeOfEmoji(badge)?.colour;

    return isDefined(colour) ? teamNames[locale][colour] : `${words[locale].team} ${index + 1}`;
};

const autoGuest = /\+\d+$/u;

const nameHtml = (member: PostMember, post: LineupPost, limit: number): string => {
    const name = member.name.length > limit ? `${member.name.slice(0, limit - 1)}…` : member.name;

    if (member.isGuest || !isDefined(member.tgUserId)) {
        return escapeHtml(name);
    }

    return post.showHandles && isNotEmptyString(member.username) ? `@${escapeHtml(member.username)}` : mentionHtml(member.tgUserId, name);
};

const memberHtml = (member: PostMember, team: PostTeam, post: LineupPost, limit: number): string | null => {
    const host = team.members.find(entry => entry.personId === member.hostId);
    const gk = member.isGk ? ' 🧤' : '';

    if (member.isGuest && autoGuest.test(member.name)) {
        if (isDefined(host)) {
            return null;
        }

        const elsewhere = post.teams.flatMap(entry => entry.members).find(entry => entry.personId === member.hostId);

        return isDefined(elsewhere)
            ? `${words[post.locale].friend} ${escapeHtml(elsewhere.name)}${gk}`
            : `${words[post.locale].guest}${gk}`;
    }

    const guests = team.members.filter(entry => entry.isGuest && entry.hostId === member.personId && autoGuest.test(entry.name)).length;

    return `${nameHtml(member, post, limit)}${guests > 0 ? ` +${guests}` : ''}${gk}`;
};

const teamHtml = (team: PostTeam, index: number, post: LineupPost, limit: number): string => {
    const largest = Math.max(...post.teams.map(entry => entry.members.length));
    const missing = largest - team.members.length;
    const note = missing > 0 ? ` (+${missing} ${words[post.locale].fromLosers})` : '';
    const names = team.members.flatMap(member => memberHtml(member, team, post, limit) ?? []);

    return [`${team.badge} <b>${teamName(post.locale, team.badge, index)} · ${team.members.length}</b>${note}`, ...names].join('\n');
};

const visibleLength = (html: string): number => html.replaceAll(/<[^<>]*>/gu, '').replaceAll(/&(?:amp|lt|gt|quot);/gu, '-').length;

export const lineupPostHtml = (post: LineupPost): string => {
    const render = (limit: number) =>
        [
            ...(post.isUpdate ? [words[post.locale].updated] : []),
            `<b>${words[post.locale].title}: ${escapeHtml(post.title)}</b>`,
            '',
            post.teams.map((team, index) => teamHtml(team, index, post, limit)).join('\n\n')
        ].join('\n');
    const full = render(Infinity);

    return visibleLength(full) <= telegramLimit ? full : render(shortName);
};

export interface TeamPlacement {
    readonly personId: string;
    readonly name: string;
    readonly badge: string;
    readonly team: number;
}

export const lineupDiff = (before: readonly TeamPlacement[], after: readonly TeamPlacement[]): string[] => {
    const placed = new Map(before.map(entry => [entry.personId, entry]));
    const kept = new Set(after.map(entry => entry.personId));
    const moved = after.flatMap(entry => {
        const previous = placed.get(entry.personId);

        if (!isDefined(previous)) {
            return [`+ ${entry.name} ${entry.badge}`];
        }

        return previous.badge === entry.badge ? [] : [`${entry.name}: ${previous.badge} → ${entry.badge}`];
    });

    return [...moved, ...before.filter(entry => !kept.has(entry.personId)).map(entry => `− ${entry.name}`)];
};
