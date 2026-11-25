import { isDefined } from '@rnw-community/shared';

import type { Locale } from './locale';

const weekdays: Readonly<Record<Locale, readonly string[]>> = {
    uk: ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
    ru: ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
};

const cancelReasons: Readonly<Record<Locale, Readonly<Record<string, string>>>> = {
    uk: {
        weather: 'погода',
        low_turnout: 'мало гравців',
        venue: 'поле недоступне',
        holiday: 'свято',
        organizer: 'рішення організатора',
        other: 'інше'
    },
    ru: {
        weather: 'погода',
        low_turnout: 'мало игроков',
        venue: 'поле недоступно',
        holiday: 'праздник',
        organizer: 'решение организатора',
        other: 'другое'
    }
};

const countedNouns: Readonly<Record<Locale, Record<'field' | 'place', Readonly<Record<string, string>>>>> = {
    uk: { field: { one: 'поле', few: 'поля', many: 'полів' }, place: { one: 'місце', few: 'місця', many: 'місць' } },
    ru: { field: { one: 'поле', few: 'поля', many: 'полей' }, place: { one: 'место', few: 'места', many: 'мест' } }
};

const catalogue = {
    uk: {
        pollIn: '✅ Граю',
        pollOut: '❌ Не граю',
        changed: '📢 Зміни',
        cancelled: '❌ Скасовано',
        reason: 'Причина',
        promoted: 'звільнилося місце — ти в складі!',
        lineups: 'Склади',
        confirm: '✅ Так',
        reject: '❌ Ні',
        confirmQuestion: 'Підтвердити?',
        done: 'Виконано ✅',
        rejected: 'Скасовано, нічого не змінено.',
        expired: 'Час на підтвердження минув.',
        failed: 'Не вдалося виконати',
        notAdmin: 'Привіт! Я Rondo, бот футбольної спільноти. Поки що я працюю з адміністраторами.',
        adminGreeting:
            'Привіт! Я Rondo. Пиши звичайними словами, наприклад:\n• хто найчастіше грав цього місяця?\n• створи гру в пʼятницю о 19:30 на Park, 18 місць\n• перенеси суботню гру на неділю\n• розбий на 2 команди тих, хто записався на сьогодні',
        linked: 'Групу підключено до спільноти',
        unknownCommunity: 'Спільноту не знайдено',
        forwardHint: '↪️ Перешли це в групу.',
        placesWord: 'Місць'
    },
    ru: {
        pollIn: '✅ Играю',
        pollOut: '❌ Не играю',
        changed: '📢 Изменения',
        cancelled: '❌ Отменено',
        reason: 'Причина',
        promoted: 'освободилось место — ты в составе!',
        lineups: 'Составы',
        confirm: '✅ Да',
        reject: '❌ Нет',
        confirmQuestion: 'Подтвердить?',
        done: 'Готово ✅',
        rejected: 'Отменено, ничего не изменено.',
        expired: 'Время на подтверждение истекло.',
        failed: 'Не удалось выполнить',
        notAdmin: 'Привет! Я Rondo, бот футбольного сообщества. Пока я работаю с администраторами.',
        adminGreeting:
            'Привет! Я Rondo. Пиши обычными словами, например:\n• кто чаще всех играл в этом месяце?\n• создай игру в пятницу в 19:30 на Park, 18 мест\n• перенеси субботнюю игру на воскресенье\n• раздели на 2 команды записавшихся на сегодня',
        linked: 'Группа подключена к сообществу',
        unknownCommunity: 'Сообщество не найдено',
        forwardHint: '↪️ Перешли это в группу.',
        placesWord: 'Мест'
    }
} as const satisfies Record<Locale, Record<string, string>>;

export type MessageKey = keyof (typeof catalogue)['uk'];

export const text = (locale: Locale, key: MessageKey): string => catalogue[locale][key];

export const cancelReasonText = (locale: Locale, reason: string): string => cancelReasons[locale][reason] ?? reason;

export const countOf = (locale: Locale, noun: 'field' | 'place', count: number): string =>
    `${count} ${countedNouns[locale][noun][new Intl.PluralRules(locale).select(count)] ?? ''}`;

export const formatSessionLabel = (
    locale: Locale,
    input: { readonly localDate: string; readonly localTime: string; readonly venueName?: string | null }
): string => {
    const [, month = '', day = ''] = input.localDate.split('-');
    const weekday = weekdays[locale][new Date(`${input.localDate}T12:00:00Z`).getUTCDay()] ?? '';
    const venue = isDefined(input.venueName) ? ` · ${input.venueName}` : '';

    return `${weekday} ${day}.${month} ${input.localTime}${venue}`;
};
