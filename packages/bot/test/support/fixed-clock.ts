import * as Clock from 'effect/Clock';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';

let current = Date.parse('2026-11-26T09:00:00Z');

export const setNow = (millis: number) =>
    Effect.sync(() => {
        current = millis;
    });

export const advanceNow = (millis: number) =>
    Effect.sync(() => {
        current += millis;
    });

export const fixedClockLayer = Layer.effect(
    Clock.Clock,
    Effect.gen(function* () {
        const real = yield* Clock.Clock;

        return {
            currentTimeMillisUnsafe: () => current,
            currentTimeMillis: Effect.sync(() => current),
            currentTimeNanosUnsafe: () => BigInt(current) * 1_000_000n,
            currentTimeNanos: Effect.sync(() => BigInt(current) * 1_000_000n),
            monotonicTimeNanosUnsafe: () => real.monotonicTimeNanosUnsafe(),
            monotonicTimeNanos: real.monotonicTimeNanos,
            sleep: duration => real.sleep(duration)
        } satisfies Clock.Clock;
    })
);
