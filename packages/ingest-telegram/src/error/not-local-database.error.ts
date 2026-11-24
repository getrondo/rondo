import * as Schema from 'effect/Schema';

export class NotLocalDatabaseError extends Schema.TaggedError<NotLocalDatabaseError, { readonly brand: unique symbol }>()(
    'NotLocalDatabaseError',
    {
        reason: Schema.String
    }
) {}
