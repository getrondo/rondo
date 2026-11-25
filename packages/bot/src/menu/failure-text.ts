import { isDefined } from '@rnw-community/shared';

import { menuText } from './menu-text';

import type { Locale } from '@rondo/core/i18n/locale';

export interface FailureTarget {
    readonly where: string;
    readonly isPrivate: boolean;
}

export interface FailureText {
    readonly text: string;
    readonly uncertain: boolean;
}

const refused = /^Telegram refused: /u;

export const failureText = (locale: Locale, reason: string, target: FailureTarget): FailureText => {
    if (/forward result is uncertain/u.test(reason)) {
        return { text: menuText(locale, 'uncertainForward', { where: target.where }), uncertain: true };
    }

    if (/uncertain/u.test(reason)) {
        const text = target.isPrivate ? menuText(locale, 'uncertainMe') : menuText(locale, 'uncertain', { where: target.where });

        return { text, uncertain: true };
    }

    const known: [RegExp, (found: readonly string[]) => string][] = [
        [
            /the poll question has (\d+) characters, 1 to (\d+)/u,
            ([, count = '', limit = '']) => menuText(locale, 'reasonTooLong', { count, limit })
        ],
        [/a poll answer is longer than (\d+)/u, ([, limit = '']) => menuText(locale, 'reasonAnswerLong', { limit })],
        [/poll template in the community settings is not valid/u, () => menuText(locale, 'reasonTemplate')],
        [/no group is linked/u, () => menuText(locale, 'reasonNoGroup')],
        [/already has an open poll/u, () => menuText(locale, 'reasonOpenPoll')],
        [refused, () => menuText(locale, target.isPrivate ? 'reasonRefusedPrivate' : 'reasonRefused')],
        [/changed after the preview/u, () => menuText(locale, 'reasonChanged')],
        [/already over or cancelled/u, () => menuText(locale, 'reasonOver')],
        [/no longer available/u, () => menuText(locale, 'placeGone')],
        [/could not be closed, so the game is kept/u, () => menuText(locale, 'reasonPollOpen')],
        [/votes the bot has not seen/u, () => menuText(locale, 'reasonUnseenVotes')],
        [/the game time has already passed/u, () => menuText(locale, 'reasonPast')],
        [/does not exist on that day/u, () => menuText(locale, 'reasonNoSuchTime')],
        [/the game already exists/u, () => menuText(locale, 'gameExists')],
        [/only a future game made by the bot/u, () => menuText(locale, 'reasonNotDeletable')]
    ];
    const text = known.map(([pattern, render]) => ({ found: pattern.exec(reason), render })).find(entry => isDefined(entry.found));

    return {
        text: menuText(locale, 'failed', { reason: isDefined(text?.found) ? text.render(text.found) : menuText(locale, 'reasonOther') }),
        uncertain: false
    };
};
