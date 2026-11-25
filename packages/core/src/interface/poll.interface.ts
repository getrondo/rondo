import type { SessionView } from '../sessions/session.model';

export type PollGame = Pick<
    SessionView,
    'localDate' | 'localTime' | 'venueName' | 'venueShortName' | 'venueStation' | 'fieldsPlanned' | 'capacityMax'
> &
    Partial<Pick<SessionView, 'venueAddress' | 'venueLat' | 'venueLng' | 'venueMapUrl'>>;

export interface PlaceBlock {
    readonly name: string;
    readonly address: string | null;
    readonly station: string | null;
    readonly mapUrl: string | null;
}

export interface PollRoute {
    readonly label: string;
    readonly url: string;
}

export interface PollText {
    readonly question: string;
    readonly answers: readonly string[];
    readonly place: PlaceBlock | null;
    readonly route: PollRoute | null;
}
