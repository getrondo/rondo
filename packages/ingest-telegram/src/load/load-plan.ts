import { isDefined } from '@rnw-community/shared';
import { applyApproved } from '@rondo/core/identity/apply-approved';
import { countOccurrences } from '@rondo/core/identity/count-occurrences';
import { loadDirectory } from '@rondo/core/identity/load-directory';
import { refreshNames } from '@rondo/core/identity/refresh-names';
import { linkByVotes, releaseVoteLinks } from '@rondo/core/identity/vote-links';
import { alignGuests } from '@rondo/core/roster/align-guests';
import { markUndecidedTeams } from '@rondo/core/roster/mark-undecided-teams';
import { Db } from '@rondo/db/service/db.service';
import * as Effect from 'effect/Effect';

import { loadAccounts } from './load-accounts';
import { assertUniqueVenueNames, purgePreviousImport, upsertCommunity, upsertReference } from './load-community';
import { insertMoneyAndLeague } from './load-league';
import { insertPeople } from './load-people';
import { recordProvenance } from './load-provenance';
import { loadSessions } from './load-sessions';
import { insertVotes } from './load-votes';
import { removeUnusedNicknames } from './remove-unused-nicknames';

import type { ImportPlan } from '../extract/assemble-plan';
import type { CommunityConfig } from '@rondo/core/config/community-config';
import type { TelegramSnapshot } from '@rondo/core/model/telegram-snapshot.model';

interface LoadOptions {
    readonly fileSha256: string;
    readonly snapshot?: TelegramSnapshot;
    readonly allowRemoval?: boolean;
}

export const loadPlan = Effect.fn('IngestTelegram.loadPlan')(function* (
    config: CommunityConfig,
    plan: ImportPlan,
    { fileSha256, snapshot, allowRemoval }: LoadOptions
) {
    const db = yield* Db;

    yield* assertUniqueVenueNames(config);

    return yield* db.transaction(transaction =>
        Effect.gen(function* () {
            const communityId = yield* upsertCommunity(transaction, config);
            const context = { transaction, communityId, config, plan, snapshot, allowRemoval };
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
            const approved = yield* applyApproved(communityId);
            const links = yield* linkByVotes(communityId, isDefined(config.otherChats));
            yield* markUndecidedTeams(communityId);
            yield* alignGuests(communityId);
            yield* removeUnusedNicknames(context);
            yield* refreshNames(released);
            const fixtures = yield* insertMoneyAndLeague(context, reference.venueIdByKey);
            const stats = {
                sessions: plan.sessions.length,
                ambiguousDates: sessions.ambiguousDates,
                teams: sessions.teams,
                entries: sessions.entries,
                unassignedGuestRequests: sessions.unassignedGuestRequests,
                accounts,
                votes,
                approvedEntries: approved,
                aliasLinks: links.aliases,
                segmentLinks: links.segments,
                sharedEntries: links.sharedEntries,
                extendedEntries: links.extended,
                otherChatLinks: links.others,
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
