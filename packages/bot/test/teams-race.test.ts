import { expect, layer } from '@effect/vitest';
import { isEmptyString } from '@rnw-community/shared';
import { adminState } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Predicate from 'effect/Predicate';
import * as Random from 'effect/Random';

import { conversation, startUpdatesAt } from './support/conversation';
import { teamsGame } from './support/teams-game';
import { buttonData, openEditor } from './support/teams-screen';
import { adminNumbered, raceDatabaseUrl, raceMenuLayer } from './support/test-layer';

const recorder = makeRecorder();
const withoutPostgres = isEmptyString(raceDatabaseUrl);

layer(raceMenuLayer(recorder), { timeout: 120_000, excludeTestServices: true })('team taps on a real Postgres', it => {
    it.effect.skipIf(withoutPostgres)('takes one answer when the same pasted question is answered twice at once', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const adminId = yield* Random.nextIntBetween(100_000, 900_000);
            yield* startUpdatesAt(adminId * 1000);
            yield* teamsGame(`teams-race-paste-${performance.now()}`, { groupChatId: -adminId, adminId, players: 23 });
            const admin = conversation(recorder, adminNumbered(adminId));
            yield* openEditor(admin);
            yield* admin.type('🔴 Andriy, Bohdan, Vasyl\n🔵 Hryhoriy, Dmytro, Yevhen');
            const skip = buttonData(admin.screen(), '⏭ Пропустити');
            yield* Effect.all([admin.press(skip), admin.press(skip), admin.press(skip)], { concurrency: 'unbounded' });
            const [row] = yield* db
                .select({ draft: adminState.draft })
                .from(adminState)
                .where(eq(adminState.tgUserId, BigInt(adminId)));
            const paste = Predicate.hasProperty(row?.draft, 'paste') ? row.draft.paste : null;

            expect(Predicate.hasProperty(paste, 'revision') ? paste.revision : null).toBe(1);
        })
    );
});
