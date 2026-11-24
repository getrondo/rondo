import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { extraction, ingestRun, sourceRef } from '@rondo/db/schema/platform.schema';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';

import { chunks } from '../utils/chunks.util';
import { insertMany } from '../utils/insert-many.util';

import type { PlannedSession } from '../extract/assemble-plan';
import type { LoadContext } from '../interface/load-context.interface';

interface ProvenanceInput {
    readonly fileSha256: string;
    readonly sessionIds: readonly string[];
    readonly stats: Record<string, number>;
}

const lineupConfidence = 0.95;
const cancellationConfidence = 0.75;

const referencesOf = (planned: PlannedSession, sessionId: string) => [
    ...planned.pollMessageIds.map(messageId => ({ messageId, kind: 'poll' as const, sessionId, confidence: planned.confidence })),
    ...(isDefined(planned.lineup)
        ? [{ messageId: planned.lineup.messageId, kind: 'lineup' as const, sessionId, confidence: lineupConfidence }]
        : []),
    ...(isDefined(planned.cancellationMessageId)
        ? [{ messageId: planned.cancellationMessageId, kind: 'cancel' as const, sessionId, confidence: cancellationConfidence }]
        : [])
];

export const recordProvenance = Effect.fn('IngestTelegram.recordProvenance')(function* (
    { transaction, communityId, plan }: LoadContext,
    { fileSha256, sessionIds, stats }: ProvenanceInput
) {
    const finishedAt = yield* DateTime.nowAsDate;
    const [run] = yield* transaction
        .insert(ingestRun)
        .values({
            communityId,
            source: isNotEmptyArray(plan.facts.accounts) ? 'telegram_json' : 'telegram_html',
            fileSha256,
            parserVersion: '2',
            finishedAt,
            stats
        })
        .returning({ id: ingestRun.id });
    const runId = run?.id ?? '';
    const refs = plan.sessions.flatMap((planned, index) => referencesOf(planned, sessionIds[index] ?? ''));
    const unique = [...new Map(refs.map(ref => [`${ref.messageId}|${ref.kind}`, ref])).values()];
    const sentAtById = new Map([
        ...plan.facts.polls.map(poll => [poll.messageId, poll.postedAt] as const),
        ...plan.facts.lineups.map(lineup => [lineup.messageId, lineup.postedAt] as const),
        ...plan.facts.cancellations.map(cancellation => [cancellation.messageId, cancellation.postedAt] as const)
    ]);
    const sourceRefIds: string[] = [];

    for (const batch of chunks(unique)) {
        const rows = yield* transaction
            .insert(sourceRef)
            .values(
                batch.map(ref => ({
                    runId,
                    communityId,
                    messageId: ref.messageId,
                    sentAt: sentAtById.get(ref.messageId) ?? new Date(0),
                    kind: ref.kind
                }))
            )
            .returning({ id: sourceRef.id });
        sourceRefIds.push(...rows.map(row => row.id));
    }

    yield* insertMany(
        unique.map((ref, index) => ({
            sourceRefId: sourceRefIds[index] ?? '',
            entityType: 'scheduling.session',
            entityId: ref.sessionId,
            confidence: ref.confidence
        })),
        batch => transaction.insert(extraction).values(batch)
    );
});
