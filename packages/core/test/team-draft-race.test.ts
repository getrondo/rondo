import { expect, layer } from '@effect/vitest';
import { isEmptyString } from '@rnw-community/shared';
import { lineupDelivery, teamDraft } from '@rondo/db/schema/play.schema';
import { signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder, recordingTelegramLayer } from '@rondo/telegram/testing/recording-telegram.layer';
import { and, eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';

import { Access } from '../src/access/admin-access';
import { syncMember } from '../src/identity/telegram-user';
import { removeFromGame } from '../src/signups/roster.service';
import { swapPlayers } from '../src/teams/draft-state';
import { planLineup } from '../src/teams/lineup-plan';
import { publishLineup } from '../src/teams/publish-lineup';
import { changeDraft, openDraft } from '../src/teams/team-draft.service';
import { claimNotice, claimProposal } from '../src/teams/team-schedule';
import { localPostgresLayer, raceDatabaseUrl } from '../src/testing/local-postgres.layer';
import { seedGame } from '../src/testing/seed-game';

const racers = 8;
const withoutPostgres = isEmptyString(raceDatabaseUrl);
const raceRecorder = makeRecorder();

const gameWithPlayers = Effect.fn('test.gameWithPlayers')(function* (slug: string, base: number) {
    const db = yield* Db;
    const { communityId, sessionId } = yield* seedGame(`${slug}-${performance.now()}`);

    for (let index = 0; index < 12; index += 1) {
        const personId = yield* syncMember(communityId, { id: BigInt(base + index), firstName: `Race${index}` }, 'active');
        yield* db.insert(signup).values({ sessionId, personId, status: 'in' });
    }

    return { communityId, sessionId };
});

const postgresLayer = Layer.mergeAll(localPostgresLayer(raceDatabaseUrl), recordingTelegramLayer(raceRecorder), Access.layerFor([42n]));

layer(postgresLayer, { timeout: 120_000, excludeTestServices: true })('team drafts on a real Postgres', it => {
    it.effect.skipIf(withoutPostgres)('lets one of two admins win a change of the same version and tells the other', () =>
        Effect.gen(function* () {
            const { communityId, sessionId } = yield* gameWithPlayers('race-draft', Math.floor(performance.now()) * 100);
            const opened = yield* Effect.all(
                Array.from({ length: racers }, () => openDraft(communityId, sessionId, null)),
                { concurrency: 'unbounded' }
            );
            const [row] = opened.map(entry => entry.row);
            const [first = '', second = ''] = [row?.state.teams[0]?.[0], row?.state.teams[1]?.[0]];
            const changes = yield* Effect.all(
                Array.from({ length: racers }, (_entry, admin) =>
                    changeDraft({ sessionId, version: row?.version ?? 0, key: `${admin}:w`, actorPersonId: null }, state =>
                        Effect.succeed(swapPlayers(state, first, second))
                    )
                ),
                { concurrency: 'unbounded' }
            );

            expect(new Set(opened.map(entry => entry.row.version)).size).toBe(1);
            expect(changes.filter(change => change._tag === 'changed')).toHaveLength(1);
            expect(changes.filter(change => change._tag === 'stale')).toHaveLength(racers - 1);
        })
    );

    it.effect.skipIf(withoutPostgres)(
        'posts one line-up when ✅ is tapped many times at once and claims each proposal and notice once',
        () =>
            Effect.gen(function* () {
                const db = yield* Db;
                const { communityId, sessionId } = yield* gameWithPlayers('race-post', Math.floor(performance.now()) * 100 + 50);
                const { row } = yield* openDraft(communityId, sessionId, null);
                const raceChat = -9_600_000n - BigInt(Math.floor(performance.now()));
                const now = new Date('2026-12-04T17:30:00Z');
                const input = {
                    communityId,
                    sessionId,
                    locale: 'uk' as const,
                    actorPersonId: null,
                    privateChatId: null,
                    fallback: Option.some({ chatId: raceChat, topicId: null })
                };
                const plan = yield* planLineup(input);
                const publish = publishLineup({ ...input, version: row.version, fingerprint: plan.fingerprint }).pipe(Effect.result);
                const results = yield* Effect.all(
                    Array.from({ length: racers }, () => publish),
                    { concurrency: 'unbounded' }
                );
                const posts = yield* db
                    .select()
                    .from(lineupDelivery)
                    .where(and(eq(lineupDelivery.sessionId, sessionId), eq(lineupDelivery.status, 'sent')));
                const proposals = yield* Effect.all(
                    Array.from({ length: racers }, () => claimProposal(sessionId, now)),
                    { concurrency: 'unbounded' }
                );
                yield* db
                    .update(teamDraft)
                    .set({ changedAt: new Date(now.getTime() + 330_000) })
                    .where(eq(teamDraft.sessionId, sessionId));
                const notices = yield* Effect.all(
                    Array.from({ length: racers }, () =>
                        claimNotice(sessionId, new Date(now.getTime() + 360_000), new Date('2026-12-04T18:30:00Z'))
                    ),
                    { concurrency: 'unbounded' }
                );

                expect(
                    results
                        .flatMap(result =>
                            result._tag === 'Success' ? result.success.deliveries.map(delivery => delivery.status) : ['changed']
                        )
                        .toSorted()
                ).toEqual([...Array.from({ length: racers - 1 }, () => 'changed'), 'sent']);
                expect(posts).toHaveLength(1);
                expect(
                    raceRecorder.calls.filter(call => call.method === 'sendMessage' && call.payload.chat_id === Number(raceChat))
                ).toHaveLength(1);
                expect(proposals.filter(Boolean)).toHaveLength(1);
                expect(notices.filter(Boolean)).toHaveLength(1);
            })
    );

    it.effect.skipIf(withoutPostgres)('commits a roster change only together with the draft change that won', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, sessionId } = yield* gameWithPlayers('race-roster', Math.floor(performance.now()) * 100 + 70);
            const { row } = yield* openDraft(communityId, sessionId, null);
            const players = row.state.teams.flat();
            const changes = yield* Effect.all(
                Array.from({ length: racers }, (_entry, admin) =>
                    changeDraft({ sessionId, version: row.version, key: `${admin}:R`, actorPersonId: null }, state =>
                        removeFromGame(
                            { communityId, sessionId, actorPersonId: null },
                            { personId: players[admin] ?? '', withGuests: false, isNoShow: false }
                        ).pipe(Effect.as({ ...state }))
                    )
                ),
                { concurrency: 'unbounded' }
            );
            const out = yield* db
                .select({ personId: signup.personId })
                .from(signup)
                .where(and(eq(signup.sessionId, sessionId), eq(signup.status, 'out')));

            expect(changes.filter(change => change._tag === 'changed')).toHaveLength(1);
            expect(out).toHaveLength(1);
        })
    );
});
