import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { priceRule } from '@rondo/db/schema/finance.schema';
import { competition, fixture, opponent, squad } from '@rondo/db/schema/league.schema';
import { and, eq, inArray } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { lookupId } from '../utils/lookup-id.util';

import type { LoadContext, ReferenceIds } from '../interface/load-context.interface';

const insertPriceRules = Effect.fn('IngestTelegram.insertPriceRules')(function* (
    { transaction, communityId, plan }: LoadContext,
    venueIdByKey: ReferenceIds['venueIdByKey']
) {
    if (isNotEmptyArray(plan.prices)) {
        yield* transaction.insert(priceRule).values(
            plan.prices.map(price => ({
                communityId,
                scope: isDefined(price.venueKey) ? ('venue' as const) : ('community' as const),
                scopeId: lookupId(venueIdByKey, price.venueKey),
                appliesTo: price.appliesTo,
                amountCents: price.amountCents,
                valid: `[${price.from},${price.to ?? ''})`,
                note: 'import'
            }))
        );
    }
});

const insertCompetitions = Effect.fn('IngestTelegram.insertCompetitions')(function* ({ transaction, communityId, plan }: LoadContext) {
    const competitionKeys = [
        ...new Map(
            plan.fixtures.filter(item => isDefined(item.competition)).map(item => [`${item.competition}|${item.season}`, item])
        ).values()
    ];

    if (isNotEmptyArray(competitionKeys)) {
        yield* transaction
            .insert(competition)
            .values(
                competitionKeys.map(item => ({
                    communityId,
                    name: item.competition ?? '',
                    season: item.season,
                    kind: 'league' as const,
                    level: item.competition
                }))
            )
            .onConflictDoNothing();
    }
});

export const insertMoneyAndLeague = Effect.fn('IngestTelegram.insertMoneyAndLeague')(function* (
    context: LoadContext,
    venueIdByKey: ReferenceIds['venueIdByKey']
) {
    const { transaction, communityId, plan } = context;

    yield* insertPriceRules(context, venueIdByKey);

    const squadNames = [...new Set(plan.fixtures.map(item => item.squadName))];
    const opponentNames = [...new Set(plan.fixtures.map(item => item.opponent))];

    if (!isNotEmptyArray(squadNames)) {
        return 0;
    }

    yield* transaction
        .insert(squad)
        .values(squadNames.map(name => ({ communityId, name })))
        .onConflictDoNothing();
    yield* transaction
        .insert(opponent)
        .values(opponentNames.map(name => ({ communityId, name })))
        .onConflictDoNothing();
    yield* insertCompetitions(context);

    const competitions = yield* transaction.select().from(competition).where(eq(competition.communityId, communityId));
    const squads = yield* transaction.select().from(squad).where(eq(squad.communityId, communityId));
    const opponents = yield* transaction
        .select()
        .from(opponent)
        .where(and(eq(opponent.communityId, communityId), inArray(opponent.name, opponentNames)));

    yield* transaction.insert(fixture).values(
        plan.fixtures.map(item => ({
            competitionId: competitions.find(row => row.name === item.competition && row.season === item.season)?.id,
            squadId: squads.find(row => row.name === item.squadName)?.id,
            opponentId: opponents.find(row => row.name === item.opponent)?.id ?? '',
            playedOn: item.localDate,
            home: item.home,
            goalsFor: item.goalsFor,
            goalsAgainst: item.goalsAgainst,
            status: 'played' as const,
            source: 'import' as const
        }))
    );

    return plan.fixtures.length;
});
