import { isDefined, isEmptyArray, isNotEmptyString } from '@rnw-community/shared';
import { syncSessionRoster } from '@rondo/core/roster/sync-session-roster';
import { activity, community, sportEnum } from '@rondo/db/schema/org.schema';
import { session, sessionChange } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { withCommunityLock } from '@rondo/db/service/with-community-lock';
import { and, eq, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';

const DecisionSchema = Schema.Struct({
    date: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u)),
    sport: Schema.Literals(sportEnum.enumValues),
    status: Schema.Literals(['played', 'cancelled'])
});

type GameDecision = typeof DecisionSchema.Type;

interface GameDecisions {
    readonly slug: string;
    readonly decisions: readonly GameDecision[];
    readonly decidedAt: Date;
}

const decodeDecision = Schema.decodeUnknownEffect(DecisionSchema);

export const parseGameDecisions = Effect.fn('Approvals.parseGameDecisions')((file: string) =>
    Effect.all(
        file
            .split('\n')
            .filter(line => isNotEmptyString(line.trim()))
            .map(line => {
                const [date, sport, status] = line.split('|').map(part => part.trim());

                return decodeDecision({ date, sport, status });
            })
    )
);

const decidedGames = Effect.fn('Approvals.decidedGames')(function* (slug: string, { date, sport }: GameDecision) {
    const db = yield* Db;

    return yield* db
        .select({
            id: session.id,
            status: session.status,
            hasSquad: sql<boolean>`exists (
                select 1 from play.lineup_entry named where named.session_id = ${session.id} and named.team_ordinal > 0
            )`,
            isDecided: sql<boolean>`exists (
                select 1 from scheduling.session_change change
                where change.session_id = ${session.id} and change.diff ->> 'decision' = ${session.status}::text
            )`
        })
        .from(session)
        .innerJoin(community, eq(community.id, session.communityId))
        .innerJoin(activity, eq(activity.id, session.activityId))
        .where(and(eq(community.slug, slug), eq(session.localDate, date), eq(activity.sport, sport)));
});

export const loadGameDecisions = Effect.fn('Approvals.loadGameDecisions')(({ slug, decisions, decidedAt }: GameDecisions) =>
    withCommunityLock(
        { slug },
        Effect.gen(function* () {
            const db = yield* Db;
            const missing: string[] = [];
            const ambiguous: string[] = [];
            let changed = 0;

            for (const decision of decisions) {
                const { status } = decision;
                const [game, ...others] = yield* decidedGames(slug, decision);

                if (!isDefined(game) || !isEmptyArray(others)) {
                    (isDefined(game) ? ambiguous : missing).push(`${decision.date}|${decision.sport}`);
                } else if (game.status !== status || !game.isDecided) {
                    yield* db
                        .update(session)
                        .set({
                            status,
                            reviewReason: null,
                            cancelReason: status === 'played' ? null : sql`coalesce(${session.cancelReason}, 'organizer')`
                        })
                        .where(eq(session.id, game.id));
                    yield* db.insert(sessionChange).values({ sessionId: game.id, at: decidedAt, diff: { decision: status } });
                    yield* syncSessionRoster(status === 'cancelled' || game.hasSquad ? [game.id] : []);
                    changed += 1;
                }
            }

            return { decisions: decisions.length, changed, missing, ambiguous };
        })
    )
);

export const compareGameDecisions = Effect.fn('Approvals.compareGameDecisions')(function* (
    slug: string,
    decisions: readonly GameDecision[]
) {
    const kept = yield* Effect.all(
        decisions.map(decision =>
            decidedGames(slug, decision).pipe(
                Effect.map(([game, ...others]) => isEmptyArray(others) && game?.status === decision.status && game.isDecided)
            )
        )
    );

    return { decisions: decisions.length, kept: kept.filter(Boolean).length };
});
