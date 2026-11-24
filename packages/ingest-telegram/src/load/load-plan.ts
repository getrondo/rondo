import { Db } from '@rondo/db/service/db.service';
import * as Effect from 'effect/Effect';

import { purgePreviousImport, upsertCommunity, upsertReference } from './load-community';
import { insertMoneyAndLeague } from './load-league';
import { insertPeople } from './load-people';
import { recordProvenance } from './load-provenance';
import { insertSessions } from './load-sessions';

import type { CommunityConfig } from '../config/community-config';
import type { ImportPlan } from '../extract/assemble-plan';

export const loadPlan = Effect.fn('IngestTelegram.loadPlan')(function* (config: CommunityConfig, plan: ImportPlan, fileSha256: string) {
    const db = yield* Db;

    return yield* db.transaction(transaction =>
        Effect.gen(function* () {
            const communityId = yield* upsertCommunity(transaction, config);
            const context = { transaction, communityId, config, plan };
            yield* purgePreviousImport(transaction, communityId);
            const reference = yield* upsertReference(context);
            const personIdByAlias = yield* insertPeople(context);
            const sessions = yield* insertSessions(context, reference, personIdByAlias);
            const fixtures = yield* insertMoneyAndLeague(context, reference.venueIdByKey);
            const stats = {
                sessions: plan.sessions.length,
                teams: sessions.teams,
                attendances: sessions.members,
                aliases: plan.aliases.length,
                authors: plan.facts.authors.length,
                priceRules: plan.prices.length,
                fixtures
            };
            yield* recordProvenance(context, { fileSha256, sessionIds: sessions.sessionIds, stats });

            return stats;
        })
    );
});
