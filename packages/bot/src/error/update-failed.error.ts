import * as Schema from 'effect/Schema';

export class UpdateFailedError extends Schema.TaggedError<UpdateFailedError, { readonly brand: unique symbol }>()('UpdateFailedError', {
    updateId: Schema.Int
}) {}
