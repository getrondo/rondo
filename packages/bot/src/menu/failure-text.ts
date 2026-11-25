import { menuText } from './menu-text';

import type { Locale } from '@rondo/core/i18n/locale';

const refused = /^Telegram refused: (.+)$/u;

export const failureText = (locale: Locale, reason: string, slug: string): string => {
    const known: [RegExp, () => string][] = [
        [/no group is linked/u, () => menuText(locale, 'reasonNoGroup', { slug })],
        [/already has an open poll/u, () => menuText(locale, 'reasonOpenPoll')],
        [refused, () => menuText(locale, 'reasonRefused', { detail: refused.exec(reason)?.[1] ?? reason })],
        [/uncertain/u, () => menuText(locale, 'reasonUncertain')],
        [/changed after the preview/u, () => menuText(locale, 'reasonChanged')],
        [/already over or cancelled/u, () => menuText(locale, 'reasonOver')]
    ];
    const match = known.find(([pattern]) => pattern.test(reason));

    return menuText(locale, 'failed', { reason: match?.[1]() ?? reason });
};
