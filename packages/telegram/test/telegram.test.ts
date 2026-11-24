import { describe, expect, it } from '@effect/vitest';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Redacted from 'effect/Redacted';

import { escapeHtml, mentionHtml } from '../src/format/html';
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
