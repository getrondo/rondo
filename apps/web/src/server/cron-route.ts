import * as Effect from 'effect/Effect';

import { hasBearerSecret } from './bearer-secret';
import { serverRuntime } from './server.runtime';

import type { Access } from '@rondo/core/access/admin-access';
import type { Db } from '@rondo/db/service/db.service';
import type { Telegram } from '@rondo/telegram/service/telegram.service';

export const cronRoute =
    <Value, Failure>(name: string, job: (now: Date) => Effect.Effect<Value, Failure, Db | Telegram | Access>) =>
    async (request: Request): Promise<Response> => {
        if (!hasBearerSecret(request.headers.get('authorization'), process.env.CRON_SECRET)) {
            return new Response(null, { status: 401 });
        }

        const result = await serverRuntime.runPromise(job(new Date()).pipe(Effect.withSpan(`Cron.${name}`)));

        return Response.json(result);
    };
