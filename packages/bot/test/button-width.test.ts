import { expect, layer } from '@effect/vitest';
import { isDefined } from '@rnw-community/shared';
import { venue } from '@rondo/db/schema/venue.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { buttonBudget } from '../src/utils/button-budget.util';
import { labelWidth } from '../src/utils/label-width.util';

import { conversation } from './support/conversation';
import { seedSecondGroup, seedSeason } from './support/season';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();

type Step = readonly ['type' | 'op' | 'pin', string];

const steps: readonly Step[] = [
    ['type', '/start'],
    ['type', '/menu'],
    ['type', '/newgame'],
    ['op', 'a'],
    ['op', 'p+'],
    ['op', 't'],
    ['op', 'b'],
    ['op', 'v'],
    ['op', 'vl'],
    ['op', 'b'],
    ['op', 'b'],
    ['op', 'd'],
    ['op', 'b'],
    ['op', 'pz'],
    ['op', 'b'],
    ['op', 'au'],
    ['op', 'au'],
    ['op', 'ad'],
    ['op', 'b'],
    ['op', 'm'],
    ['op', 'ds'],
    ['op', 'vn'],
    ['type', 'Riverside Court West'],
    ['pin', ''],
    ['type', '17:00'],
    ['op', 'ps'],
    ['op', 'ok'],
    ['op', 't'],
    ['op', 'ts'],
    ['op', 'g'],
    ['op', 'x'],
    ['op', 'xr'],
    ['op', 'g'],
    ['op', 'z'],
    ['op', 'g'],
    ['op', 'k'],
    ['type', '/games'],
    ['op', 'gl'],
    ['type', '/newgame'],
    ['op', 'ok'],
    ['op', 'd'],
    ['op', 'ok']
];

const overflowing = () =>
    recorder.calls.flatMap(call => {
        const rows = (call.payload.reply_markup as { inline_keyboard?: { text: string }[][] } | undefined)?.inline_keyboard ?? [];

        return rows.flatMap(row =>
            row.filter(button => labelWidth(button.text) > buttonBudget(row.length)).map(button => `${button.text} (${row.length})`)
        );
    });

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('button widths on a 390 px phone', it => {
    it.effect('keeps every button within its row width in Ukrainian and Russian, with long names', () =>
        Effect.gen(function* () {
            const db = yield* Db;

            for (const [locale, id, chat] of [
                ['uk', 1301, -13_001],
                ['ru', 1302, -13_002]
            ] as const) {
                const { communityId, north, park } = yield* seedSeason(`width-${locale}`, { groupChatId: chat, adminId: id });
                yield* db.update(venue).set({ name: 'Sportpark Nordbahnhof' }).where(eq(venue.id, north));
                yield* db.update(venue).set({ name: 'Riverside Stadium Nord' }).where(eq(venue.id, park));
                yield* seedSecondGroup(communityId, { main: chat, second: chat - 50, venueId: park });
                const admin = conversation(recorder, adminNumbered(id, locale));

                for (const [kind, value] of steps) {
                    const buttons = admin.screen().buttons.flat();
                    const data = buttons.map(button => button.callback_data ?? '').find(entry => entry.split(':').includes(value));

                    if (kind === 'type') {
                        yield* admin.type(value);
                    } else if (kind === 'pin') {
                        yield* admin.location(48.2, 16.4);
                    } else if (isDefined(data)) {
                        yield* admin.press(data);
                    }
                }
            }

            expect(recorder.calls.filter(call => isDefined(call.payload.reply_markup)).length).toBeGreaterThan(60);
            expect(overflowing()).toEqual([]);
        })
    );
});
