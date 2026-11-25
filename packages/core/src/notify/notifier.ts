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
import { placeHtml, placeOf } from '../signups/place-block';
import { topicOptions } from '../utils/topic-options.util';

import type { Locale } from '../i18n/locale';
import type { GroupTarget } from '../interface/group-target.interface';
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

const placeLines = (target: SessionView): string[] => {
    const html = placeHtml(placeOf(target));

    return isEmptyString(html) ? [] : [html];
};

const post = Effect.fn('Core.post')(function* (group: GroupTarget, html: string, locale: Locale) {
    const telegram = yield* Telegram;
    const body = group.chatId > 0n ? `${html}\n\n${text(locale, 'forwardHint')}` : html;

    yield* telegram.call('sendMessage', api => api.sendMessage(Number(group.chatId), body, { parse_mode: 'HTML', ...topicOptions(group) }));
});

export const sessionChangedHtml = Effect.fn('Core.sessionChangedHtml')(function* (input: {
    readonly before: SessionView;
    readonly after: SessionView;
    readonly locale: Locale;
}) {
    const mentions = yield* mentionsOf(input.after.id);

    return [
        `<b>${text(input.locale, 'changed')}</b>`,
        `<s>${escapeHtml(formatSessionLabel(input.locale, input.before))}</s>`,
        `➡️ <b>${escapeHtml(formatSessionLabel(input.locale, input.after))}</b>`,
        ...(input.before.capacityMax === input.after.capacityMax
            ? []
            : [`👥 ${text(input.locale, 'placesWord')}: ${input.before.capacityMax ?? '♾'} → ${input.after.capacityMax ?? '♾'}`]),
        ...placeLines(input.after),
        ...(isEmptyString(mentions) ? [] : [mentions])
    ].join('\n');
});

export const notifySessionChanged = Effect.fn('Core.notifySessionChanged')(function* (input: {
    readonly before: SessionView;
    readonly after: SessionView;
    readonly group: GroupTarget;
    readonly locale: Locale;
}) {
    const html = yield* sessionChangedHtml(input);

    yield* post(input.group, html, input.locale);
});

export const sessionCancelledHtml = Effect.fn('Core.sessionCancelledHtml')(function* (input: {
    readonly target: SessionView;
    readonly reason: string;
    readonly locale: Locale;
}) {
    const mentions = yield* mentionsOf(input.target.id);

    return [
        `<b>${text(input.locale, 'cancelled')}: ${escapeHtml(formatSessionLabel(input.locale, input.target))}</b>`,
        `${text(input.locale, 'reason')}: ${escapeHtml(cancelReasonText(input.locale, input.reason))}`,
        ...(isEmptyString(mentions) ? [] : [mentions])
    ].join('\n');
});

export const notifySessionCancelled = Effect.fn('Core.notifySessionCancelled')(function* (input: {
    readonly target: SessionView;
    readonly reason: string;
    readonly group: GroupTarget;
    readonly locale: Locale;
}) {
    const html = yield* sessionCancelledHtml(input);

    yield* post(input.group, html, input.locale);
});

export const notifyPromoted = Effect.fn('Core.notifyPromoted')(function* (input: {
    readonly target: SessionView;
    readonly promoted: readonly PromotedPlayer[];
    readonly group: GroupTarget;
    readonly locale: Locale;
}) {
    if (!isNotEmptyArray(input.promoted)) {
        return;
    }

    const names = input.promoted
        .map(player => (isDefined(player.tgUserId) ? mentionHtml(player.tgUserId, player.displayName) : escapeHtml(player.displayName)))
        .join(', ');

    yield* post(
        input.group,
        `🎉 ${names}, ${text(input.locale, 'promoted')} ${escapeHtml(formatSessionLabel(input.locale, input.target))}`,
        input.locale
    );
});
