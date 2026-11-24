import * as Effect from 'effect/Effect';

import { chunks } from './chunks.util';

export const insertMany = <Row, Failure, Requirements>(
    rows: readonly Row[],
    insert: (batch: Row[]) => Effect.Effect<unknown, Failure, Requirements>
) =>
    Effect.all(
        chunks(rows).map(batch => insert(batch)),
        { discard: true }
    );
