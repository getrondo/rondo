// What a chat that also has matches means by a post: a weekly game, a match or something to review
import { isDefined } from '@rnw-community/shared';

import { compile, matchesAny } from './normalize';
import { isPublicHoliday } from './public-holiday';
import { weekdayOf } from './zoned-time';

import type { CommunityConfig, OtherChatConfig } from '../config/community-config';
import type { PollFact } from './fact.model';

const weekend = new Set([0, 6]);

export const chatRules = (config: CommunityConfig, { matchPatterns, matchDates = [] }: OtherChatConfig) => {
    const patterns = compile(matchPatterns);
    const kindOfVenue = new Map(config.venues.map(({ key, kind }) => [key, kind]));
    const isMatchDay = (localDate: string): boolean =>
        weekend.has(weekdayOf(localDate)) || isPublicHoliday(localDate) || matchDates.includes(localDate);
    const kindOf = ({
        localDate,
        title,
        venueKey
    }: Pick<PollFact, 'localDate' | 'title' | 'venueKey'>): 'regular' | 'match' | 'unclear' => {
        const isTraining = kindOfVenue.get(venueKey ?? '') === 'training';

        if (matchesAny(title, patterns) || (isDefined(venueKey) && !isTraining) || matchDates.includes(localDate)) {
            return 'match';
        }

        if (!isMatchDay(localDate)) {
            return 'regular';
        }

        return isTraining ? 'unclear' : 'match';
    };

    return { isMatchDay, kindOf };
};
