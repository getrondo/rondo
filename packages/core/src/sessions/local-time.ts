import { zonedToInstant } from '../extract/zoned-time';

export const gameDurationMinutes = 90;

// Games of one day at least this far apart are two games
export const separateGamesMinutes = 90;

export const localTimeOf = (instant: Date, timeZone: string): string =>
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instant);

export const instantOf = (localDate: string, localTime: string, timeZone: string): Date => {
    const [year = 0, month = 1, day = 1] = localDate.split('-').map(Number);
    const [hour = 0, minute = 0] = localTime.split(':').map(Number);

    return zonedToInstant({ year, month, day, hour, minute }, timeZone);
};

export const todayIn = (timeZone: string, now: Date = new Date()): string =>
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
