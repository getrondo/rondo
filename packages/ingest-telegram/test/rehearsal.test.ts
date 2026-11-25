import { expect, it } from '@effect/vitest';
import { assertLocal } from '@rondo/core/testing/assert-local';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';

it.effect('rehearses only on a local database', () =>
    Effect.gen(function* () {
        const isAllowed = (url: string) => Effect.exit(assertLocal(url)).pipe(Effect.map(exit => Exit.isSuccess(exit)));
        const allowed = yield* Effect.all(['postgres://a:b@localhost:5432/x', 'postgres://a:b@127.0.0.1/x'].map(url => isAllowed(url)));
        const refused = yield* Effect.all(
            [
                'postgres://a:b@db.example.com/x',
                'postgres://a:b@localhost.example.com/x',
                'postgres://a:b@localhost/x?host=db.example.com',
                'not a url'
            ].map(url => isAllowed(url))
        );

        expect(allowed).toEqual([true, true]);
        expect(refused).toEqual([false, false, false, false]);
    })
);
