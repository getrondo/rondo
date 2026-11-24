import { isDefined } from '@rnw-community/shared';

import { addDays } from '../extract/zoned-time';

export interface DatedLink {
    readonly date: string;
    readonly personId: string | null;
}

interface LinkRange {
    readonly personId: string;
    readonly during: string;
}

export const dayRange = (first: string, last: string): string => `[${first},${addDays(last, 1)})`;

export const rangesOf = (timeline: readonly DatedLink[]): LinkRange[] => {
    const runs: { personId: string | null; first: string; last: string }[] = [];

    for (const { date, personId } of timeline) {
        const run = runs.at(-1);

        if (isDefined(run) && run.personId === personId) {
            run.last = date;
        } else {
            runs.push({ personId, first: date, last: date });
        }
    }

    return runs.flatMap(({ personId, first, last }) => (isDefined(personId) ? [{ personId, during: dayRange(first, last) }] : []));
};
