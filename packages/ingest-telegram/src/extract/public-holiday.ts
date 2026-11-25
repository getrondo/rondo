import { addDays } from './zoned-time';

const fixedHolidays = new Set(['01-01', '01-06', '05-01', '08-15', '10-26', '11-01', '12-08', '12-25', '12-26']);
const daysAfterEaster = [1, 39, 50, 60];

const easterSunday = (year: number): string => {
    const golden = year % 19;
    const century = Math.floor(year / 100);
    const epact =
        (19 * golden + century - Math.floor(century / 4) - Math.floor((century - Math.floor((century + 8) / 25) + 1) / 3) + 15) % 30;
    const weekday = (32 + 2 * (century % 4) + 2 * Math.floor((year % 100) / 4) - epact - ((year % 100) % 4)) % 7;
    const correction = Math.floor((golden + 11 * epact + 22 * weekday) / 451);

    return addDays(`${year}-03-22`, epact + weekday - 7 * correction);
};

export const isPublicHoliday = (localDate: string): boolean =>
    fixedHolidays.has(localDate.slice(5)) ||
    daysAfterEaster.some(days => addDays(easterSunday(Number(localDate.slice(0, 4))), days) === localDate);
