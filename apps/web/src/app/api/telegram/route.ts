import { serverRuntime } from '@/server/server.runtime';
import { handleUpdate } from '@rondo/bot/handle-update';
import { verifyWebhookSecret, webhookSecretHeader } from '@rondo/telegram/webhook/verify-webhook-secret';
import * as Config from 'effect/Config';
import * as Effect from 'effect/Effect';
import { after } from 'next/server';

import type { Update } from 'grammy/types';

export const maxDuration = 60;

const accept = (request: Request) =>
    Effect.gen(function* () {
        const secret = yield* Config.Redacted('TELEGRAM_WEBHOOK_SECRET');
        yield* verifyWebhookSecret(request.headers.get(webhookSecretHeader), secret);
        const update = yield* Effect.tryPromise(async () => (await request.json()) as Update);
        after(async () => {
            await serverRuntime.runPromise(handleUpdate(update));
        });

        return new Response(null, { status: 200 });
    }).pipe(
        Effect.catchTag('InvalidWebhookSecretError', () => Effect.succeed(new Response(null, { status: 401 }))),
        Effect.tapCause(Effect.logError),
        Effect.catchCause(() => Effect.succeed(new Response(null, { status: 400 })))
    );

export async function POST(request: Request): Promise<Response> {
    return await serverRuntime.runPromise(accept(request));
}
