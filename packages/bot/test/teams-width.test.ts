import { expect, layer } from '@effect/vitest';
import { person } from '@rondo/db/schema/identity.schema';
import { telegramChat } from '@rondo/db/schema/org.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import { eq, inArray } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

import { runTeamsTick } from '../src/jobs/teams.job';
import { buttonBudget } from '../src/utils/button-budget.util';
import { labelWidth } from '../src/utils/label-width.util';

import { conversation } from './support/conversation';
import { setNow } from './support/fixed-clock';
import { teamsGame } from './support/teams-game';
import { buttonData, openEditor, titleData } from './support/teams-screen';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();

const ButtonRowsSchema = Schema.Struct({ inline_keyboard: Schema.Array(Schema.Array(Schema.Struct({ text: Schema.String }))) });
const decodeRows = Schema.decodeUnknownOption(ButtonRowsSchema);

const rowsOf = (markup: unknown) => Option.match(decodeRows(markup), { onNone: () => [], onSome: value => value.inline_keyboard });

const overflowing = () =>
    recorder.calls.flatMap(call =>
        rowsOf(call.payload.reply_markup).flatMap(row =>
            row.filter(button => labelWidth(button.text) > buttonBudget(row.length)).map(button => `${button.text} (${row.length})`)
        )
    );

type Shown = ReturnType<ReturnType<typeof conversation>['screen']>;

const gridButton = (shown: Shown, row: number, column: number): string => shown.buttons[row]?.[column]?.callback_data ?? '';
const firstButton = (shown: Shown): string => shown.buttons[0]?.[0]?.callback_data ?? '';

const walkTeams = Effect.fn('test.walkTeams')(function* (locale: 'uk' | 'ru', id: number) {
    const db = yield* Db;
    const toEditor = locale === 'uk' ? '⬅️ До складів' : '⬅️ К составам';
    const { people } = yield* teamsGame(`teams-width-${locale}`, { groupChatId: -3900 - id, adminId: id, players: 26, keepers: 4 });
    yield* db.update(person).set({ displayName: 'Volodymyr-Oleksandr Long' }).where(inArray(person.id, people));
    yield* db
        .update(telegramChat)
        .set({ title: 'A very long group name for football friends' })
        .where(eq(telegramChat.chatId, BigInt(-3900 - id)));
    yield* setNow(Date.parse('2026-11-27T17:00:00Z'));
    yield* runTeamsTick(new Date('2026-11-27T17:00:00Z'));
    const admin = conversation(recorder, adminNumbered(id, locale));
    yield* openEditor(admin);
    yield* admin.press(gridButton(admin.screen(), 2, 0));
    yield* admin.press(titleData(admin.screen(), 1));
    yield* admin.press(titleData(admin.screen(), 2));
    yield* admin.press(titleData(admin.screen(), 2));
    yield* admin.tap(toEditor);

    for (const label of ['➕', '🎚', locale === 'uk' ? '➕ Прийшов ще' : '➕ Пришёл ещё']) {
        yield* admin.press(buttonData(admin.screen(), label));
        yield* admin.tap(toEditor);
    }

    yield* admin.press(buttonData(admin.screen(), '➕'));
    yield* admin.press(firstButton(admin.screen()));
    yield* admin.press(buttonData(admin.screen(), '+2'));
    yield* admin.press(firstButton(admin.screen()));
    yield* admin.press(gridButton(admin.screen(), 1, 1));
    yield* admin.press(buttonData(admin.screen(), '🗑'));
    yield* admin.tap(toEditor);
    yield* admin.press(buttonData(admin.screen(), '✅'));
    yield* admin.press(buttonData(admin.screen(), '✅'));
});

const labels = () => recorder.calls.flatMap(call => rowsOf(call.payload.reply_markup).flatMap(row => row.map(button => button.text)));

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('team buttons on a 390 px phone', it => {
    it.effect('keeps every team button within its row width in Ukrainian and Russian, with long names', () =>
        Effect.gen(function* () {
            for (const [locale, id] of [
                ['uk', 391],
                ['ru', 392]
            ] as const) {
                yield* walkTeams(locale, id);
            }

            expect(overflowing()).toEqual([]);
            expect(labels().filter(label => label.endsWith('у найслабшу') || label.endsWith('в самую слабую'))).toHaveLength(2);
            expect(labels()).toEqual(
                expect.arrayContaining([
                    '🗑 Прибрати з гри',
                    '🗑 Убрать из игры',
                    '✅ Надіслати в «A very long group…',
                    '✅ Отправить в «A very long group…'
                ])
            );
        })
    );
});
