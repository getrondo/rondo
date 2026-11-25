import { isDefined, isNotEmptyArray } from '@rnw-community/shared';

import type { ImportPlan, PlannedSession } from './assemble-plan';
import type { AccountFact } from './fact.model';

const withOtherChat = (main: PlannedSession, other: PlannedSession): PlannedSession => ({
    ...main,
    ...(isDefined(main.lineup) || !isDefined(other.lineup) || main.status === 'cancelled'
        ? {}
        : { lineup: other.lineup, status: 'played' as const }),
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

// The main chat describes a game of both chats. A squad of the other chat without a poll there stays out of a main game
export const mergePlans = (main: ImportPlan, other: ImportPlan) => {
    const mainByKey = new Map(main.sessions.map(planned => [planned.key, planned]));
    const otherByKey = new Map(other.sessions.map(planned => [planned.key, planned]));
    const isAttached = ({ key, pollMessageIds }: PlannedSession): boolean => !mainByKey.has(key) || isNotEmptyArray(pollMessageIds);
    const sessions = [
        ...main.sessions.map(planned => {
            const found = otherByKey.get(planned.key);

            return isDefined(found) && isAttached(found) ? withOtherChat(planned, found) : planned;
        }),
        ...other.sessions.filter(({ key }) => !mainByKey.has(key))
    ].toSorted((left, right) => (left.key < right.key ? -1 : 1));
    const usedPosts = new Set(sessions.flatMap(planned => [...planned.pollMessageIds, ...planned.reservePollMessageIds]));

    return {
        ...main,
        sessions,
        unattached: other.sessions.filter(planned => !isAttached(planned)),
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
