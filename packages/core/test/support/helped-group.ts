import { pendingAction } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { grantAdmin } from '../../src/access/admin-access';
import { syncMember } from '../../src/identity/telegram-user';
import { createSession } from '../../src/sessions/session.service';
import { decideAs, proposeAs } from '../../src/testing/confirm-action';
import { linkGroup } from '../../src/testing/link-group';
import { recorder } from '../../src/testing/recorded-telegram.layer';
import { seedCommunity, seedConfig } from '../../src/testing/seed-community';

import type { Action } from '../../src/actions/action.model';

export { confirmAsOwner, proposeAs } from '../../src/testing/confirm-action';
export { linkGroup, ownerApproval } from '../../src/testing/link-group';
export { recordedTelegramDbLayer, recorder } from '../../src/testing/recorded-telegram.layer';

export const sentTo = (chatId: number, method: string) =>
    recorder.calls.filter(call => call.payload.chat_id === chatId && call.method === method).length;

export const decide = (actionId: string, tgUserId: bigint, now = new Date('2026-12-01T10:00:00Z')) => decideAs(actionId, tgUserId, now);

export const helped = Effect.fn('test.helped')(function* (slug: string, chatId: number, helper: number) {
    const { communityId } = yield* seedCommunity(seedConfig(slug));
    yield* linkGroup(communityId, { chatId });
    const personId = yield* syncMember(communityId, { id: BigInt(helper), firstName: 'Helper' }, 'active');
    yield* grantAdmin({ communityId, personId, grantedBy: null });
    const sessionId = yield* createSession({
        communityId,
        timezone: 'Europe/Vienna',
        localDate: '2026-12-04',
        localTime: '19:00',
        venueId: null,
        capacityMax: 10,
        title: null,
        actorPersonId: null
    });

    return {
        communityId,
        sessionId,
        ask: (action: Action) =>
            Effect.gen(function* () {
                const db = yield* Db;
                const actionId = yield* proposeAs(communityId, BigInt(helper), action);
                // The time of the test is not the time of the database
                yield* db
                    .update(pendingAction)
                    .set({ createdAt: new Date('2026-12-01T09:59:00Z'), expiresAt: new Date('2026-12-01T10:30:00Z') })
                    .where(eq(pendingAction.id, actionId));

                return actionId;
            })
    };
});

export const actionRow = Effect.fn('test.actionRow')(function* (actionId: string) {
    const db = yield* Db;
    const [row] = yield* db.select().from(pendingAction).where(eq(pendingAction.id, actionId));

    return row;
});

export const untilSent = Effect.fn('test.untilSent')(function* (chatId: number, method: string) {
    while (sentTo(chatId, method) === 0) {
        yield* Effect.promise(
            async () =>
                await new Promise<void>(resolve => {
                    setImmediate(resolve);
                })
        );
    }
});
