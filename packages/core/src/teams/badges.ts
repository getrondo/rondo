import { teamBadges } from '@rondo/ingest-telegram/config/team-badges';

import type { Badge, BadgeColour } from './interface/badge.interface';

export const badges: readonly Badge[] = teamBadges;

export const badgeOfEmoji = (emoji: string): Badge | undefined =>
    badges.find(entry => entry.badge === emoji || entry.aliases.includes(emoji) || `${entry.badge}️` === emoji);

export const badgeOfColour = (colour: string | null | undefined): Badge | undefined => badges.find(entry => entry.colour === colour);

export const badgeOfRow = (row: { readonly emoji: string | null; readonly name: string }): Badge | undefined =>
    badgeOfEmoji(row.emoji ?? '') ?? badges.find(entry => row.name.toLowerCase().includes(entry.colour));

export const defaultColours = (count: number, preferred: readonly BadgeColour[]): BadgeColour[] => {
    const order = [...new Set([...preferred, ...badges.map(entry => entry.colour)])];

    return order.slice(0, count);
};
