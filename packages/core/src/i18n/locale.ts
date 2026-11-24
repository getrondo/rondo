export type Locale = 'uk' | 'ru';

export const resolveLocale = (languageCode: string | null | undefined): Locale =>
    languageCode?.toLowerCase().startsWith('ru') === true ? 'ru' : 'uk';
