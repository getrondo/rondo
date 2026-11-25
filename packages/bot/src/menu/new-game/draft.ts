import * as Schema from 'effect/Schema';

import type { PastGame, PlannedGame } from '@rondo/core/menu/past-game.interface';

const views = ['main', 'day', 'place', 'venues', 'venue_name', 'map', 'address', 'time', 'size', 'note'] as const;

export const DraftSchema = Schema.Struct({
    flow: Schema.Literal('new'),
    view: Schema.Literals(views),
    manual: Schema.Boolean,
    page: Schema.Int,
    localDate: Schema.NullOr(Schema.String),
    localTime: Schema.NullOr(Schema.String),
    venueId: Schema.NullOr(Schema.String),
    fields: Schema.NullOr(Schema.Int),
    places: Schema.NullOr(Schema.Int),
    sized: Schema.Boolean,
    note: Schema.NullOr(Schema.String),
    sessionId: Schema.NullOr(Schema.String),
    summary: Schema.NullOr(Schema.String),
    notice: Schema.NullOr(Schema.String)
});

export type Draft = typeof DraftSchema.Type;

export type DraftView = Draft['view'];

export interface VenueChoice {
    readonly id: string;
    readonly name: string;
    readonly label: string;
    readonly located: boolean;
}

export interface NewGameData {
    readonly history: readonly PastGame[];
    readonly planned: readonly PlannedGame[];
    readonly venues: readonly VenueChoice[];
    readonly today: string;
    readonly nowTime: string;
    readonly hasGroup: boolean;
}

export interface TypedInput {
    readonly text: string | null;
    readonly location: { readonly lat: number; readonly lng: number } | null;
}

export const emptyDraft: Draft = {
    flow: 'new',
    view: 'main',
    manual: false,
    page: 0,
    localDate: null,
    localTime: null,
    venueId: null,
    fields: null,
    places: null,
    sized: false,
    note: null,
    sessionId: null,
    summary: null,
    notice: null
};
