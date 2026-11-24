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
    readonly title: string;
    readonly confidence: number;
}

export interface LineupMember {
    readonly alias: string;
    readonly aliasNorm: string;
    readonly isGk: boolean;
    readonly isNewcomer: boolean;
    readonly isSelf: boolean;
}

export interface LineupTeam {
    readonly ordinal: number;
    readonly emoji: string;
    readonly members: readonly LineupMember[];
}

export interface LineupFact {
    readonly messageId: number;
    readonly postedAt: Date;
    readonly localDate: string;
    readonly localTime?: string;
    readonly venueKey?: string;
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
    readonly localDate: string;
    readonly reason: 'weather' | 'low_turnout' | 'venue' | 'holiday' | 'organizer' | 'other';
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

export interface LocationFact {
    readonly messageId: number;
    readonly localDate: string;
    readonly lat: number;
    readonly lng: number;
}

export interface ExtractedFacts {
    readonly polls: readonly PollFact[];
    readonly lineups: readonly LineupFact[];
    readonly prices: readonly PriceFact[];
    readonly cancellations: readonly CancellationFact[];
    readonly fixtures: readonly FixtureFact[];
    readonly authors: readonly AuthorFact[];
    readonly locations: readonly LocationFact[];
}
