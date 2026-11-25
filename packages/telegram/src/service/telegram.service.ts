import { isError } from '@rnw-community/shared';
import * as Clock from 'effect/Clock';
import * as Config from 'effect/Config';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Redacted from 'effect/Redacted';
import { Api, GrammyError } from 'grammy';

import { TelegramApiError } from '../error/telegram-api.error';

const timeoutSeconds = 10;

export interface TelegramClient {
    readonly api: Api;
    readonly call: <Value>(method: string, request: (api: Api) => Promise<Value>) => Effect.Effect<Value, TelegramApiError>;
}

const failureOf = (method: string, error: unknown): TelegramApiError =>
    TelegramApiError.make({
        method,
        description: isError(error) ? error.message : String(error),
        isUncertain: !(error instanceof GrammyError) || error.error_code >= 500,
        retryAfterSeconds: error instanceof GrammyError && error.error_code === 429 ? (error.parameters.retry_after ?? null) : null
    });

const requestUntil = <Value>(request: Effect.Effect<Value, TelegramApiError>, deadline: number): Effect.Effect<Value, TelegramApiError> =>
    request.pipe(
        Effect.catchTag('TelegramApiError', error =>
            Effect.gen(function* () {
                const waitMs = (error.retryAfterSeconds ?? Infinity) * 1000;

                if ((yield* Clock.currentTimeMillis) + waitMs > deadline) {
                    return yield* error;
                }

                yield* Effect.sleep(waitMs);

                return yield* requestUntil(request, deadline);
            })
        )
    );

export const makeTelegramClient = (api: Api): TelegramClient => ({
    api,
    call: (method, request) => {
        const once = Effect.tryPromise({ try: async () => await request(api), catch: error => failureOf(method, error) });

        return Clock.currentTimeMillis.pipe(
            Effect.flatMap(startedAt => requestUntil(once, startedAt + timeoutSeconds * 1000)),
            Effect.withSpan(`Telegram.${method}`)
        );
    }
});

export class Telegram extends Context.Service<Telegram, TelegramClient>()('@rondo/telegram/Telegram') {
    static readonly layer = Layer.effect(
        Telegram,
        Effect.gen(function* () {
            const token = yield* Config.Redacted('TELEGRAM_BOT_TOKEN');

            return makeTelegramClient(new Api(Redacted.value(token), { timeoutSeconds }));
        })
    );
}
