import { timingSafeEqual } from 'node:crypto';

import { isDefined } from '@rnw-community/shared';
import * as Effect from 'effect/Effect';
import * as Redacted from 'effect/Redacted';

import { InvalidWebhookSecretError } from '../error/invalid-webhook-secret.error';

export const webhookSecretHeader = 'x-telegram-bot-api-secret-token';

const sameSecret = (received: string, expected: string): boolean => {
    const left = Buffer.from(received);
    const right = Buffer.from(expected);

    return left.length === right.length && timingSafeEqual(left, right);
};

export const verifyWebhookSecret = (received: string | null, expected: Redacted.Redacted): Effect.Effect<void, InvalidWebhookSecretError> =>
    isDefined(received) && sameSecret(received, Redacted.value(expected)) ? Effect.void : Effect.fail(InvalidWebhookSecretError.make({}));
