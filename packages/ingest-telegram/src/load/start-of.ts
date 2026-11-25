import { zonedToInstant } from '../extract/zoned-time';

import type { PlannedSession } from '../extract/assemble-plan';

export const sessionMillis = 90 * 60_000;

export const startOf = (planned: Pick<PlannedSession, 'localDate' | 'localTime'>, timeZone: string): Date => {
    const [year = 0, month = 1, day = 1] = planned.localDate.split('-').map(Number);
    const [hour = 19, minute = 0] = planned.localTime.split(':').map(Number);

    return zonedToInstant({ year, month, day, hour, minute }, timeZone);
};
