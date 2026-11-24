import * as Schema from 'effect/Schema';

export class DuplicateVenueNameError extends Schema.TaggedError<DuplicateVenueNameError, { readonly brand: unique symbol }>()(
    'DuplicateVenueNameError',
    {
        venueName: Schema.String,
        keys: Schema.Array(Schema.String)
    }
) {}
