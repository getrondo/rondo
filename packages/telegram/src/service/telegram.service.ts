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
// A request started with less time left would often end with an unknown result
const leastAttemptMs = 2000;
const onceOnly = new Set(['pinChatMessage', 'answerCallbackQuery', 'sendChatAction', 'setMyCommands']);

export interface CallOptions {
    readonly maxWaitSeconds: number;
}

export interface TelegramClient {
    readonly botId: number;
    readonly call: <Value>(
        method: string,
        request: (api: Api) => Promise<Value>,
        options?: CallOptions
    ) => Effect.Effect<Value, TelegramApiError>;
}

export const maxWaitInTransaction: CallOptions = { maxWaitSeconds: 3 };

const failureOf = (method: string, error: unknown): TelegramApiError =>
    TelegramApiError.make({
        method,
        description: isError(error) ? error.message : String(error),
        isUncertain: !(error instanceof GrammyError) || error.error_code >= 500,
        retryAfterSeconds: error instanceof GrammyError && error.error_code === 429 ? (error.parameters.retry_after ?? null) : null
    });

const requestUntil = <Value>(
    request: Effect.Effect<Value, TelegramApiError>,
    deadline: number,
    waitLeftMs: number
): Effect.Effect<Value, TelegramApiError> =>
    request.pipe(
        Effect.catchTag('TelegramApiError', error =>
            Effect.gen(function* () {
                const waitMs = (error.retryAfterSeconds ?? Infinity) * 1000;

                if (waitMs > waitLeftMs || (yield* Clock.currentTimeMillis) + waitMs + leastAttemptMs > deadline) {
                    return yield* error;
                }

                yield* Effect.sleep(waitMs);

                return yield* requestUntil(request, deadline, waitLeftMs - waitMs);
            })
        )
    );

export const makeTelegramClient = (api: Api): TelegramClient => ({
    botId: Number(api.token.split(':')[0]),
    call: (method, request, options) => {
        const once = Effect.tryPromise({ try: async () => await request(api), catch: error => failureOf(method, error) });
        const maxWaitMs = onceOnly.has(method) ? 0 : (options?.maxWaitSeconds ?? timeoutSeconds) * 1000;
        const timedOut = TelegramApiError.make({
            method,
            description: `no answer in ${timeoutSeconds} seconds`,
            isUncertain: true,
            retryAfterSeconds: null
        });

        return Clock.currentTimeMillis.pipe(
            Effect.flatMap(startedAt => requestUntil(once, startedAt + timeoutSeconds * 1000, maxWaitMs)),
            Effect.timeoutOrElse({ duration: timeoutSeconds * 1000, orElse: () => Effect.fail(timedOut) }),
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
