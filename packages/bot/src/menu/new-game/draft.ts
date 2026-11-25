import * as Schema from 'effect/Schema';

import type { PastGame, PlannedGame } from '@rondo/core/menu/past-game.interface';

const views = ['main', 'day', 'place', 'venues', 'venue_name', 'map', 'address', 'time', 'size', 'note', 'dest'] as const;

const gameFields = {
    localDate: Schema.NullOr(Schema.String),
    localTime: Schema.NullOr(Schema.String),
    venueId: Schema.NullOr(Schema.String),
    fields: Schema.NullOr(Schema.Int),
    places: Schema.NullOr(Schema.Int),
    sized: Schema.Boolean,
    custom: Schema.Boolean,
    note: Schema.NullOr(Schema.String),
    sessionId: Schema.NullOr(Schema.String)
};

const RestoreSchema = Schema.Struct(gameFields);

const TargetSchema = Schema.Struct({ id: Schema.String, title: Schema.String, topicId: Schema.NullOr(Schema.Int) });

export const DoneSchema = Schema.Struct({
    flow: Schema.Literal('done'),
    sessionId: Schema.String,
    created: Schema.Boolean,
    self: Schema.Boolean,
    revision: Schema.String
});

export const DraftSchema = Schema.Struct({
    flow: Schema.Literal('new'),
    view: Schema.Literals(views),
    manual: Schema.Boolean,
    page: Schema.Int,
    ...gameFields,
    summary: Schema.NullOr(Schema.String),
    notice: Schema.NullOr(Schema.String),
    audience: Schema.Array(Schema.String),
    uncertain: Schema.Boolean,
    warning: Schema.NullOr(Schema.String),
    targets: Schema.Array(TargetSchema),
    restore: Schema.NullOr(RestoreSchema)
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
    readonly chats: readonly { readonly id: string; readonly title: string; readonly topicId: number | null }[];
    readonly selfChatId: string;
    readonly lastChatId: string | null;
    readonly typingHint: boolean;
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
    notice: null,
    audience: [],
    custom: false,
    uncertain: false,
    warning: null,
    targets: [],
    restore: null
};
