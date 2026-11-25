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

const towards: Readonly<Record<Locale, Readonly<Record<string, string>>>> = {
    uk: { '🔴': 'до Червоних', '🔵': 'до Синіх', '🟢': 'до Зелених', '🟡': 'до Жовтих', '⚪': 'до Білих', '🟠': 'до Помаранчевих' },
    ru: { '🔴': 'к Красным', '🔵': 'к Синим', '🟢': 'к Зелёным', '🟡': 'к Жёлтым', '⚪': 'к Белым', '🟠': 'к Оранжевым' }
};

export const towardsTeam = (locale: Locale, badge: string): string => `➡️ ${towards[locale][badge] ?? badge}`;
