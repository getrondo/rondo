import * as Schema from 'effect/Schema';

export class TelegramApiError extends Schema.TaggedError<TelegramApiError, { readonly brand: unique symbol }>()('TelegramApiError', {
    method: Schema.String,
    description: Schema.String,
    isUncertain: Schema.Boolean
}) {}
