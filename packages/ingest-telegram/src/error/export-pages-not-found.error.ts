import * as Schema from 'effect/Schema';

export class ExportPagesNotFoundError extends Schema.TaggedError<ExportPagesNotFoundError, { readonly brand: unique symbol }>()(
    'ExportPagesNotFoundError',
    {
        exportDir: Schema.String
    }
) {}
