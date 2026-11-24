import { isDefined } from '@rnw-community/shared';

import { extractLineup } from './extract-lineup';
import { extractPoll, makeVenueMatcher } from './extract-poll';
import { extractCancellation, extractLocation, extractPrice, makeFixtureExtractor } from './extract-signals';

import type { CommunityConfig } from '../config/community-config';
import type { TelegramMessage } from '../model/telegram-message.model';
import type { AuthorFact, ExtractedFacts } from './fact.model';

const collectAuthors = (messages: readonly TelegramMessage[]): AuthorFact[] => {
    const authors = new Map<string, AuthorFact>();

    for (const { author, sentAt } of messages) {
        if (!isDefined(author) || !isDefined(sentAt)) {
            continue;
        }

        const current = authors.get(author);

        authors.set(
            author,
            isDefined(current)
                ? { ...current, messageCount: current.messageCount + 1, lastSeenAt: sentAt }
                : { displayName: author, messageCount: 1, firstSeenAt: sentAt, lastSeenAt: sentAt }
        );
    }

    return [...authors.values()];
};

export const extractAll = (messages: readonly TelegramMessage[], config: CommunityConfig): ExtractedFacts => {
    const organizers = new Set(config.organizers);
    const venueOf = makeVenueMatcher(config);
    const fixtureOf = makeFixtureExtractor(config, organizers);
    const own = messages.filter(message => message.kind === 'message');

    return {
        polls: own.map(message => extractPoll(message, config, venueOf)).filter(fact => isDefined(fact)),
        lineups: own.map(message => extractLineup(message, config, venueOf)).filter(fact => isDefined(fact)),
        prices: own.map(message => extractPrice(message, config, organizers, venueOf)).filter(fact => isDefined(fact)),
        cancellations: own.map(message => extractCancellation(message, config, organizers)).filter(fact => isDefined(fact)),
        fixtures: own.flatMap(message => fixtureOf(message)),
        authors: collectAuthors(own),
        locations: own.map(message => extractLocation(message, config)).filter(fact => isDefined(fact))
    };
};
