import { isDefined } from '@rnw-community/shared';
import * as Option from 'effect/Option';

import { mergeUsers } from '../parse/parse-snapshot';

import { assemblePlan, type PlannedSession } from './assemble-plan';
import { extractAll } from './extract-all';
import { extractOtherChat, gameOfPolls } from './extract-other-chat';
import { isOtherGame, mergePlans } from './merge-plans';
import { originalPolls } from './original-polls';
import { postIdOf, sourceOf } from './post-id';

import type { CommunityConfig } from '../config/community-config';
import type { ChatContent } from '../interface/chat-content.interface';
import type { TelegramMessage } from '../model/telegram-message.model';
import type { TelegramSnapshot } from '../model/telegram-snapshot.model';
import type { ExtractedFacts, PollFact } from './fact.model';

interface Chats {
    readonly config: CommunityConfig;
    readonly main: ChatContent;
    readonly others: readonly ChatContent[];
    readonly asOf: string;
}

const numberedMap = <Value>(map: ReadonlyMap<number, Value>, place: number): Map<number, Value> =>
    new Map([...map].map(([messageId, value]) => [postIdOf(place, messageId), value]));

const numberedPost = (place: number, message: TelegramMessage): TelegramMessage => ({
    ...message,
    id: postIdOf(place, message.id),
    ...(isDefined(message.replyTo) ? { replyTo: postIdOf(place, message.replyTo) } : {})
});

const numberedSnapshot = (place: number, snapshot: TelegramSnapshot): TelegramSnapshot => ({
    ...snapshot,
    pollIdByMessage: numberedMap(snapshot.pollIdByMessage, place)
});

export const numberPosts = (place: number, { messages, snapshot }: ChatContent): ChatContent => ({
    messages: messages.map(message => numberedPost(place, message)),
    snapshot: snapshot.pipe(Option.map(content => numberedSnapshot(place, content)))
});

const extractMain = (config: CommunityConfig, { messages, snapshot }: ChatContent, originals: ReturnType<typeof originalPolls>) =>
    extractAll(messages, config, {
        originals,
        ...Option.match(snapshot, {
            onNone: () => ({}),
            onSome: ({ topicByMessage, pollIdByMessage }) => ({
                pollIdByMessage,
                isGamePost: (messageId: number) => topicByMessage?.get(messageId) === config.gamesTopicId
            })
        })
    });

const mergeSnapshots = (main: TelegramSnapshot, other: TelegramSnapshot, isOriginal: (pollId: string) => boolean): TelegramSnapshot => {
    const voted = new Set(main.votes.map(({ pollId }) => pollId));
    const known = new Set([...main.pollIdByMessage.values()].filter(pollId => voted.has(pollId) || !isOriginal(pollId)));

    return {
        ...main,
        users: mergeUsers([...main.users.values(), ...other.users.values()]),
        pollIdByMessage: new Map([...main.pollIdByMessage, ...other.pollIdByMessage]),
        votes: [...main.votes, ...other.votes.filter(({ pollId }) => !known.has(pollId))]
    };
};

// A copy in the main chat of a game 90 minutes from the main one only refers to it
const separateCopies = (facts: ExtractedFacts, asOf: string, isCopy: (poll: PollFact) => boolean) => {
    const own = assemblePlan({ ...facts, polls: facts.polls.filter(poll => !isCopy(poll)) }, asOf);
    const apart = facts.polls.filter(poll => {
        const times = { statedTimes: [poll.localTime].filter(time => isDefined(time)) };

        return isCopy(poll) && own.sessions.some(game => game.key === `${poll.localDate}|${poll.sport}` && isOtherGame(game, times));
    });

    return { facts: { ...facts, polls: facts.polls.filter(poll => !apart.includes(poll)) }, apart };
};

const withCopies = (planned: PlannedSession, copies: readonly PollFact[], pollIdOf: (messageId: number) => string | undefined) => {
    const pollIds = new Set(planned.pollMessageIds.map(messageId => pollIdOf(messageId)));
    const ids = copies.map(({ messageId }) => messageId).filter(messageId => pollIds.has(pollIdOf(messageId)));

    return { ...planned, pollMessageIds: [...planned.pollMessageIds, ...ids] };
};

export const planChats = ({ config, main, others, asOf }: Chats) => {
    const originals = originalPolls(config, [main, ...others]);
    const review: (ReturnType<typeof sourceOf> & { readonly localDate: string })[] = [];
    let merged = main.snapshot;
    const pollIdOf = (messageId: number) => Option.getOrUndefined(merged)?.pollIdByMessage.get(messageId);
    const { facts, apart } = separateCopies(extractMain(config, main, originals), asOf, ({ messageId }) =>
        originals.has(pollIdOf(messageId) ?? '')
    );
    let plan = assemblePlan(facts, asOf);

    for (const [index, { messages, snapshot: content }] of others.entries()) {
        const chat = config.otherChats?.[index];

        if (isDefined(chat) && Option.isSome(content)) {
            const pollIds = merged.pipe(
                Option.map(({ pollIdByMessage }) => pollIdByMessage),
                Option.getOrElse((): ReadonlyMap<number, string> => new Map())
            );
            const isOriginal = (pollId: string): boolean => originals.get(pollId)?.place === index + 1;
            const extracted = extractOtherChat(messages, config, {
                chat,
                pollIdByMessage: content.value.pollIdByMessage,
                gameOfPoll: gameOfPolls(pollIds, plan, isOriginal)
            });
            const { unattached, ...next } = mergePlans(plan, {
                plan: assemblePlan(extracted.facts, asOf),
                forwarded: extracted.forwarded,
                ownGameDates: chat.ownGameDates ?? []
            });
            const left = unattached.map(({ localDate, lineup }) => ({ messageId: lineup?.messageId ?? 0, localDate }));
            plan = next;
            review.push(
                ...[...extracted.review, ...left].map(({ messageId, localDate }) =>
                    Object.assign(sourceOf(config.otherChats, messageId), { localDate })
                )
            );
            merged = Option.some(
                Option.match(merged, { onNone: () => content.value, onSome: known => mergeSnapshots(known, content.value, isOriginal) })
            );
        }
    }

    return { plan: { ...plan, sessions: plan.sessions.map(planned => withCopies(planned, apart, pollIdOf)) }, snapshot: merged, review };
};
