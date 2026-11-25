import { expect, layer } from '@effect/vitest';
import { isEmptyString } from '@rnw-community/shared';
import { messageRef } from '@rondo/db/schema/platform.schema';
import { teamDraft } from '@rondo/db/schema/play.schema';
import { signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder, recordingTelegramLayer } from '@rondo/telegram/testing/recording-telegram.layer';
import { and, eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';

import { Access } from '../src/access/admin-access';
import { syncMember } from '../src/identity/telegram-user';
import { swapPlayers } from '../src/teams/draft-state';
import { publishLineup } from '../src/teams/publish-lineup';
import { changeDraft, openDraft } from '../src/teams/team-draft.service';
import { claimNotice, claimProposal } from '../src/teams/team-schedule';
import { postgresRaceLayer, raceDatabaseUrl } from '../src/testing/postgres-race.layer';
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

const postgresLayer = Layer.mergeAll(postgresRaceLayer, recordingTelegramLayer(raceRecorder), Access.layerFor([42n]));

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
                const publish = publishLineup({
                    communityId,
                    sessionId,
                    version: row.version,
                    locale: 'uk',
                    actorPersonId: null,
                    privateChatId: null,
                    fallback: Option.some({ chatId: raceChat, topicId: null })
                }).pipe(Effect.result);
                const results = yield* Effect.all(
                    Array.from({ length: racers }, () => publish),
                    { concurrency: 'unbounded' }
                );
                const posts = yield* db
                    .select()
                    .from(messageRef)
                    .where(and(eq(messageRef.entityId, sessionId), eq(messageRef.purpose, 'lineup')));
                const proposals = yield* Effect.all(
                    Array.from({ length: racers }, () => claimProposal(sessionId, now)),
                    { concurrency: 'unbounded' }
                );
                yield* db
                    .update(teamDraft)
                    .set({ changedAt: new Date(now.getTime() + 500) })
                    .where(eq(teamDraft.sessionId, sessionId));
                const notices = yield* Effect.all(
                    Array.from({ length: racers }, () =>
                        claimNotice(sessionId, new Date(now.getTime() + 1000), new Date('2026-12-04T18:30:00Z'))
                    ),
                    { concurrency: 'unbounded' }
                );

                expect(
                    results
                        .flatMap(result => (result._tag === 'Success' ? result.success.groups.map(group => group.status) : ['failed']))
                        .toSorted()
                ).toEqual([...Array.from({ length: racers - 1 }, () => 'edited'), 'sent']);
                expect(posts).toHaveLength(1);
                expect(
                    raceRecorder.calls.filter(call => call.method === 'sendMessage' && call.payload.chat_id === Number(raceChat))
                ).toHaveLength(1);
                expect(proposals.filter(Boolean)).toHaveLength(1);
                expect(notices.filter(Boolean)).toHaveLength(1);
            })
    );
});
