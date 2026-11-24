import { hasBearerSecret } from '@/server/bearer-secret';
import { serverRuntime } from '@/server/server.runtime';
import { runMaintenance } from '@rondo/bot/jobs/maintenance.job';
import * as Effect from 'effect/Effect';

export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
    if (!hasBearerSecret(request.headers.get('authorization'), process.env.CRON_SECRET)) {
        return new Response(null, { status: 401 });
    }

    const result = await serverRuntime.runPromise(runMaintenance(new Date()).pipe(Effect.withSpan('Cron.maintenance')));

    return Response.json(result);
}
