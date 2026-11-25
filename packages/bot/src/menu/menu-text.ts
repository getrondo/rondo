import { menuTextRu } from './menu-text-ru';
import { menuTextUk } from './menu-text-uk';

import type { Locale } from '@rondo/core/i18n/locale';

const catalogue = { uk: menuTextUk, ru: menuTextRu } as const satisfies Record<Locale, Record<string, string>>;

export type MenuKey = keyof (typeof catalogue)['uk'];

export const isMenuKey = (value: string): value is MenuKey => Object.hasOwn(catalogue.uk, value);

export const menuText = (locale: Locale, key: MenuKey, values: Readonly<Record<string, string | number>> = {}): string =>
    catalogue[locale][key].replaceAll(/\{(\w+)\}/gu, (placeholder, name: string) => String(values[name] ?? placeholder));
