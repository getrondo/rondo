const offsetMinutes = (instant: Date, timeZone: string): number => {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    }).formatToParts(instant);
    const get = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find(part => part.type === type)?.value ?? 0);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));

    return (asUtc - instant.getTime()) / 60_000;
};

export interface LocalDateTime {
    readonly year: number;
    readonly month: number;
    readonly day: number;
    readonly hour: number;
    readonly minute: number;
    readonly second?: number;
}

export const zonedToInstant = (local: LocalDateTime, timeZone: string): Date => {
    const naive = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second ?? 0);
    const firstGuess = naive - offsetMinutes(new Date(naive), timeZone) * 60_000;

    return new Date(naive - offsetMinutes(new Date(firstGuess), timeZone) * 60_000);
};

export const instantToLocalDate = (instant: Date, timeZone: string): string =>
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);

export const addDays = (isoDate: string, days: number): string => {
    const date = new Date(`${isoDate}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);

    return date.toISOString().slice(0, 10);
};

export const weekdayOf = (isoDate: string): number => new Date(`${isoDate}T12:00:00Z`).getUTCDay();
