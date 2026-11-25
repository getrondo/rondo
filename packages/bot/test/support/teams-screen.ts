import { isDefined } from '@rnw-community/shared';
import { loadDraft } from '@rondo/core/teams/team-draft.service';
import { person } from '@rondo/db/schema/identity.schema';
import { Db } from '@rondo/db/service/db.service';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Predicate from 'effect/Predicate';
import * as Schema from 'effect/Schema';

import type { conversation } from './conversation';

interface Button {
    readonly text: string;
    readonly callback_data?: string;
}

interface Shown {
    readonly text: string;
    readonly buttons: readonly (readonly Button[])[];
}

const titlePattern = /^▶?[🔴🔵🟢🟡⚪🟠] \d+$/u;

export const buttonData = (shown: Shown, label: string): string => {
    const button =
        shown.buttons.flat().find(entry => entry.text === label) ?? shown.buttons.flat().find(entry => entry.text.includes(label));

    return isDefined(button?.callback_data) ? button.callback_data : 'm:gone';
};

export const playerData = (shown: Shown, name: string): string =>
    shown.buttons.flat().find(entry => entry.text.replace(/^[▶⭐🔒🧤]+ /u, '') === name)?.callback_data ?? 'm:gone';

export const titleData = (shown: Shown, index: number): string => {
    const titles = shown.buttons.find(row => row.every(button => titlePattern.test(button.text)));

    return titles?.[index]?.callback_data ?? 'm:gone';
};

export const labelsOf = (shown: Shown): string[][] => shown.buttons.map(row => row.map(button => button.text));

export const draftTeams = Effect.fn('test.draftTeams')(function* (sessionId: string) {
    const db = yield* Db;
    const row = yield* loadDraft(sessionId).pipe(
        Effect.flatMap(found => Effect.fromOption(found)),
        Effect.orDie
    );
    const names = yield* db.select({ id: person.id, name: person.displayName }).from(person);
    const nameOf = (personId: string) => names.find(entry => entry.id === personId)?.name ?? personId;

    return {
        row,
        teams: row.state.teams.map(members => members.map(personId => nameOf(personId))),
        pending: row.state.pending.map(personId => nameOf(personId))
    };
});

export const openEditor = (admin: ReturnType<typeof conversation>) =>
    Effect.gen(function* () {
        yield* admin.type('/games');
        yield* admin.tap('Пт 27.11 19:00');
        yield* admin.press(
            admin
                .screen()
                .buttons.flat()
                .find(button => /Склад|Состав/u.test(button.text))?.callback_data ?? 'm:gone'
        );
    });

const SentSchema = Schema.Struct({
    text: Schema.String,
    reply_markup: Schema.Struct({
        inline_keyboard: Schema.Array(Schema.Array(Schema.Struct({ text: Schema.String, callback_data: Schema.String })))
    })
});
const decodeSent = Schema.decodeUnknownOption(SentSchema);

export const sentMessage = (call: { readonly payload: unknown; readonly result?: unknown } | undefined) => ({
    id: Predicate.hasProperty(call?.result, 'message_id') && Predicate.isNumber(call.result.message_id) ? call.result.message_id : 0,
    text: Option.match(decodeSent(call?.payload), { onNone: () => '', onSome: value => value.text }),
    buttons: Option.match(decodeSent(call?.payload), { onNone: () => [], onSome: value => value.reply_markup.inline_keyboard })
});
