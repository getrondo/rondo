type SessionStatus = 'draft' | 'open' | 'full' | 'locked' | 'played' | 'cancelled' | 'moved';

export type CancelReason = 'weather' | 'low_turnout' | 'venue' | 'holiday' | 'organizer' | 'other';

export interface SessionView {
    readonly id: string;
    readonly communityId: string;
    readonly sport: string;
    readonly localDate: string;
    readonly localTime: string;
    readonly startsAt: Date;
    readonly status: SessionStatus;
    readonly venueId: string | null;
    readonly venueName: string | null;
    readonly venueShortName: string | null;
    readonly venueStation: string | null;
    readonly fieldsPlanned: number | null;
    readonly capacityMax: number | null;
    readonly gkSlots: number;
    readonly title: string | null;
    readonly cancelReason: CancelReason | null;
}

export interface SessionPatch {
    readonly localDate?: string;
    readonly localTime?: string;
    readonly venueId?: string | null;
    readonly capacityMax?: number | null;
    readonly fieldsPlanned?: number | null;
}
