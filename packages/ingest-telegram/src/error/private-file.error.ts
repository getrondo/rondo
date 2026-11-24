import * as Schema from 'effect/Schema';

export class PrivateFileError extends Schema.TaggedError<PrivateFileError, { readonly brand: unique symbol }>()('PrivateFileError', {
    reason: Schema.String
}) {}
