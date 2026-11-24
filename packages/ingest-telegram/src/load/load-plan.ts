import { Db } from '@rondo/db/service/db.service';
import * as Effect from 'effect/Effect';

import { countOccurrences } from '../identity/count-occurrences';
import { loadDirectory } from '../identity/load-directory';
import { refreshNames } from '../identity/refresh-names';
import { linkByVotes, releaseVoteLinks } from '../identity/vote-links';
import { alignGuests } from '../roster/align-guests';

import { loadAccounts } from './load-accounts';
import { assertUniqueVenueNames, purgePreviousImport, upsertCommunity, upsertReference } from './load-community';
import { insertMoneyAndLeague } from './load-league';
import { insertPeople } from './load-people';
import { recordProvenance } from './load-provenance';
import { loadSessions } from './load-sessions';
import { insertVotes } from './load-votes';
import { removeUnusedNicknames } from './remove-unused-nicknames';

import type { CommunityConfig } from '../config/community-config';
import type { ImportPlan } from '../extract/assemble-plan';
import type { TelegramSnapshot } from '../model/telegram-snapshot.model';

export const loadPlan = Effect.fn('IngestTelegram.loadPlan')(function* (
    config: CommunityConfig,
    plan: ImportPlan,
    fileSha256: string,
    snapshot?: TelegramSnapshot
) {
    const db = yield* Db;

    yield* assertUniqueVenueNames(config);

    return yield* db.transaction(transaction =>
        Effect.gen(function* () {
            const communityId = yield* upsertCommunity(transaction, config);
            const context = { transaction, communityId, config, plan, snapshot };
            yield* purgePreviousImport(transaction, communityId);
            const reference = yield* upsertReference(context);
            const accounts = yield* loadAccounts(context);
            const released = yield* releaseVoteLinks(communityId);
            const known = yield* loadDirectory(communityId);
            const aliases = yield* insertPeople(context, known);
            const directory = yield* loadDirectory(communityId);
            const sessions = yield* loadSessions(context, reference, directory);
            const votes = yield* insertVotes(context, directory, sessions.sessionIds);
            yield* countOccurrences(communityId);
            const links = yield* linkByVotes(communityId);
            yield* alignGuests(communityId);
            yield* removeUnusedNicknames(context);
            yield* refreshNames(released);
            const fixtures = yield* insertMoneyAndLeague(context, reference.venueIdByKey);
            const stats = {
                sessions: plan.sessions.length,
                teams: sessions.teams,
                entries: sessions.entries,
                unassignedGuestRequests: sessions.unassignedGuestRequests,
                accounts,
                votes,
                aliasLinks: links.aliases,
                segmentLinks: links.segments,
                sharedEntries: links.sharedEntries,
                aliases,
                authors: plan.facts.authors.length,
                priceRules: plan.prices.length,
                fixtures
            };
            yield* recordProvenance(context, { fileSha256, sessionIds: sessions.sessionIds, stats });

            return stats;
        })
    );
});
