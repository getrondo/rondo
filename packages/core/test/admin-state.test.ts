import { expect, layer } from '@effect/vitest';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import {
    clearAdminState,
    consumeAdminState,
    loadAdminState,
    restoreAdminState,
    saveAdminState,
    takeAwaiting
} from '../src/menu/admin-state.repository';
import { recordedTelegramDbLayer } from '../src/testing/recorded-telegram.layer';
import { seedCommunity, seedConfig } from '../src/testing/seed-community';

const now = new Date('2026-11-25T08:00:00Z');
const later = new Date('2026-11-25T08:31:00Z');

layer(recordedTelegramDbLayer, { timeout: 60_000 })('admin state', it => {
    it.effect('keeps one row per admin and hands typed input to exactly one reader', () =>
        Effect.gen(function* () {
            const { communityId } = yield* seedCommunity(seedConfig('state-fc'));
            yield* saveAdminState({ tgUserId: 1n, communityId, messageId: 5, awaiting: 'time', draft: { step: 'time' }, now });
            const saved = yield* saveAdminState({
                tgUserId: 1n,
                communityId,
                messageId: 6,
                awaiting: 'time',
                draft: { step: 'size' },
                now
            });
            const [first, second] = yield* Effect.all([takeAwaiting(1n, now), takeAwaiting(1n, now)], { concurrency: 2 });
            const loaded = yield* loadAdminState(1n, now);

            expect(saved.revision).toBe(2);
            expect([first, second].filter(entry => Option.isSome(entry))).toHaveLength(1);
            expect(Option.getOrNull(first)?.awaiting ?? Option.getOrNull(second)?.awaiting).toBe('time');
            expect(Option.getOrNull(loaded)).toMatchObject({ messageId: 6, awaiting: null, draft: { step: 'size' } });
        })
    );

    it.effect('lets an expired row go to the assistant and consumes a draft once per revision', () =>
        Effect.gen(function* () {
            const { communityId } = yield* seedCommunity(seedConfig('state-two-fc'));
            const saved = yield* saveAdminState({ tgUserId: 2n, communityId, messageId: 1, awaiting: 'note', draft: {}, now });
            const expired = yield* takeAwaiting(2n, later);
            const stale = yield* consumeAdminState(2n, saved.revision + 1, now);
            const [won, lost] = yield* Effect.all(
                [consumeAdminState(2n, saved.revision, now), consumeAdminState(2n, saved.revision, now)],
                {
                    concurrency: 2
                }
            );
            yield* restoreAdminState(Option.getOrThrow(won), now);
            const restored = yield* loadAdminState(2n, now);
            yield* clearAdminState(2n);
            const cleared = yield* loadAdminState(2n, now);

            expect(Option.isNone(expired)).toBe(true);
            expect(Option.isNone(stale)).toBe(true);
            expect(Option.isSome(won)).toBe(true);
            expect(Option.isNone(lost)).toBe(true);
            expect(Option.getOrNull(restored)).toMatchObject({ awaiting: null, revision: saved.revision + 1 });
            expect(Option.isNone(cleared)).toBe(true);
        })
    );
});
