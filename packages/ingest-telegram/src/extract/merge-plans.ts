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

// One day and time is one game, and the main chat describes it. A squad of the other chat without a poll there stays out of a main game
export const mergePlans = (main: ImportPlan, other: ImportPlan, forwardedPosts: ReadonlySet<number>) => {
    const mainByKey = new Map(main.sessions.map(planned => [planned.key, planned]));
    const isOtherTime = ({ key, localTime, pollMessageIds }: PlannedSession): boolean =>
        isNotEmptyArray(pollMessageIds) &&
        !pollMessageIds.some(messageId => forwardedPosts.has(messageId)) &&
        mainByKey.get(key)?.localTime !== localTime;
    const others = other.sessions.map(planned =>
        mainByKey.has(planned.key) && isOtherTime(planned)
            ? Object.assign(planned, { key: `${planned.key}|${planned.localTime}` })
            : planned
    );
    const otherByKey = new Map(others.map(planned => [planned.key, planned]));
    const isAttached = ({ key, pollMessageIds }: PlannedSession): boolean => !mainByKey.has(key) || isNotEmptyArray(pollMessageIds);
    const sessions = [
        ...main.sessions.map(planned => {
            const found = otherByKey.get(planned.key);

            return isDefined(found) && isAttached(found) ? withOtherChat(planned, found) : planned;
        }),
        ...others.filter(({ key }) => !mainByKey.has(key))
    ].toSorted((left, right) => (left.key < right.key ? -1 : 1));
    const usedPosts = new Set(sessions.flatMap(planned => [...planned.pollMessageIds, ...planned.reservePollMessageIds]));

    return {
        ...main,
        sessions,
        unattached: others.filter(planned => !isAttached(planned)),
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
