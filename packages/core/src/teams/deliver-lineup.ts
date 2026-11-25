import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { lineupDelivery, teamDraft } from '@rondo/db/schema/play.schema';
import { session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { withCommunityLock } from '@rondo/db/service/with-community-lock';
import { Telegram } from '@rondo/telegram/service/telegram.service';
import { and, eq } from 'drizzle-orm';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';

import { failureOf, type ActionFailure } from '../error/action-failed.error';
import { topicOptions } from '../utils/topic-options.util';

import type { DeliveryOutcome, PlannedDelivery } from './interface/publish.interface';

const notModified = /message is not modified/iu;
const notFound = /message to edit not found/iu;
const htmlOptions = { parse_mode: 'HTML' as const, link_preview_options: { is_disabled: true } };
const closedStatuses = new Set(['cancelled', 'played', 'moved']);

export interface Claim {
    readonly delivery: PlannedDelivery;
    readonly token: string;
}

export const isGameOpen = Effect.fn('Core.isGameOpenForLineup')(function* (sessionId: string) {
    const db = yield* Db;
    const [game] = yield* db.select({ status: session.status }).from(session).where(eq(session.id, sessionId));

    return isDefined(game) && !closedStatuses.has(game.status);
});

const sendOne = (delivery: PlannedDelivery) =>
    Effect.gen(function* () {
        const telegram = yield* Telegram;
        const chatId = Number(delivery.chatId);
        const { messageId } = delivery;

        if (isDefined(messageId)) {
            yield* telegram.call('editMessageText', api => api.editMessageText(chatId, messageId, delivery.html, htmlOptions));

            return { messageId, status: 'edited' as const };
        }

        const sent = yield* telegram.call('sendMessage', api =>
            api.sendMessage(chatId, delivery.html, { ...htmlOptions, ...topicOptions(delivery) })
        );

        return { messageId: sent.message_id, status: 'sent' as const };
    });

export const deliverOne = Effect.fn('Core.deliverLineup')(function* (
    communityId: string,
    sessionId: string,
    claim: Claim,
    publishToken: string
) {
    const db = yield* Db;
    const { delivery } = claim;
    const where = and(
        eq(lineupDelivery.sessionId, sessionId),
        eq(lineupDelivery.chatId, delivery.chatId),
        eq(lineupDelivery.token, claim.token)
    );
    const outcome = (status: DeliveryOutcome['status'], failure: ActionFailure | null): DeliveryOutcome => ({
        chatId: delivery.chatId,
        title: delivery.title,
        status,
        failure,
        isEdit: isDefined(delivery.messageId)
    });
    const checked = Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        const [draft] = yield* db
            .update(teamDraft)
            .set({ publishAt: now })
            .where(and(eq(teamDraft.sessionId, sessionId), eq(teamDraft.publishToken, publishToken)))
            .returning({ sessionId: teamDraft.sessionId });
        const [own] = isDefined(draft)
            ? yield* db.update(lineupDelivery).set({ updatedAt: now }).where(where).returning({ chatId: lineupDelivery.chatId })
            : [];

        if (!isDefined(own)) {
            return outcome('busy', null);
        }

        if (!(yield* isGameOpen(sessionId))) {
            yield* db
                .update(lineupDelivery)
                .set({ status: isDefined(delivery.messageId) ? 'sent' : 'refused' })
                .where(where);

            return outcome('refused', { code: 'game_over' });
        }

        return null;
    });
    const answered = (receipt: Partial<typeof lineupDelivery.$inferInsert>, result: DeliveryOutcome) => ({ receipt, result });
    const send = sendOne(delivery).pipe(
        Effect.map(done =>
            answered(
                { status: 'sent', messageId: done.messageId, text: delivery.text, topicId: delivery.topicId },
                outcome(done.status, null)
            )
        ),
        Effect.catchTag('TelegramApiError', error => {
            if (notModified.test(error.description)) {
                return Effect.succeed(answered({ status: 'sent', text: delivery.text }, outcome('edited', null)));
            }

            const status = error.isUncertain ? 'uncertain' : 'refused';
            const isGone = notFound.test(error.description);
            const failure: ActionFailure = isGone ? { code: 'message_gone' } : failureOf(error);
            const isKept = status === 'refused' && isDefined(delivery.messageId) && !isGone;

            // A refused send as a new message keeps the id of the message that is still in the group
            return Effect.succeed(
                answered({ status: isKept ? 'sent' : status, ...(isGone ? { messageId: null } : {}) }, outcome(status, failure))
            );
        })
    );
    const delivered = Effect.gen(function* () {
        const stopped = yield* withCommunityLock({ id: communityId }, checked);

        if (isDefined(stopped)) {
            return stopped;
        }

        const { receipt, result } = yield* send;
        const saved = yield* withCommunityLock(
            { id: communityId },
            db.update(lineupDelivery).set(receipt).where(where).returning({ chatId: lineupDelivery.chatId })
        );

        return isNotEmptyArray(saved) ? result : outcome('uncertain', null);
    });

    return yield* delivered.pipe(
        Effect.catchCause(cause => Effect.logError('[teams] lineup receipt not saved', cause).pipe(Effect.as(outcome('uncertain', null))))
    );
});
