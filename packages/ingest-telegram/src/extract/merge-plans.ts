import { isDefined, isNotEmptyArray } from '@rnw-community/shared';

import type { ImportPlan, PlannedSession } from './assemble-plan';
import type { ForwardedPost } from './extract-other-chat';
import type { AccountFact } from './fact.model';

const withOtherChat = (main: PlannedSession, other: PlannedSession): PlannedSession => ({
    ...main,
    ...(isDefined(main.lineup) || !isDefined(other.lineup) || main.status === 'cancelled'
        ? {}
        : { lineup: other.lineup, status: 'played' as const }),
    statedTimes: [...main.statedTimes, ...other.statedTimes],
    pollMessageIds: [...main.pollMessageIds, ...other.pollMessageIds],
    reservePollMessageIds: [...main.reservePollMessageIds, ...other.reservePollMessageIds]
});

const mergeAccounts = (accounts: readonly AccountFact[]): AccountFact[] => {
    const merged = new Map<number, AccountFact>();

    for (const account of accounts) {
        const known = merged.get(account.userId) ?? account;
        merged.set(account.userId, {
            ...known,
            firstSeenAt: new Date(Math.min(known.firstSeenAt.getTime(), account.firstSeenAt.getTime())),
            lastSeenAt: new Date(Math.max(known.lastSeenAt.getTime(), account.lastSeenAt.getTime()))
        });
    }

    return [...merged.values()];
};

const minutesApart = 90;

const minutesOf = (time: string): number => {
    const [hour = 0, minute = 0] = time.split(':').map(Number);

    return hour * 60 + minute;
};

type Timed = Pick<PlannedSession, 'statedTimes'>;

export const isOtherGame = (main: Timed, other: Timed): boolean =>
    isNotEmptyArray(main.statedTimes) &&
    isNotEmptyArray(other.statedTimes) &&
    main.statedTimes.every(left => other.statedTimes.every(right => Math.abs(minutesOf(left) - minutesOf(right)) >= minutesApart));

interface OtherPlan {
    readonly plan: ImportPlan;
    readonly forwarded: readonly ForwardedPost[];
    readonly ownGameDates: readonly string[];
}

const withForwards = (planned: PlannedSession, forwarded: readonly ForwardedPost[]): PlannedSession => {
    const ofGame = forwarded.filter(({ key }) => key === planned.key);
    const idsOf = (isReserve: boolean): number[] => ofGame.filter(post => post.isReserve === isReserve).map(({ messageId }) => messageId);

    return {
        ...planned,
        pollMessageIds: [...planned.pollMessageIds, ...idsOf(false)],
        reservePollMessageIds: [...planned.reservePollMessageIds, ...idsOf(true)]
    };
};

// One day and time is one game, and the main chat describes it. A squad without a poll in its chat stays out of a main game
export const mergePlans = (main: ImportPlan, { plan: other, forwarded, ownGameDates }: OtherPlan) => {
    const sessions = new Map(main.sessions.map(planned => [planned.key, withForwards(planned, forwarded)]));
    const unattached: PlannedSession[] = [];

    for (const planned of other.sessions) {
        const sameDay = main.sessions.filter(({ localDate, sport }) => localDate === planned.localDate && sport === planned.sport);
        const isPolled = isNotEmptyArray(planned.pollMessageIds);
        const game = sameDay.find(
            candidate =>
                !isOtherGame(candidate, planned) &&
                !(isPolled && ownGameDates.includes(planned.localDate) && candidate.localTime !== planned.localTime) &&
                (isPolled || forwarded.some(({ key }) => key === candidate.key))
        );

        if (isDefined(game)) {
            sessions.set(game.key, withOtherChat(sessions.get(game.key) ?? game, planned));
        } else if (isPolled || !isNotEmptyArray(sameDay)) {
            const key = isNotEmptyArray(sameDay) ? `${planned.key}|${planned.localTime}` : planned.key;
            sessions.set(key, { ...planned, key });
        } else {
            unattached.push(planned);
        }
    }

    const merged = [...sessions.values()].toSorted((left, right) => (left.key < right.key ? -1 : 1));
    const usedPosts = new Set(merged.flatMap(planned => [...planned.pollMessageIds, ...planned.reservePollMessageIds]));

    return {
        ...main,
        sessions: merged,
        unattached,
        facts: {
            ...main.facts,
            polls: [...main.facts.polls, ...other.facts.polls],
            lineups: [...main.facts.lineups, ...other.facts.lineups],
            cancellations: [...main.facts.cancellations, ...other.facts.cancellations],
            accounts: mergeAccounts([...main.facts.accounts, ...other.facts.accounts]),
            guestRequests: [...main.facts.guestRequests, ...other.facts.guestRequests],
            pollPosts: [...main.facts.pollPosts, ...other.facts.pollPosts.filter(({ messageId }) => usedPosts.has(messageId))]
        }
    };
};
