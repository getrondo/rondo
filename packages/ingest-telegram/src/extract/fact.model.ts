export type Sport = 'football' | 'futsal' | 'basketball' | 'volleyball' | 'beach_volleyball' | 'table_tennis' | 'boxing' | 'other';

export interface PollFact {
    readonly messageId: number;
    readonly postedAt: Date;
    readonly localDate: string;
    readonly localTime?: string;
    readonly venueKey?: string;
    readonly sport: Sport;
    readonly capacityMax?: number;
    readonly fieldsPlanned?: number;
    readonly format?: string;
    readonly isReserve: boolean;
    readonly isChoice: boolean;
    readonly isGame: boolean;
    readonly isDateChoice: boolean;
    readonly joinDates: readonly string[];
    readonly yesVoters: number;
    readonly title: string;
    readonly confidence: number;
}

interface GuestDescription {
    readonly host?: string;
    readonly count: number;
}

export interface LineupMember {
    readonly raw: string;
    readonly userId?: number;
    readonly handle?: string;
    readonly alias: string;
    readonly aliasNorm: string;
    readonly isGk: boolean;
    readonly isNewcomer: boolean;
    readonly isSelf: boolean;
    readonly guests: number;
    readonly guest?: GuestDescription;
}

export interface LineupTeam {
    readonly ordinal: number;
    readonly emoji: string;
    readonly members: readonly LineupMember[];
}

export interface LineupFact {
    readonly messageId: number;
    readonly authorId?: number;
    readonly postedAt: Date;
    readonly postedDate: string;
    readonly localDate: string;
    readonly localTime?: string;
    readonly venueKey?: string;
    readonly title: string;
    readonly teams: readonly LineupTeam[];
    readonly priceCents?: number;
}

export interface PriceFact {
    readonly messageId: number;
    readonly localDate: string;
    readonly amountCents: number;
    readonly venueKey?: string;
    readonly appliesTo: 'field' | 'gk';
}

export interface CancellationFact {
    readonly messageId: number;
    readonly postedAt: Date;
    readonly localDate: string;
    readonly reason: 'weather' | 'low_turnout' | 'venue' | 'holiday' | 'organizer' | 'other';
    readonly isExplicit: boolean;
}

export interface FixtureFact {
    readonly messageId: number;
    readonly localDate: string;
    readonly squadName: string;
    readonly competition?: string;
    readonly season: string;
    readonly opponent: string;
    readonly goalsFor: number;
    readonly goalsAgainst: number;
    readonly home: boolean;
}

export interface AuthorFact {
    readonly displayName: string;
    readonly messageCount: number;
    readonly firstSeenAt: Date;
    readonly lastSeenAt: Date;
}

export interface AccountFact {
    readonly userId: number;
    readonly displayName: string;
    readonly firstSeenAt: Date;
    readonly lastSeenAt: Date;
}

export interface GuestRequestFact {
    readonly messageId: number;
    readonly userId: number;
    readonly replyTo?: number;
    readonly guests: number;
}

export interface PollPostFact {
    readonly messageId: number;
    readonly postedAt: Date;
    readonly answers: number;
    readonly isReserve: boolean;
}

export interface ExtractedFacts {
    readonly polls: readonly PollFact[];
    readonly lineups: readonly LineupFact[];
    readonly prices: readonly PriceFact[];
    readonly cancellations: readonly CancellationFact[];
    readonly fixtures: readonly FixtureFact[];
    readonly authors: readonly AuthorFact[];
    readonly accounts: readonly AccountFact[];
    readonly guestRequests: readonly GuestRequestFact[];
    readonly pollPosts: readonly PollPostFact[];
}
