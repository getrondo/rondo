import { isDefined } from '@rnw-community/shared';
import * as Option from 'effect/Option';

import type { CancellationFact, ExtractedFacts, FixtureFact, LineupFact, PollFact, PriceFact, Sport } from './fact.model';

export interface PlannedSession {
    readonly key: string;
    readonly localDate: string;
    readonly localTime: string;
    readonly sport: Sport;
    readonly venueKey?: string;
    readonly capacityMax?: number;
    readonly fieldsPlanned?: number;
    readonly format?: string;
    readonly status: 'played' | 'cancelled' | 'open';
    readonly cancelReason?: CancellationFact['reason'];
    readonly reviewReason?: 'unclear_cancellation';
    readonly confidence: number;
    readonly title?: string;
    readonly pollMessageIds: readonly number[];
    readonly reservePollMessageIds: readonly number[];
    readonly lineup?: LineupFact;
    readonly cancellationMessageId?: number;
}

interface PlannedPrice {
    readonly appliesTo: PriceFact['appliesTo'];
    readonly venueKey?: string;
    readonly amountCents: number;
    readonly from: string;
    readonly to?: string;
}

export interface ImportPlan {
    readonly sessions: readonly PlannedSession[];
    readonly prices: readonly PlannedPrice[];
    readonly fixtures: readonly FixtureFact[];
    readonly facts: ExtractedFacts;
}

const defaultTime = '19:00';
const minYesForReview = 10;

const latest = <T extends { readonly messageId: number }>(items: readonly T[]): T | undefined => {
    const [first] = items.toSorted((a, b) => b.messageId - a.messageId);

    return first;
};

const groupBy = <T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> => {
    const groups = new Map<string, T[]>();

    for (const item of items) {
        groups.set(keyOf(item), [...(groups.get(keyOf(item)) ?? []), item]);
    }

    return groups;
};

interface SessionInputs {
    readonly key: string;
    readonly polls: readonly PollFact[];
    readonly reservePolls: readonly PollFact[];
    readonly lineup?: LineupFact;
    readonly cancellation?: CancellationFact;
    readonly asOf: string;
}

const statusOf = ({ lineup, cancellation }: SessionInputs, localDate: string, asOf: string): PlannedSession['status'] => {
    if (isDefined(lineup)) {
        return 'played';
    }

    if (isDefined(cancellation)) {
        return 'cancelled';
    }

    return localDate > asOf ? 'open' : 'played';
};

const confidenceOf = ({ lineup, cancellation }: SessionInputs, poll: PollFact | undefined): number => {
    if (isDefined(lineup)) {
        return 0.95;
    }

    return isDefined(cancellation) ? 0.75 : Math.min(poll?.confidence ?? 0.5, 0.6);
};

const buildSession = (inputs: SessionInputs): PlannedSession => {
    const { key, polls, reservePolls, lineup, cancellation, asOf } = inputs;
    const poll = latest(polls.filter(candidate => !candidate.isChoice)) ?? latest(polls);
    const [localDate = ''] = key.split('|');
    const appliedCancellation = isDefined(lineup) ? null : cancellation;
    const yesVoters = Math.max(0, ...polls.map(candidate => candidate.yesVoters));
    const isUnclear = isDefined(appliedCancellation) && !appliedCancellation.isExplicit && yesVoters >= minYesForReview;

    return {
        key,
        localDate,
        localTime: lineup?.localTime ?? poll?.localTime ?? defaultTime,
        sport: poll?.sport ?? 'football',
        venueKey: lineup?.venueKey ?? poll?.venueKey,
        capacityMax: poll?.capacityMax,
        fieldsPlanned: poll?.fieldsPlanned,
        format: poll?.format,
        status: statusOf(inputs, localDate, asOf),
        ...(isUnclear ? { reviewReason: 'unclear_cancellation' as const } : { cancelReason: appliedCancellation?.reason }),
        confidence: confidenceOf(inputs, poll),
        title: poll?.title,
        pollMessageIds: polls.map(candidate => candidate.messageId).toSorted((left, right) => left - right),
        reservePollMessageIds: reservePolls.map(candidate => candidate.messageId),
        lineup,
        cancellationMessageId: appliedCancellation?.messageId
    };
};

