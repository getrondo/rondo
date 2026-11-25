import { isDefined, isNotEmptyString } from '@rnw-community/shared';
import {
    clearAdminState,
    consumeAdminState,
    loadAdminState,
    moveAdminMessage,
    takeAwaiting
} from '@rondo/core/menu/admin-state.repository';
import { escapeHtml } from '@rondo/telegram/format/html';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

import { gameCardScreen } from '../games.screen';
import { homeScreen } from '../home.screen';
import { menuText } from '../menu-text';
import { runConfirmed } from '../run-confirmed';
import { clearKeyboard, showScreen } from '../show-screen';
import { rememberDone, replyStale } from '../stale-reply';
import { writeState } from '../write-state';

import { audienceOfDraft } from './audience';
import { DraftSchema, type Draft, type NewGameData, type TypedInput } from './draft';
import { loadNewGameData } from './new-game.data';
import { applyOp, awaitingOf, startDraft } from './new-game.flow';
import { newGameKeyboard } from './new-game.keyboard';
import { actionOf, newGameText, withSummary } from './new-game.screen';
import { applyPlaceInput } from './place-input';
import { showSelfReceipt } from './self-receipt';
import { applyText } from './typed-input';

import type { MenuUser } from '../screen.interface';
import type { AdminStateRow } from '@rondo/core/menu/admin-state.interface';

const decodeDraft = Schema.decodeUnknownOption(DraftSchema);

const targetsOf = (draft: Draft, data: NewGameData): Draft['targets'] =>
    audienceOfDraft(draft, data).map(id => {
        const chat = data.chats.find(entry => entry.id === id);

        return { id, title: chat?.title ?? '', topicId: chat?.topicId ?? null };
    });

const presentNewGame = Effect.fn('Bot.presentNewGame')(function* (
    user: MenuUser,
    draft: Draft,
    data: NewGameData,
    at: { readonly messageId: number | null; readonly expected: number | null }
) {
    const { messageId } = at;
    const prepared = yield* withSummary(user, { ...draft, targets: targetsOf(draft, data) }, data);
    const saved = yield* writeState(user, { messageId, awaiting: awaitingOf(prepared), draft: prepared }, at.expected);

    if (Option.isNone(saved)) {
        return;
    }

    const text = yield* newGameText(user, prepared, data);
    const shownId = yield* showScreen(user.chatId, messageId, {
        text,
        keyboard: newGameKeyboard(prepared, data, user.locale, saved.value.revision)
    });

    if (shownId !== messageId) {
        yield* moveAdminMessage(user.tgUserId, shownId, saved.value.revision);
    }
});

export const openNewGame = Effect.fn('Bot.openNewGame')(function* (user: MenuUser, messageId: number | null) {
    const data = yield* loadNewGameData(user);

    yield* presentNewGame(user, startDraft(data), data, { messageId, expected: null });
});

const clearOld = (user: MenuUser, messageId: number | null) => (isDefined(messageId) ? clearKeyboard(user.chatId, messageId) : Effect.void);

const reopenNewGame = Effect.fn('Bot.reopenNewGame')(function* (user: MenuUser) {
    const state = yield* loadAdminState(user.tgUserId, user.now);
    const draft = state.pipe(Option.flatMap(row => decodeDraft(row.draft)));

    if (Option.isSome(draft)) {
        const data = yield* loadNewGameData(user);
        const row = Option.getOrNull(state);
        yield* clearOld(user, row?.messageId ?? null);
        yield* presentNewGame(user, draft.value, data, { messageId: null, expected: row?.revision ?? null });
    }
});

export const showNotUnderstood = Effect.fn('Bot.showNotUnderstood')(function* (user: MenuUser) {
    yield* showScreen(user.chatId, null, {
        text: menuText(user.locale, 'notUnderstood'),
        keyboard: [
            [
                { text: menuText(user.locale, 'newGame'), callback_data: 'm:ng' },
                { text: menuText(user.locale, 'games'), callback_data: 'm:gl' }
            ]
        ]
    });
    yield* reopenNewGame(user);
});

const forwardLine = (
    user: MenuUser,
    where: string,
    forwarded: { readonly _tag: 'done' } | { readonly _tag: 'failed'; readonly text: string; readonly uncertain: boolean }
): string => {
    if (forwarded._tag === 'done') {
        return menuText(user.locale, 'forwardedTo', { where: escapeHtml(where) });
    }

    return forwarded.uncertain
        ? forwarded.text
        : menuText(user.locale, 'forwardFailed', { where: escapeHtml(where), reason: forwarded.text.replace(/^⚠️ /u, '') });
};

const failureOf = (
    outcome: { readonly _tag: 'done' } | { readonly _tag: 'failed'; readonly text: string; readonly uncertain: boolean }
) => {
    if (outcome._tag === 'done') {
        return {};
    }

    return outcome.uncertain ? { warning: outcome.text, uncertain: true, notice: null } : { notice: outcome.text };
};

