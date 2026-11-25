import { describe, expect, it } from '@effect/vitest';
import { isDefined } from '@rnw-community/shared';
import * as ConfigProvider from 'effect/ConfigProvider';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Fiber from 'effect/Fiber';
import * as Layer from 'effect/Layer';
import * as Redacted from 'effect/Redacted';
import * as TestClock from 'effect/testing/TestClock';

import { escapeHtml, mentionHtml } from '../src/format/html';
import { Telegram } from '../src/service/telegram.service';
import { makeRecorder, recordingTelegramLayer, refusal } from '../src/testing/recording-telegram.layer';
import { verifyWebhookSecret } from '../src/webhook/verify-webhook-secret';

describe('telegram html formatting', () => {
    it('escapes markup characters', () => {
        expect(escapeHtml('<b>"A" & B</b>')).toBe('&lt;b&gt;&quot;A&quot; &amp; B&lt;/b&gt;');
    });

    it('builds an escaped user mention', () => {
        expect(mentionHtml(42n, 'A<B')).toBe('<a href="tg://user?id=42">A&lt;B</a>');
    });
});

describe('webhook secret verification', () => {
    const expected = Redacted.make('s3cret');

    it.effect('accepts the matching secret', () =>
        Effect.gen(function* () {
            const exit = yield* Effect.exit(verifyWebhookSecret('s3cret', expected));

            expect(Exit.isSuccess(exit)).toBe(true);
        })
    );

    it.effect('rejects a missing or different secret', () =>
        Effect.gen(function* () {
            const missing = yield* Effect.exit(verifyWebhookSecret(null, expected));
            const different = yield* Effect.exit(verifyWebhookSecret('other-1', expected));

            expect(Exit.isFailure(missing)).toBe(true);
            expect(Exit.isFailure(different)).toBe(true);
        })
    );
});

describe('telegram failures', () => {
    const failWith = (error: Error) =>
        Effect.gen(function* () {
            const telegram = yield* Telegram;

            return yield* Effect.flip(telegram.call('sendPoll', api => api.sendPoll(1, '?', ['+', '-'])));
        }).pipe(Effect.provide(recordingTelegramLayer({ ...makeRecorder(), failures: new Map([['sendPoll', error]]) })));

    it.effect('knows a refusal from an unknown result', () =>
        Effect.gen(function* () {
            const refused = yield* failWith(refusal('sendPoll', 'Bad Request: not enough rights'));
            const broken = yield* failWith(refusal('sendPoll', 'Internal Server Error', 500));
            const silent = yield* failWith(new Error("Request to 'sendPoll' timed out after 10 seconds"));

            expect(refused.isUncertain).toBe(false);
            expect(refused.description).toContain('not enough rights');
            expect(broken.isUncertain).toBe(true);
            expect(silent.isUncertain).toBe(true);
        })
    );

    it.effect('gives up on a request after 10 seconds', () =>
        Effect.gen(function* () {
            const telegram = yield* Telegram;

            expect(telegram.api.options?.timeoutSeconds).toBe(10);
        }).pipe(
            Effect.provide(
                Telegram.layer.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ TELEGRAM_BOT_TOKEN: '0:test' }))))
            )
        )
    );
});

describe('telegram rate limit', () => {
    const sendAfter = (failures: Error[], wait: '0 seconds' | '3 seconds' | '10 seconds') => {
        const recorder = makeRecorder(() => {
            const failure = failures.shift();

            if (isDefined(failure)) {
                throw failure;
            }

            return true;
        });
        const attempts = failures.length;

        return Effect.gen(function* () {
            const telegram = yield* Telegram;
            const fiber = yield* Effect.forkChild(Effect.exit(telegram.call('sendMessage', api => api.sendMessage(1, 'hi'))));
            yield* TestClock.adjust(wait);
            const exit = yield* Fiber.join(fiber);

            return { isSent: Exit.isSuccess(exit), tries: attempts - failures.length };
        }).pipe(Effect.provide(recordingTelegramLayer(recorder)));
    };
    const limited = (seconds?: number) => refusal('sendMessage', 'Too Many Requests', 429, seconds);

    it.effect('waits as long as Telegram asks and sends again', () =>
        Effect.gen(function* () {
            expect((yield* sendAfter([limited(3)], '3 seconds')).isSent).toBe(true);
        })
    );

    it.effect('does not wait past 10 seconds in total, nor without a wait time', () =>
        Effect.gen(function* () {
            expect(yield* sendAfter([limited(11)], '0 seconds')).toEqual({ isSent: false, tries: 1 });
            expect(yield* sendAfter([limited()], '0 seconds')).toEqual({ isSent: false, tries: 1 });
            expect(yield* sendAfter([limited(6), limited(6)], '10 seconds')).toEqual({ isSent: false, tries: 2 });
        })
    );

    it.effect('never sends again after another refusal or an unknown result', () =>
        Effect.gen(function* () {
            for (const failure of [new Error('socket hang up'), refusal('sendMessage', 'x', 502, 3), refusal('sendMessage', 'x', 400, 3)]) {
                expect(yield* sendAfter([failure, failure], '10 seconds')).toEqual({ isSent: false, tries: 1 });
            }
        })
    );
});
