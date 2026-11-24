import * as Schema from 'effect/Schema';

export class ActionFailedError extends Schema.TaggedError<ActionFailedError, { readonly brand: unique symbol }>()('ActionFailedError', {
    reason: Schema.String
}) {}
