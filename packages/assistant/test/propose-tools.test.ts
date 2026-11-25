import { expect, layer } from '@effect/vitest';
import { isDefined } from '@rnw-community/shared';
import { syncMember } from '@rondo/core/identity/telegram-user';
import { createSession } from '@rondo/core/sessions/session.service';
import { recordedTelegramDbLayer } from '@rondo/core/testing/recorded-telegram.layer';
import { seedCommunity, seedConfig } from '@rondo/core/testing/seed-community';
import { personAlias } from '@rondo/db/schema/identity.schema';
import { pendingAction } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { MockLanguageModelV4 } from 'ai/test';
import { desc, eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';

import { runAssistant } from '../src/run-assistant';
import { AiGateway } from '../src/service/ai-gateway.service';

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
let nextCall: { readonly toolName: string; readonly input: Readonly<Record<string, unknown>> } | null = null;

const model = new MockLanguageModelV4({
    doGenerate: async () => {
        const call = nextCall;
        nextCall = null;

        return await Promise.resolve(
            isDefined(call)
                ? {
                      content: [
                          {
                              type: 'tool-call' as const,
                              toolCallId: call.toolName,
                              toolName: call.toolName,
                              input: JSON.stringify(call.input)
                          }
                      ],
                      finishReason: { unified: 'tool-calls' as const, raw: 'tool_use' },
                      usage,
                      warnings: []
                  }
                : {
                      content: [{ type: 'text' as const, text: 'ok' }],
                      finishReason: { unified: 'stop' as const, raw: 'end_turn' },
                      usage,
                      warnings: []
                  }
        );
    }
});

const ask = (communityId: string, toolName: string, input: Readonly<Record<string, unknown>>) =>
    Effect.gen(function* () {
        const db = yield* Db;
        nextCall = { toolName, input };
        yield* runAssistant({
            communityId,
            tgUserId: 42n,
            locale: 'uk',
            userText: toolName,
            prompt: {
                communityName: 'Test',
                timezone: 'Europe/Vienna',
                today: '2026-11-25',
                weekday: 'Wednesday',
                locale: 'uk',
                adminName: 'Admin',
                adminPersonId: 'admin'
            }
        });
        const [row] = yield* db
            .select()
            .from(pendingAction)
            .where(eq(pendingAction.communityId, communityId))
            .orderBy(desc(pendingAction.createdAt))
            .limit(1);

        return { kind: row?.kind, payload: row?.payload };
    });

layer(Layer.mergeAll(recordedTelegramDbLayer, AiGateway.layerFor(model)), { timeout: 60_000 })('assistant proposals', it => {
    it.effect('builds the right action for every propose tool', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, venueIdByName } = yield* seedCommunity(seedConfig('tools-fc'));
            const venueId = venueIdByName.get('Park Field') ?? '';
            const sessionId = yield* createSession({
                communityId,
                timezone: 'Europe/Vienna',
                localDate: '2026-12-04',
                localTime: '19:00',
                venueId,
                capacityMax: 14,
                title: null,
                actorPersonId: null
            });
            const personId = yield* syncMember(communityId, { id: 5001n, firstName: 'Player' }, 'active');
            const otherId = yield* syncMember(communityId, { id: 5002n, firstName: 'Other' }, 'active');
            const [alias] = yield* db.insert(personAlias).values({ communityId, alias: 'Nick', aliasNorm: 'nick' }).returning();
            const aliasId = alias?.id ?? '';
            const cases: readonly [string, Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>][] = [
                [
                    'propose_create_session',
                    { localDate: '2026-12-11', localTime: '19:30', venueId, capacityMax: 16, fieldsPlanned: 2, announce: true },
                    { _tag: 'create_session', venueId, capacityMax: 16, fieldsPlanned: 2, announce: true, title: null }
                ],
                [
                    'propose_update_session',
                    { sessionId, localTime: '20:00', capacityMax: 18, notify: true },
                    { _tag: 'update_session', sessionId, localTime: '20:00', capacityMax: 18, notify: true }
                ],
                [
                    'propose_cancel_session',
                    { sessionId, reason: 'weather', notify: false },
                    { _tag: 'cancel_session', sessionId, reason: 'weather', notify: false }
                ],
                [
                    'propose_announce_session',
                    { sessionId, note: 'Bring a ball' },
                    { _tag: 'announce_session', sessionId, note: 'Bring a ball' }
                ],
                [
                    'propose_publish_teams',
                    { sessionId, teamCount: 2 },
                    { _tag: 'publish_teams', sessionId, teams: [{ ordinal: 1 }, { ordinal: 2 }] }
                ],
                ['propose_link_alias', { aliasId, personId }, { _tag: 'link_alias', aliasId, personId }],
                ['propose_unlink_alias', { aliasId }, { _tag: 'unlink_alias', aliasId }],
                [
                    'propose_rename_person',
                    { personId, displayName: 'New Name' },
                    { _tag: 'rename_person', personId, displayName: 'New Name' }
                ],
                ['propose_grant_admin', { personId: otherId }, { _tag: 'grant_admin', personId: otherId }],
                ['propose_create_person', { displayName: 'Offline Player' }, { _tag: 'create_person', displayName: 'Offline Player' }],
                [
                    'propose_create_venue',
                    { name: 'River Court', station: 'U1', shortName: null },
                    { _tag: 'create_venue', name: 'River Court', station: 'U1' }
                ],
                [
                    'propose_update_venue',
                    { venueId, alias: 'park', active: false },
                    { _tag: 'update_venue', venueId, alias: 'park', active: false }
                ],
                ['propose_set_level', { personId, level: 7 }, { _tag: 'set_rating', personId, level: 7 }]
            ];

            for (const [toolName, input, expected] of cases) {
                const proposal = yield* ask(communityId, toolName, input);

                expect({ toolName, ...proposal }).toMatchObject({ toolName, kind: expected._tag, payload: expected });
            }
        })
    );
});
