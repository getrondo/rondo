import type { SessionView } from '../sessions/session.model';

export type PollGame = Pick<
    SessionView,
    'localDate' | 'localTime' | 'venueName' | 'venueShortName' | 'venueStation' | 'fieldsPlanned' | 'capacityMax'
>;

export interface PollText {
    readonly question: string;
    readonly answers: readonly string[];
}
