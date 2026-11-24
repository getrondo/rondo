import { isError } from '@rnw-community/shared';
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

export const makeTelegramClient = (api: Api): TelegramClient => ({
    api,
    call: (method, request) =>
        Effect.tryPromise({
            try: async () => await request(api),
            catch: error =>
                TelegramApiError.make({
                    method,
                    description: isError(error) ? error.message : String(error),
                    isUncertain: !(error instanceof GrammyError) || error.error_code >= 500
                })
        }).pipe(Effect.withSpan(`Telegram.${method}`))
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
