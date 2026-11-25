import { isDefined } from '@rnw-community/shared';

import { teamBadges } from '../config/team-badges';

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

export const paddedColours = (colours: readonly string[], count: number): string[] => {
    const valid = colours.slice(0, count).map(colour => (isDefined(badgeOfColour(colour)) ? colour : null));
    const spare = badges.map(entry => entry.colour).filter(colour => !valid.includes(colour));

    return Array.from({ length: count }, (_team, index) => {
        const kept = valid[index];

        if (isDefined(kept) && valid.indexOf(kept) === index) {
            return kept;
        }

        return spare.shift() ?? '';
    });
};
