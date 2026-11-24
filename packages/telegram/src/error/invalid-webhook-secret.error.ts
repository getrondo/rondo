import * as Schema from 'effect/Schema';

export class InvalidWebhookSecretError extends Schema.TaggedError<InvalidWebhookSecretError, { readonly brand: unique symbol }>()(
    'InvalidWebhookSecretError',
    {}
) {}
