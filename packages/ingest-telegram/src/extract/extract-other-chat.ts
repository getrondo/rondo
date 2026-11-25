import { isDefined } from '@rnw-community/shared';
import * as Option from 'effect/Option';

import { extractAll } from './extract-all';
import { compile, matchesAny } from './normalize';
import { isPublicHoliday } from './public-holiday';
import { weekdayOf } from './zoned-time';

import type { CommunityConfig, OtherChatConfig } from '../config/community-config';
import type { TelegramMessage } from '../model/telegram-message.model';
import type { ImportPlan } from './assemble-plan';
import type { ExtractedFacts, PollFact } from './fact.model';

interface OtherChat {
    readonly chat: OtherChatConfig;
    readonly pollIdByMessage: ReadonlyMap<number, string>;
    readonly mainPolls: ReadonlyMap<string, Option.Option<PollFact>>;
}

const weekend = new Set([0, 6]);

const isMatchDay = (localDate: string): boolean => weekend.has(weekdayOf(localDate)) || isPublicHoliday(localDate);

const makeKindOf = (config: CommunityConfig, chat: OtherChatConfig) => {
    const patterns = compile(chat.matchPatterns);
    const kindOfVenue = new Map(config.venues.map(({ key, kind }) => [key, kind]));

    return ({ localDate, title, venueKey }: PollFact): 'regular' | 'match' | 'unclear' => {
        const isTraining = kindOfVenue.get(venueKey ?? '') === 'training';

        if (matchesAny(title, patterns) || (isDefined(venueKey) && !isTraining)) {
            return 'match';
        }

        if (!isMatchDay(localDate)) {
            return 'regular';
        }

        return isTraining ? 'unclear' : 'match';
    };
};

export const extractOtherChat = (
    messages: readonly TelegramMessage[],
    config: CommunityConfig,
    { chat, pollIdByMessage, mainPolls }: OtherChat
) => {
    const kindOf = makeKindOf(config, chat);
    const { polls, ...facts } = extractAll(messages, config, { pollIdByMessage });
    const mainPollOf = ({ messageId }: PollFact) => mainPolls.get(pollIdByMessage.get(messageId) ?? `message ${messageId}`);
    const own = polls.filter(poll => !isDefined(mainPollOf(poll)));
    const forwarded = polls.flatMap(poll =>
        Option.match(mainPollOf(poll) ?? Option.none(), {
            onNone: () => [],
            onSome: (first): PollFact[] => [{ ...first, messageId: poll.messageId }]
        })
    );

    const regular = own.filter(poll => kindOf(poll) === 'regular');
    const lineups = facts.lineups.filter(({ localDate }) => !isMatchDay(localDate));
    const ownDates = new Set(
        [...regular.filter(({ isGame, isDateChoice }) => isGame && !isDateChoice), ...lineups].map(({ localDate }) => localDate)
    );

    return {
        facts: {
            ...facts,
            polls: [
                ...forwarded,
                ...regular.map(poll =>
                    Object.assign(poll, {
                        isGame: poll.isGame && !poll.isDateChoice,
                        joinDates: poll.joinDates.filter(date => ownDates.has(date))
                    })
                )
            ],
            lineups,
            prices: [],
            fixtures: [],
            authors: []
        } satisfies ExtractedFacts,
        forwardedPosts: new Set(forwarded.map(({ messageId }) => messageId)),
        review: own.filter(poll => poll.isGame && kindOf(poll) === 'unclear')
    };
};

// A forward belongs to the game of its first post, whatever the forwarded text would mean on its own day
export const mainPollsOf = (
    pollIdByMessage: ReadonlyMap<number, string>,
    { sessions, facts }: ImportPlan
): ReadonlyMap<string, Option.Option<PollFact>> => {
    const games = new Map(
        sessions.flatMap(({ localDate, sport, pollMessageIds, reservePollMessageIds }) =>
            [...pollMessageIds, ...reservePollMessageIds].map(messageId => [messageId, { localDate, sport }] as const)
        )
    );
    const attached = facts.polls.flatMap(poll => {
        const game = games.get(poll.messageId);
        const pollId = pollIdByMessage.get(poll.messageId);

        return isDefined(game) && isDefined(pollId)
            ? [[pollId, { ...poll, ...game, isGame: true, isDateChoice: false, joinDates: [] }] as const]
            : [];
    });
    const known = new Map<string, PollFact>();

    for (const [pollId, poll] of attached) {
        known.set(pollId, known.get(pollId) ?? poll);
    }

    return new Map([...pollIdByMessage.values()].map(pollId => [pollId, Option.fromNullishOr(known.get(pollId))]));
};
