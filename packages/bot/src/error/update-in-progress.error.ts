import * as Schema from 'effect/Schema';

export class UpdateInProgressError extends Schema.TaggedError<UpdateInProgressError, { readonly brand: unique symbol }>()(
    'UpdateInProgressError',
    { updateId: Schema.Int }
) {}
