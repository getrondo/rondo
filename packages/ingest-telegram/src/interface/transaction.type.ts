import type { Database } from '@rondo/db/service/db.service';

export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
