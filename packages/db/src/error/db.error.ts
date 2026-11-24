import * as Schema from 'effect/Schema';

export class DbError extends Schema.TaggedError<DbError, { readonly brand: unique symbol }>()('DbError', { cause: Schema.Defect() }) {}
