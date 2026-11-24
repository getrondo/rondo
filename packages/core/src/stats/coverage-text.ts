import { countLabel } from '../i18n/count-label';

import type { Locale } from '../i18n/locale';

interface Coverage {
    readonly playedGames: number;
    readonly gamesWithSquad: number;
    readonly gamesWithPoll: number;
}

export const coverageText = (locale: Locale, { playedGames, gamesWithSquad, gamesWithPoll }: Coverage): string => {
    const label = (count: number): string => countLabel(locale, 'games', count);

    return locale === 'uk'
        ? `Усього ${label(playedGames)}: з опитуванням — ${gamesWithPoll}, з опублікованим складом — ${gamesWithSquad}.`
        : `Всего ${label(playedGames)}: с опросом — ${gamesWithPoll}, с опубликованным составом — ${gamesWithSquad}.`;
};
