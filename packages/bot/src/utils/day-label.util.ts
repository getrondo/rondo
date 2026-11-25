import { formatSessionLabel } from '@rondo/core/i18n/messages';

import type { Locale } from '@rondo/core/i18n/locale';

export const dayLabel = (locale: Locale, localDate: string): string => formatSessionLabel(locale, { localDate, localTime: '' }).trim();
