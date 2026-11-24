import { isDefined, isEmptyString, isNotEmptyArray } from '@rnw-community/shared';
import { person } from '@rondo/db/schema/identity.schema';
import { signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { escapeHtml, mentionHtml } from '@rondo/telegram/format/html';
import { Telegram } from '@rondo/telegram/service/telegram.service';
import { and, eq, inArray } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { cancelReasonText, formatSessionLabel, text } from '../i18n/messages';
import { primaryAccount } from '../identity/primary-account';

import type { Locale } from '../i18n/locale';
import type { SessionView } from '../sessions/session.model';
import type { PromotedPlayer } from '../signups/signup.service';

const mentionsOf = Effect.fn('Core.mentionsOf')(function* (sessionId: string) {
    const db = yield* Db;
    const account = primaryAccount(db);
    const rows = yield* db
        .select({ tgUserId: account.tgUserId, name: person.displayName })
        .from(signup)
        .innerJoin(person, eq(person.id, signup.personId))
        .innerJoin(account, eq(account.personId, signup.personId))
        .where(and(eq(signup.sessionId, sessionId), inArray(signup.status, ['in', 'waitlisted'])));

    return rows.map(row => mentionHtml(row.tgUserId, row.name)).join(', ');
});

const post = Effect.fn('Core.post')(function* (chatId: bigint, html: string) {
    const telegram = yield* Telegram;

    yield* telegram.call('sendMessage', api => api.sendMessage(Number(chatId), html, { parse_mode: 'HTML' }));
});

export const notifySessionChanged = Effect.fn('Core.notifySessionChanged')(function* (input: {
    readonly before: SessionView;
    readonly after: SessionView;
    readonly chatId: bigint;
    readonly locale: Locale;
}) {
    const mentions = yield* mentionsOf(input.after.id);
    const lines = [
        `<b>${text(input.locale, 'changed')}</b>`,
        `<s>${escapeHtml(formatSessionLabel(input.locale, input.before))}</s>`,
        `➡️ <b>${escapeHtml(formatSessionLabel(input.locale, input.after))}</b>`,
        ...(isEmptyString(mentions) ? [] : [mentions])
    ];

    yield* post(input.chatId, lines.join('\n'));
});

export const notifySessionCancelled = Effect.fn('Core.notifySessionCancelled')(function* (input: {
    readonly target: SessionView;
    readonly reason: string;
    readonly chatId: bigint;
    readonly locale: Locale;
}) {
    const mentions = yield* mentionsOf(input.target.id);
    const lines = [
        `<b>${text(input.locale, 'cancelled')}: ${escapeHtml(formatSessionLabel(input.locale, input.target))}</b>`,
        `${text(input.locale, 'reason')}: ${escapeHtml(cancelReasonText(input.locale, input.reason))}`,
        ...(isEmptyString(mentions) ? [] : [mentions])
    ];

    yield* post(input.chatId, lines.join('\n'));
});

export const notifyPromoted = Effect.fn('Core.notifyPromoted')(function* (input: {
    readonly target: SessionView;
    readonly promoted: readonly PromotedPlayer[];
    readonly chatId: bigint;
    readonly locale: Locale;
}) {
    if (!isNotEmptyArray(input.promoted)) {
        return;
    }

    const names = input.promoted
        .map(player => (isDefined(player.tgUserId) ? mentionHtml(player.tgUserId, player.displayName) : escapeHtml(player.displayName)))
        .join(', ');

    yield* post(
        input.chatId,
        `🎉 ${names}, ${text(input.locale, 'promoted')} ${escapeHtml(formatSessionLabel(input.locale, input.target))}`
    );
});
