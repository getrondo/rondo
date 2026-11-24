import type { Locale } from './locale';

type Unit = 'games' | 'polls';

type Forms = Readonly<Record<'one' | 'few' | 'many', string>>;

const forms: Readonly<Record<Locale, Readonly<Record<Unit, Forms>>>> = {
    uk: { games: { one: 'гра', few: 'гри', many: 'ігор' }, polls: { one: 'опитування', few: 'опитування', many: 'опитувань' } },
    ru: { games: { one: 'игра', few: 'игры', many: 'игр' }, polls: { one: 'опрос', few: 'опроса', many: 'опросов' } }
};

const formOf = (count: number): keyof Forms => {
    const lastTwo = count % 100;
    const last = count % 10;

    if (last === 1 && lastTwo !== 11) {
        return 'one';
    }

    return last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? 'few' : 'many';
};

export const countLabel = (locale: Locale, unit: Unit, count: number): string => `${count} ${forms[locale][unit][formOf(count)]}`;
