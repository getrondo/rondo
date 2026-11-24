export const playedOutcomes = ['attended', 'late', 'left_early'] as const;

export interface PersonPoll {
    readonly pollId: string;
    readonly source: 'imported' | 'bot';
    readonly kind: 'participation' | 'reserve' | 'other';
    readonly answers: number;
    readonly choice: string;
    readonly sessionId: string | null;
    readonly postedOn: string;
}

export interface PersonGame {
    readonly sessionId: string;
    readonly localDate: string;
    readonly status: string;
    readonly polls: readonly PersonPoll[];
    readonly reserve: readonly PersonPoll[];
    readonly vote: 'yes' | 'no' | 'unreadable' | 'none';
    readonly squad: 'named' | 'not_named' | 'not_posted';
    readonly squadEntryId: string | null;
    readonly squadMessageId: number | null;
    readonly attendance: string | null;
    readonly attendanceSource: string | null;
}

export interface PeriodStatistics {
    readonly polls: {
        readonly unit: 'polls';
        readonly answered: number;
        readonly participationYes: number;
        readonly participationYesTwoAnswers: number;
        readonly participationYesMoreAnswers: number;
        readonly participationNo: number;
        readonly participationUnreadable: number;
        readonly reserveYes: number;
    };
    readonly games: {
        readonly unit: 'games';
        readonly withYesVote: number;
        readonly namedInSquad: number;
        readonly yesAndInSquad: number;
        readonly yesWithoutPostedSquad: number;
        readonly yesButNotInSquad: number;
        readonly inSquadWithoutVote: number;
        readonly inSquadDespiteNo: number;
        readonly attendanceRecorded: number;
    };
}
