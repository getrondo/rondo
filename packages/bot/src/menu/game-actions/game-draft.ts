import { isNotEmptyString } from '@rnw-community/shared';
import * as Schema from 'effect/Schema';

import type { Action } from '@rondo/core/actions/action.model';

export const GameDraftSchema = Schema.Struct({
    flow: Schema.Literal('game'),
    view: Schema.Literals(['time', 'size', 'confirm']),
    sessionId: Schema.String,
    action: Schema.NullOr(Schema.Unknown),
    summary: Schema.NullOr(Schema.String)
});

export type GameDraft = typeof GameDraftSchema.Type;

export const sessionOf = (action: Action): string => ('sessionId' in action && isNotEmptyString(action.sessionId) ? action.sessionId : '');
