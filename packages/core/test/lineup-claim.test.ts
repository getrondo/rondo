import { expect, layer } from '@effect/vitest';
import { lineupDelivery, teamDraft } from '@rondo/db/schema/play.schema';
import { Db } from '@rondo/db/service/db.service';
import { Telegram } from '@rondo/telegram/service/telegram.service';
import { eq, sql } from 'drizzle-orm';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as TestClock from 'effect/testing/TestClock';

import { recordedTelegramDbLayer } from '../src/testing/recorded-telegram.layer';

import { publishPlanned, twoGroupGame } from './support/two-group-game';

layer(recordedTelegramDbLayer, { timeout: 60_000 })('line-up claim during a send', it => {
    it.effect('keeps the claim fresh before every send and sends outside the community lock', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const telegram = yield* Telegram;
            const game = yield* twoGroupGame('delivery-unlocked', [-7921, -7922], 79_200);
            const ages: number[] = [];
            const locks: number[] = [];
            const fresh: boolean[] = [];
            const published = yield* publishPlanned(game).pipe(
                Effect.provideService(Telegram, {
                    ...telegram,
                    call: (method, request) =>
                        Effect.gen(function* () {
                            const now = yield* DateTime.nowAsDate;
                            const [draft] = yield* db.select().from(teamDraft).where(eq(teamDraft.sessionId, game.sessionId));
                            const claims = yield* db.select().from(lineupDelivery).where(eq(lineupDelivery.sessionId, game.sessionId));
                            const held = yield* db.execute(sql`select 1 from pg_locks where locktype = 'advisory'`);
                            const isFresh = claims.some(row => row.status === 'claimed' && row.updatedAt.getTime() === now.getTime());
                            ages.push(now.getTime() - (draft?.publishAt?.getTime() ?? 0));
                            locks.push(held.rows.length);
                            fresh.push(isFresh);
                            yield* TestClock.adjust('20 seconds');
                        }).pipe(Effect.orDie, Effect.andThen(telegram.call(method, request)))
                })
            );

            expect(published.deliveries.map(delivery => delivery.status)).toEqual(['sent', 'sent']);
            expect(ages).toEqual([0, 0]);
            expect(locks).toEqual([0, 0]);
            expect(fresh).toEqual([true, true]);
        })
    );

    it.effect('does not report a message as sent when its claim was taken over during the send', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const telegram = yield* Telegram;
            const game = yield* twoGroupGame('delivery-claim-lost', [-7931, -7932], 79_300);
            const token = '00000000-0000-4000-8000-000000000003';
            const takeOver = db.update(lineupDelivery).set({ token }).where(eq(lineupDelivery.chatId, -7931n)).pipe(Effect.orDie);
            const published = yield* publishPlanned(game).pipe(
                Effect.provideService(Telegram, {
                    ...telegram,
                    call: (method, request) => takeOver.pipe(Effect.andThen(telegram.call(method, request)))
                })
            );
            const [row] = yield* db.select().from(lineupDelivery).where(eq(lineupDelivery.chatId, -7931n));

            expect(published.deliveries.map(delivery => delivery.status)).toEqual(['uncertain', 'sent']);
            expect(row).toMatchObject({ status: 'claimed', token, messageId: null });
        })
    );
});
