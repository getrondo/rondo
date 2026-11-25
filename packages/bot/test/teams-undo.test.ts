import { expect, layer } from '@effect/vitest';
import { syncMember } from '@rondo/core/identity/telegram-user';
import { signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import { and, eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { conversation } from './support/conversation';
import { teamsGame } from './support/teams-game';
import { buttonData, draftTeams, openEditor, playerData } from './support/teams-screen';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('undo and variants', it => {
    it.effect('never brings back a player who left, never drops one who came and never moves a locked one', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, sessionId } = yield* teamsGame('teams-undo', { groupChatId: -3701, adminId: 371, players: 12 });
            const admin = conversation(recorder, adminNumbered(371));
            yield* openEditor(admin);
            const start = yield* draftTeams(sessionId);
            const [first = '', second = ''] = [start.teams[0]?.[0], start.teams[1]?.[0]];
            yield* admin.press(playerData(admin.screen(), first));
            yield* admin.press(playerData(admin.screen(), second));
            const leaver = start.teams[0]?.[1] ?? '';
            yield* db
                .update(signup)
                .set({ status: 'out' })
                .where(and(eq(signup.sessionId, sessionId), eq(signup.personId, start.row.state.teams[0]?.[1] ?? '')));
            const comer = yield* syncMember(communityId, { id: 937_101n, firstName: 'Comer' }, 'active');
            yield* db.insert(signup).values({ sessionId, personId: comer, status: 'in' });
            yield* admin.press(buttonData(admin.screen(), '⬅️ Назад'));
            yield* openEditor(admin);
            yield* admin.press(buttonData(admin.screen(), '↩️'));
            const undone = yield* draftTeams(sessionId);
            const locked = undone.teams[0]?.[0] ?? '';
            yield* admin.press(playerData(admin.screen(), locked));
            yield* admin.press(buttonData(admin.screen(), '🔒'));
            const variants = [];

            for (const label of ['2️⃣', '3️⃣']) {
                yield* admin.press(buttonData(admin.screen(), label));
                variants.push(yield* draftTeams(sessionId));
            }

            for (const shown of [undone, ...variants]) {
                expect([...shown.teams.flat(), ...shown.pending]).not.toContain(leaver);
                expect([...shown.teams.flat(), ...shown.pending]).toContain('Comer');
            }

            for (const shown of variants) {
                expect(shown.teams[0]).toContain(locked);
            }
        })
    );
});
