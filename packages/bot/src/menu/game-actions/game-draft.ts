import { isNotEmptyString } from '@rnw-community/shared';
import * as Schema from 'effect/Schema';

import type { Action } from '@rondo/core/actions/action.model';

export const GameDraftSchema = Schema.Struct({
    flow: Schema.Literal('game'),
    view: Schema.Literals(['time', 'day', 'size', 'place', 'venues', 'venue_name', 'cancel', 'teams', 'confirm']),
    page: Schema.Int,
    sessionId: Schema.String,
    action: Schema.NullOr(Schema.Unknown),
    summary: Schema.NullOr(Schema.String)
});

export type GameDraft = typeof GameDraftSchema.Type;

export const sessionOf = (action: Action): string => ('sessionId' in action && isNotEmptyString(action.sessionId) ? action.sessionId : '');

export type GameListView = Exclude<GameDraft['view'], 'confirm'>;

export const listViews: Readonly<Record<string, GameListView>> = {
    t: 'time',
    dd: 'day',
    v: 'place',
    vl: 'venues',
    vn: 'venue_name',
    z: 'size',
    x: 'cancel',
    k: 'teams'
};

export const awaitingOfView: Partial<Record<GameDraft['view'], string>> = {
    time: 'time',
    day: 'date',
    size: 'size',
    venue_name: 'venue_name'
};
