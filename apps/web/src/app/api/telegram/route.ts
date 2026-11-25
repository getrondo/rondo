import { serverRuntime } from '@/server/server.runtime';
import { handleUpdate } from '@rondo/bot/handle-update';
import { verifyWebhookSecret, webhookSecretHeader } from '@rondo/telegram/webhook/verify-webhook-secret';
import * as Config from 'effect/Config';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import { after } from 'next/server';

import type { Update } from 'grammy/types';

export const maxDuration = 60;

const accept = (request: Request) =>
    Effect.gen(function* () {
        const secret = yield* Config.Redacted('TELEGRAM_WEBHOOK_SECRET');
        yield* verifyWebhookSecret(request.headers.get(webhookSecretHeader), secret);
        const update = yield* Effect.tryPromise(async () => (await request.json()) as Update);
        // The model is slow, so the assistant and venue proposals run after the reply. Commands, menu taps and typed menu input run first: a failure answers 500 and Telegram retries in order.
        const followUp = yield* handleUpdate(update);

        if (Option.isSome(followUp)) {
            after(async () => {
                await serverRuntime.runPromise(followUp.value);
            });
        }

        return new Response(null, { status: 200 });
    }).pipe(
        Effect.catchTag('InvalidWebhookSecretError', () => Effect.succeed(new Response(null, { status: 401 }))),
        Effect.tapCause(Effect.logError),
        Effect.catchCause(() => Effect.succeed(new Response(null, { status: 500 })))
    );

export async function POST(request: Request): Promise<Response> {
    return await serverRuntime.runPromise(accept(request));
}
