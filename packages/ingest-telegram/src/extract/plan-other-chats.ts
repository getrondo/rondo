import { isDefined } from '@rnw-community/shared';
import * as Option from 'effect/Option';

import { mergeUsers } from '../parse/parse-snapshot';

import { assemblePlan, type ImportPlan } from './assemble-plan';
import { extractOtherChat, mainPollsOf } from './extract-other-chat';
import { mergePlans } from './merge-plans';
import { postIdOf } from './post-id';

import type { CommunityConfig } from '../config/community-config';
import type { TelegramMessage } from '../model/telegram-message.model';
import type { TelegramSnapshot } from '../model/telegram-snapshot.model';

export interface ChatContent {
    readonly messages: readonly TelegramMessage[];
    readonly snapshot: Option.Option<TelegramSnapshot>;
}

interface Chats {
    readonly config: CommunityConfig;
    readonly main: ImportPlan;
    readonly snapshot: Option.Option<TelegramSnapshot>;
    readonly others: readonly ChatContent[];
    readonly asOf: string;
}

const numberedMap = <Value>(map: ReadonlyMap<number, Value>, place: number): Map<number, Value> =>
    new Map([...map].map(([messageId, value]) => [postIdOf(place, messageId), value]));

export const numberPosts = (place: number, { messages, snapshot }: ChatContent): ChatContent => ({
    messages: messages.map(message =>
        Object.assign(message, {
            id: postIdOf(place, message.id),
            ...(isDefined(message.replyTo) ? { replyTo: postIdOf(place, message.replyTo) } : {})
        })
    ),
    snapshot: snapshot.pipe(Option.map(content => Object.assign(content, { pollIdByMessage: numberedMap(content.pollIdByMessage, place) })))
});

const mergeSnapshots = (main: TelegramSnapshot, other: TelegramSnapshot): TelegramSnapshot => {
    const known = new Set(main.pollIdByMessage.values());

    return {
        ...main,
        users: mergeUsers([...main.users.values(), ...other.users.values()]),
        pollIdByMessage: new Map([...main.pollIdByMessage, ...other.pollIdByMessage]),
        votes: [...main.votes, ...other.votes.filter(({ pollId }) => !known.has(pollId))]
    };
};

export const planOtherChats = ({ config, main, snapshot, others, asOf }: Chats) => {
    const review: { readonly localDate: string; readonly title: string }[] = [];
    let plan = main;
    let merged = snapshot;

    for (const [index, { messages, snapshot: content }] of others.entries()) {
        const chat = config.otherChats?.[index];

        if (isDefined(chat) && Option.isSome(content)) {
            const pollIds = merged.pipe(
                Option.map(({ pollIdByMessage }) => pollIdByMessage),
                Option.getOrElse((): ReadonlyMap<number, string> => new Map())
            );
            const extracted = extractOtherChat(messages, config, {
                chat,
                pollIdByMessage: content.value.pollIdByMessage,
                mainPolls: mainPollsOf(pollIds, plan)
            });
            const { unattached, ...next } = mergePlans(plan, assemblePlan(extracted.facts, asOf), extracted.forwardedPosts);
            plan = next;
            review.push(
                ...extracted.review.map(({ localDate, title }) => ({ localDate, title })),
                ...unattached.map(({ localDate, title }) => ({ localDate, title: title ?? 'squad' }))
            );
            merged = Option.some(
                Option.match(merged, { onNone: () => content.value, onSome: known => mergeSnapshots(known, content.value) })
            );
        }
    }

    return { plan, snapshot: merged, review };
};