const monthlyMode = (prices: readonly PriceFact[]): { month: string; amountCents: number }[] =>
    [...groupBy(prices, price => price.localDate.slice(0, 7))]
        .map(([month, group]) => {
            const counts = [...groupBy(group, price => String(price.amountCents))].toSorted((a, b) => b[1].length - a[1].length);

            return { month, amountCents: Number(counts[0]?.[0] ?? 0) };
        })
        .toSorted((a, b) => a.month.localeCompare(b.month));

const planPrices = (prices: readonly PriceFact[]): PlannedPrice[] =>
    [...groupBy(prices, price => `${price.appliesTo}|${price.venueKey ?? ''}`)].flatMap(([, group]) => {
        const [first] = group;
        const months = monthlyMode(group);
        const changes = months.filter((month, index) => index === 0 || month.amountCents !== months[index - 1]?.amountCents);

        return changes.map((change, index) => ({
            appliesTo: first?.appliesTo ?? 'field',
            venueKey: first?.venueKey,
            amountCents: change.amountCents,
            from: `${change.month}-01`,
            to: Option.fromNullishOr(changes[index + 1]).pipe(
                Option.map(next => `${next.month}-01`),
                Option.getOrUndefined
            )
        }));
    });

const lineupSport = (date: string, pollsByKey: ReadonlyMap<string, readonly PollFact[]>): PollFact['sport'] => {
    const sameDay = [...pollsByKey].filter(([key]) => key.startsWith(`${date}|`)).flatMap(([, polls]) => polls);

    return sameDay.some(poll => poll.sport === 'football') ? 'football' : (latest(sameDay)?.sport ?? 'football');
};

const isCalledOff = (lineup: LineupFact, cancellation: CancellationFact | undefined): boolean =>
    lineup.postedDate < lineup.localDate && cancellation?.isExplicit === true && cancellation.messageId > lineup.messageId;

export const assemblePlan = (facts: ExtractedFacts, asOf: string): ImportPlan => {
    const gamePolls = facts.polls.filter(poll => !poll.isReserve);
    const keyOf = (poll: PollFact): string => `${poll.localDate}|${poll.sport}`;
    const ownPollsByKey = groupBy(
        gamePolls.filter(poll => poll.isGame && !poll.isDateChoice),
        keyOf
    );
    const cancellationsByDate = new Map(
        facts.cancellations
            .toSorted((left, right) => Number(left.isExplicit) - Number(right.isExplicit))
            .map(cancellation => [cancellation.localDate, cancellation])
    );
    const lineupsByKey = new Map<string, LineupFact>(
        facts.lineups
            .filter(lineup => !isCalledOff(lineup, cancellationsByDate.get(lineup.localDate)))
            .map(lineup => [`${lineup.localDate}|${lineupSport(lineup.localDate, ownPollsByKey)}`, lineup])
    );
    const keys = new Set([...ownPollsByKey.keys(), ...lineupsByKey.keys()]);
    const joined = gamePolls.flatMap(poll => {
        const isOwn = poll.isGame && !poll.isDateChoice;
        const found = [...poll.joinDates].map(date => `${date}|${poll.sport}`).find(candidate => keys.has(candidate));
        const key = found ?? (poll.isGame ? keyOf(poll) : null);

        return !isOwn && isDefined(key) ? [{ key, poll }] : [];
    });

    const pollsByKey = new Map([...ownPollsByKey].map(([key, polls]) => [key, [...polls]]));

    for (const { key, poll } of joined) {
        pollsByKey.set(key, [...(pollsByKey.get(key) ?? []), poll]);
    }

    const sessions = [...new Set([...keys, ...pollsByKey.keys()])].toSorted().map(key =>
        buildSession({
            key,
            polls: pollsByKey.get(key) ?? [],
            reservePolls: facts.polls.filter(poll => poll.isReserve && keyOf(poll) === key),
            lineup: lineupsByKey.get(key),
            cancellation: cancellationsByDate.get(key.split('|')[0] ?? ''),
            asOf
        })
    );

    return {
        sessions,
        prices: planPrices(facts.prices),
        fixtures: facts.fixtures,
        facts
    };
};
