export const weekdayOf = (localDate: string): number => new Date(`${localDate}T12:00:00Z`).getUTCDay();
