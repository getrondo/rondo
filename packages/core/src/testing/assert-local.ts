import { isDefined } from '@rnw-community/shared';
import * as Effect from 'effect/Effect';

import { NotLocalDatabaseError } from '../error/not-local-database.error';

const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

export const assertLocal = (databaseUrl: string): Effect.Effect<void, NotLocalDatabaseError> => {
    const url = URL.canParse(databaseUrl) ? new URL(databaseUrl) : null;
    const isOverridden = url?.searchParams.has('host') === true || url?.searchParams.has('hostaddr') === true;

    return isDefined(url) && localHosts.has(url.hostname) && !isOverridden
        ? Effect.void
        : Effect.fail(NotLocalDatabaseError.make({ reason: 'the rehearsal runs only against a database on localhost' }));
};
