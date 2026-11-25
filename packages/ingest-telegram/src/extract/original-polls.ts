import { isDefined } from '@rnw-community/shared';
import * as Option from 'effect/Option';

import { chatRules } from './chat-rules';
import { extractPoll, makeVenueMatcher } from './extract-poll';

import type { CommunityConfig } from '../config/community-config';
import type { ChatContent } from '../interface/chat-content.interface';
import type { PollFact } from './fact.model';

interface OriginalPoll {
    readonly place: number;
    readonly fact: Option.Option<PollFact>;
}

// Polls first posted in another chat: its post and rules decide the day and whether it is a game, also for later copies
export const originalPolls = (config: CommunityConfig, chats: readonly ChatContent[]): ReadonlyMap<string, OriginalPoll> => {
    const venueOf = makeVenueMatcher(config);
    const posts = chats.flatMap(({ messages, snapshot }, place) =>
        messages.flatMap(message => {
            const pollId = snapshot.pipe(Option.flatMapNullishOr(({ pollIdByMessage }) => pollIdByMessage.get(message.id)));

            return Option.isSome(pollId) && isDefined(message.poll) && isDefined(message.sentAt)
                ? [{ pollId: pollId.value, message, place, sentAt: message.sentAt.getTime() }]
                : [];
        })
    );
    const first = new Map(
        posts.toSorted((left, right) => right.sentAt - left.sentAt || right.place - left.place).map(post => [post.pollId, post])
    );

    return new Map(
        [...first].flatMap(([pollId, { place, message }]) => {
            const chat = config.otherChats?.[place - 1];

            return isDefined(chat)
                ? [
                      [
                          pollId,
                          {
                              place,
                              fact: Option.fromNullishOr(extractPoll(message, config, venueOf)).pipe(
                                  Option.filter(fact => chatRules(config, chat).kindOf(fact) === 'regular')
                              )
                          }
                      ] as const
                  ]
                : [];
        })
    );
};
