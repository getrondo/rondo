import * as Schema from 'effect/Schema';

export class TooManyRemovedGamesError extends Schema.TaggedError<TooManyRemovedGamesError, { readonly brand: unique symbol }>()(
    'TooManyRemovedGamesError',
    {
        sessionIds: Schema.Array(Schema.String),
        imported: Schema.Int
    }
) {}
