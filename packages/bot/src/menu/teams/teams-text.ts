import { teamsTextRu } from './teams-text-ru';
import { teamsTextUk } from './teams-text-uk';

import type { Locale } from '@rondo/core/i18n/locale';

const catalogue = { uk: teamsTextUk, ru: teamsTextRu } as const satisfies Record<Locale, Record<string, string>>;

export type TeamsKey = keyof (typeof catalogue)['uk'];

export const teamsText = (locale: Locale, key: TeamsKey, values: Readonly<Record<string, string | number>> = {}): string =>
    catalogue[locale][key].replaceAll(/\{(\w+)\}/gu, (placeholder, name: string) => String(values[name] ?? placeholder));

export const teamsCount = (locale: Locale, count: number): string => {
    const few = count >= 2 && count <= 4;

    return locale === 'ru' ? `${count} ${few ? 'команды' : 'команд'}` : `${count} ${few ? 'команди' : 'команд'}`;
};

export const isReasonKey = (value: string): value is 'balanced' | 'usual' | 'fresh' | 'fewest' =>
    value === 'balanced' || value === 'usual' || value === 'fresh' || value === 'fewest';
