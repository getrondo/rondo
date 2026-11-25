import { isDefined } from '@rnw-community/shared';

import { chatRules } from './chat-rules';
import { extractAll } from './extract-all';

import type { CommunityConfig, OtherChatConfig } from '../config/community-config';
import type { TelegramMessage } from '../model/telegram-message.model';
import type { ImportPlan } from './assemble-plan';
import type { ExtractedFacts } from './fact.model';

interface OtherChat {
    readonly chat: OtherChatConfig;
    readonly pollIdByMessage: ReadonlyMap<number, string>;
    readonly gameOfPoll: ReadonlyMap<string, ForwardedGame | null>;
}

interface ForwardedGame {
    readonly key: string;
    readonly isReserve: boolean;
}

export interface ForwardedPost extends ForwardedGame {
    readonly messageId: number;
}

export const extractOtherChat = (
    messages: readonly TelegramMessage[],
    config: CommunityConfig,
    { chat, pollIdByMessage, gameOfPoll }: OtherChat
) => {
    const { kindOf } = chatRules(config, chat);
    const { polls, ...facts } = extractAll(messages, config, { pollIdByMessage });
    const own = polls.filter(({ messageId }) => !gameOfPoll.has(pollIdByMessage.get(messageId) ?? ''));
    const forwarded = facts.pollPosts.flatMap(({ messageId }): ForwardedPost[] => {
        const game = gameOfPoll.get(pollIdByMessage.get(messageId) ?? '');

        return isDefined(game) ? [{ ...game, messageId }] : [];
    });
    const regular = own.filter(poll => kindOf(poll) === 'regular');
    const lineups = facts.lineups.filter(lineup => kindOf(lineup) === 'regular');
    const ownDates = new Set(
        [...regular.filter(({ isGame, isDateChoice }) => isGame && !isDateChoice), ...lineups].map(({ localDate }) => localDate)
    );

    return {
        facts: {
            ...facts,
            polls: regular.map(poll =>
                Object.assign(poll, {
                    isGame: poll.isGame && !poll.isDateChoice,
                    joinDates: poll.joinDates.filter(date => ownDates.has(date))
                })
            ),
            lineups,
            cancellations: facts.cancellations.filter(cancellation => kindOf(cancellation) === 'regular'),
            prices: [],
            fixtures: [],
            authors: []
        } satisfies ExtractedFacts,
        forwarded,
        review: [...own.filter(({ isGame }) => isGame), ...facts.lineups]
            .filter(fact => kindOf(fact) === 'unclear')
            .map(({ messageId, localDate }) => ({ messageId, localDate }))
    };
};

// A forward belongs to the game of its first post, whatever the forwarded text would mean on its own day
export const gameOfPolls = (
    pollIdByMessage: ReadonlyMap<number, string>,
    { sessions }: ImportPlan,
    isOriginalHere: (pollId: string) => boolean
): ReadonlyMap<string, ForwardedGame | null> => {
    const games = new Map<string, ForwardedGame | null>(
        [...pollIdByMessage.values()].filter(pollId => !isOriginalHere(pollId)).map(pollId => [pollId, null])
    );

    for (const { key, pollMessageIds, reservePollMessageIds } of sessions) {
        for (const messageId of [...reservePollMessageIds, ...pollMessageIds]) {
            const pollId = pollIdByMessage.get(messageId);

            if (isDefined(pollId)) {
                games.set(pollId, { key, isReserve: reservePollMessageIds.includes(messageId) });
            }
        }
    }

    return games;
};
