import * as NodeRuntime from '@effect/platform-node/NodeRuntime';
import * as Config from 'effect/Config';
import * as Effect from 'effect/Effect';
import * as Redacted from 'effect/Redacted';

import { Telegram } from '../service/telegram.service';

const commands = {
    uk: [
        { command: 'start', description: 'Що вміє бот' },
        { command: 'reset', description: 'Почати розмову заново' }
    ],
    ru: [
        { command: 'start', description: 'Что умеет бот' },
        { command: 'reset', description: 'Начать разговор заново' }
    ]
} as const;

const program = Effect.gen(function* () {
    const telegram = yield* Telegram;
    const url = yield* Config.String('RONDO_WEBHOOK_URL');
    const secret = yield* Config.Redacted('TELEGRAM_WEBHOOK_SECRET');

    yield* telegram.call('setWebhook', api =>
        api.setWebhook(url, {
            secret_token: Redacted.value(secret),
            allowed_updates: ['message', 'poll_answer', 'callback_query', 'chat_member'],
            max_connections: 1,
            drop_pending_updates: false
        })
    );
    yield* telegram.call('setMyCommands', api => api.setMyCommands([...commands.uk], { scope: { type: 'all_private_chats' } }));
    yield* telegram.call('setMyCommands', api =>
        api.setMyCommands([...commands.ru], { scope: { type: 'all_private_chats' }, language_code: 'ru' })
    );
    const info = yield* telegram.call('getWebhookInfo', api => api.getWebhookInfo());
    yield* Effect.logInfo(`webhook set: ${info.url} pending=${info.pending_update_count}`);
});

NodeRuntime.runMain(program.pipe(Effect.provide(Telegram.layer)));
