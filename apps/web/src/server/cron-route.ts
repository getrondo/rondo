import * as Config from 'effect/Config';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';

import { hasBearerSecret } from './bearer-secret';
import { serverRuntime } from './server.runtime';

import type { Access } from '@rondo/core/access/admin-access';
import type { Db } from '@rondo/db/service/db.service';
import type { Telegram } from '@rondo/telegram/service/telegram.service';

export const cronRoute =
    <Value, Failure>(name: string, job: (now: Date) => Effect.Effect<Value, Failure, Db | Telegram | Access>) =>
    async (request: Request): Promise<Response> => {
        const run = Effect.gen(function* () {
            const secret = yield* Config.option(Config.Redacted('CRON_SECRET'));

            if (!hasBearerSecret(request.headers.get('authorization'), secret)) {
                return new Response(null, { status: 401 });
            }

            const now = yield* DateTime.nowAsDate;
            const result = yield* job(now).pipe(Effect.withSpan(`Cron.${name}`));

            return Response.json(result);
        });

        return await serverRuntime.runPromise(run);
    };