const resultLines = Effect.fn('Bot.resultLines')(function* (user: MenuUser, draft: Draft, sessionId: string) {
    const [first, ...forwards] = draft.targets;
    const lines = [
        menuText(user.locale, isDefined(draft.sessionId) ? 'announced' : 'created', { where: escapeHtml(`«${first?.title ?? ''}»`) })
    ];

    for (const chat of forwards) {
        const where = `«${chat.title}»`;
        const target = { where, isPrivate: false };
        const forwarded = yield* runConfirmed(user, { _tag: 'forward_poll', sessionId, chatId: chat.id }, { summary: null, target });
        lines.push(forwardLine(user, where, forwarded));
    }

    return lines;
});

const confirm = Effect.fn('Bot.confirmNewGame')(function* (
    user: MenuUser,
    row: AdminStateRow,
    draft: Draft,
    tap: { readonly withPoll: boolean; readonly messageId: number }
) {
    const consumed = yield* consumeAdminState(user.tgUserId, row.revision, user.now);

    if (Option.isNone(consumed)) {
        return yield* replyStale(user, tap.messageId, String(row.revision));
    }

    const data = yield* loadNewGameData(user);
    const { messageId, withPoll } = tap;
    const [first] = draft.targets;
    const self = withPoll && (first?.id ?? data.selfChatId) === data.selfChatId;
    const target = { where: `«${first?.title ?? ''}»`, isPrivate: self };
    const outcome = yield* runConfirmed(user, actionOf(draft, withPoll, data), { summary: withPoll ? draft.summary : null, target });

    if (outcome._tag === 'failed' || !isDefined(outcome.sessionId)) {
        yield* presentNewGame(user, { ...draft, ...failureOf(outcome) }, data, { messageId, expected: consumed.value.revision });

        return Option.none<string>();
    }

    const done = { sessionId: outcome.sessionId, created: !isDefined(draft.sessionId), revision: String(row.revision) };

    if (self) {
        yield* rememberDone(user, { messageId, expected: consumed.value.revision }, { ...done, self: true });
        yield* showSelfReceipt(user, messageId, { sessionId: outcome.sessionId, status: done.created ? 'receiptMe' : 'sentMe' });

        return Option.none<string>();
    }

    yield* rememberDone(user, { messageId, expected: consumed.value.revision }, { ...done, self: false });
    const lines = withPoll ? yield* resultLines(user, draft, outcome.sessionId) : [menuText(user.locale, 'createdQuiet')];
    const card = yield* gameCardScreen(user, outcome.sessionId, { text: lines.join('\n'), saysPoll: withPoll });
    yield* showScreen(user.chatId, messageId, card);

    return Option.none<string>();
});

export const handleNewGameTap = Effect.fn('Bot.handleNewGameTap')(function* (
    user: MenuUser,
    row: AdminStateRow,
    draft: Draft,
    tap: { readonly op: string; readonly arg: string; readonly messageId: number }
) {
    if (tap.op === 'ok' || tap.op === 'sv') {
        return yield* confirm(user, row, draft, { withPoll: tap.op === 'ok', messageId: tap.messageId });
    }

    if (tap.op === 'x') {
        yield* clearAdminState(user.tgUserId, { messageId: tap.messageId, now: user.now });
        const home = yield* homeScreen(user);
        yield* showScreen(user.chatId, tap.messageId, home);

        return Option.none<string>();
    }

    const data = yield* loadNewGameData(user);
    const next = tap.op === 'redraw' ? draft : applyOp(draft, tap.op, tap.arg, data);
    yield* presentNewGame(user, next, data, { messageId: tap.messageId, expected: row.revision });

    return Option.none<string>();
});

export const handleNewGameInput = Effect.fn('Bot.handleNewGameInput')(function* (
    user: MenuUser,
    row: AdminStateRow,
    draft: Draft,
    input: TypedInput
) {
    const data = yield* loadNewGameData(user);
    const placeInput = ['venue_name', 'map', 'address'].includes(draft.view);
    const outcome = placeInput ? null : applyText(draft, input.text ?? '', data);

    if ((outcome?._tag === 'pass' || !isNotEmptyString(input.text)) && !placeInput) {
        return false;
    }

    const taken = yield* takeAwaiting(user.tgUserId, row.revision, user.now);

    if (Option.isNone(taken)) {
        return false;
    }

    yield* clearOld(user, row.messageId);

    if (placeInput) {
        const placed = yield* applyPlaceInput(user, draft, input);
        const fresh = yield* loadNewGameData(user);
        yield* presentNewGame(user, placed, fresh, { messageId: null, expected: taken.value.revision });

        return true;
    }

    const next = outcome?._tag === 'draft' ? outcome.draft : { ...draft, notice: outcome?._tag === 'invalid' ? outcome.notice : null };
    yield* presentNewGame(user, next, data, { messageId: null, expected: taken.value.revision });

    return true;
});
