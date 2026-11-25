import * as Schema from 'effect/Schema';

export class ErasePreviewError extends Schema.TaggedError<ErasePreviewError, { readonly brand: unique symbol }>()('ErasePreviewError', {
    counts: Schema.Record(Schema.String, Schema.Finite)
}) {}
