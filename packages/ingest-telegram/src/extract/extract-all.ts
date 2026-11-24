import { isDefined } from '@rnw-community/shared';

import { extractLineup } from './extract-lineup';
import { extractPoll, isReservePoll, makeVenueMatcher } from './extract-poll';
import { extractCancellation, extractPrice, makeFixtureExtractor } from './extract-signals';

import type { CommunityConfig } from '../config/community-config';
import type { TelegramMessage } from '../model/telegram-message.model';
import type { AccountFact, AuthorFact, ExtractedFacts, GuestRequestFact, PollFact, PollPostFact } from './fact.model';

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

const collectAccounts = (messages: readonly TelegramMessage[]): AccountFact[] => {
    const accounts = new Map<number, AccountFact>();

    for (const { author, authorId, mentions, sentAt } of messages) {
        if (!isDefined(sentAt)) {
            continue;
        }

        const seen = [
            ...(isDefined(authorId) ? [{ userId: authorId, displayName: author ?? '' }] : []),
            ...(mentions ?? []).flatMap(({ userId, text }) => (isDefined(userId) ? [{ userId, displayName: text }] : []))
        ];

        for (const { userId, displayName } of seen) {
            const current = accounts.get(userId);
            accounts.set(
                userId,
                isDefined(current) ? { ...current, lastSeenAt: sentAt } : { userId, displayName, firstSeenAt: sentAt, lastSeenAt: sentAt }
            );
        }
    }

    return [...accounts.values()];
};

const guestRequest = /^\+ ?([1-9])(?!\d)/u;
const guestRequestMaxLength = 40;

const collectGuestRequests = (messages: readonly TelegramMessage[]): GuestRequestFact[] =>
    messages.flatMap(({ id, authorId, text, replyTo }) => {
        const trimmed = (text ?? '').trim();
        const guests = Number(guestRequest.exec(trimmed)?.[1] ?? 0);

        return guests === 0 || trimmed.length > guestRequestMaxLength || !isDefined(authorId)
            ? []
            : [{ messageId: id, userId: authorId, replyTo, guests }];
    });

interface ExtractOptions {
    readonly isGamePost?: (messageId: number) => boolean;
    readonly pollIdByMessage?: ReadonlyMap<number, string>;
}

const asFirstPost = (polls: readonly PollFact[], pollIdByMessage: ReadonlyMap<number, string>): PollFact[] => {
    const firstById = new Map<string, PollFact>();

    return polls.map(poll => {
        const pollId = pollIdByMessage.get(poll.messageId) ?? `message ${poll.messageId}`;
        const first = firstById.get(pollId) ?? poll;
        firstById.set(pollId, first);

        return { ...first, messageId: poll.messageId, yesVoters: poll.yesVoters };
    });
};

const pollPostOf = ({ id, poll, sentAt }: TelegramMessage): PollPostFact[] =>
    isDefined(poll) && isDefined(sentAt)
        ? [{ messageId: id, postedAt: sentAt, answers: poll.answers.length, isReserve: isReservePoll(poll) }]
        : [];

export const extractAll = (
    messages: readonly TelegramMessage[],
    config: CommunityConfig,
    { isGamePost, pollIdByMessage }: ExtractOptions = {}
): ExtractedFacts => {
    const organizers = new Set(config.organizers);
    const venueOf = makeVenueMatcher(config);
    const fixtureOf = makeFixtureExtractor(config, organizers);
    const own = messages.filter(message => message.kind === 'message');
    const gamePosts = own.filter(message => isGamePost?.(message.id) !== false);
    const polls = gamePosts.map(message => extractPoll(message, config, venueOf)).filter(fact => isDefined(fact));

    return {
        polls: asFirstPost(polls, pollIdByMessage ?? new Map()),
        lineups: gamePosts.map(message => extractLineup(message, config, venueOf)).filter(fact => isDefined(fact)),
        prices: own.map(message => extractPrice(message, config, organizers, venueOf)).filter(fact => isDefined(fact)),
        cancellations: gamePosts.map(message => extractCancellation(message, config, organizers)).filter(fact => isDefined(fact)),
        fixtures: own.flatMap(message => fixtureOf(message)),
        authors: collectAuthors(own),
        accounts: collectAccounts(own),
        guestRequests: collectGuestRequests(gamePosts),
        pollPosts: own.flatMap(message => pollPostOf(message))
    };
};
