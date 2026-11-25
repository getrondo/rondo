import { isDefined, isNotEmptyString } from '@rnw-community/shared';
import {
    clearAdminState,
    consumeAdminState,
    moveAdminMessage,
    restoreAdminState,
    saveAdminState,
    takeAwaiting
} from '@rondo/core/menu/admin-state.repository';
import { escapeHtml } from '@rondo/telegram/format/html';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { gameCardScreen } from '../games.screen';
import { homeScreen } from '../home.screen';
import { menuText } from '../menu-text';
import { runConfirmed } from '../run-confirmed';
import { clearKeyboard, showScreen } from '../show-screen';
import { replyStale } from '../stale-reply';

import { audienceOfDraft, destinationTitles, isSelfAudience } from './audience';
import { loadNewGameData } from './new-game.data';
import { applyOp, awaitingOf, startDraft } from './new-game.flow';
import { newGameKeyboard } from './new-game.keyboard';
import { actionOf, newGameText, withSummary } from './new-game.screen';
import { applyPlaceInput } from './place-input';
import { applyText } from './typed-input';

import type { MenuUser } from '../screen.interface';
import type { Draft, NewGameData, TypedInput } from './draft';
import type { AdminStateRow } from '@rondo/core/menu/admin-state.interface';

const presentNewGame = Effect.fn('Bot.presentNewGame')(function* (
    user: MenuUser,
    draft: Draft,
    data: NewGameData,
    messageId: number | null
) {
    const prepared = yield* withSummary(user, draft, data);
    const saved = yield* saveAdminState({
        tgUserId: user.tgUserId,
        communityId: user.communityId,
        messageId,
        awaiting: awaitingOf(prepared),
        draft: prepared,
        now: user.now
    });
    const text = yield* newGameText(user, prepared, data);
    const shownId = yield* showScreen(user.chatId, messageId, {
        text,
        keyboard: newGameKeyboard(prepared, data, user.locale, saved.revision)
    });

    if (shownId !== messageId) {
        yield* moveAdminMessage(user.tgUserId, shownId);
    }
});

export const openNewGame = Effect.fn('Bot.openNewGame')(function* (user: MenuUser, messageId: number | null) {
    const data = yield* loadNewGameData(user);

    yield* presentNewGame(user, startDraft(data), data, messageId);
});

const resultLines = Effect.fn('Bot.resultLines')(function* (user: MenuUser, draft: Draft, data: NewGameData, sessionId: string) {
    const titles = destinationTitles(draft, data);
    const [firstTitle = ''] = titles;
    const lines = [menuText(user.locale, isDefined(draft.sessionId) ? 'announced' : 'created', { where: escapeHtml(`«${firstTitle}»`) })];
    const forwards = data.chats.filter(chat => audienceOfDraft(draft, data).slice(1).includes(chat.id));

    for (const chat of forwards) {
        const where = `«${chat.title}»`;
        const forwarded = yield* runConfirmed(
            user,
            { _tag: 'forward_poll', sessionId, chatId: chat.id },
            { summary: null, target: { where, isPrivate: false } }
        );
        lines.push(
            forwarded._tag === 'done'
                ? menuText(user.locale, 'forwardedTo', { where: escapeHtml(where) })
                : menuText(user.locale, 'forwardFailed', { where: escapeHtml(where), reason: forwarded.text.replace(/^⚠️ /u, '') })
        );
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
        return yield* replyStale(user, tap.messageId, true);
    }

    const data = yield* loadNewGameData(user);
    const { messageId, withPoll } = tap;
    const self = withPoll && isSelfAudience(draft, data);
    const [firstTitle = ''] = destinationTitles(draft, data);
    const target = { where: `«${firstTitle}»`, isPrivate: self };
    const outcome = yield* runConfirmed(user, actionOf(draft, withPoll, data), { summary: withPoll ? draft.summary : null, target });

    if (outcome._tag === 'failed' || !isDefined(outcome.sessionId)) {
        yield* restoreAdminState(consumed.value, user.now);
        const failed = outcome._tag === 'failed' ? { notice: outcome.text, uncertain: outcome.uncertain } : {};
        yield* presentNewGame(user, { ...draft, ...failed }, data, messageId);

        return Option.none<string>();
    }

    if (self) {
        const header = [menuText(user.locale, isDefined(draft.sessionId) ? 'announcedMe' : 'createdMe'), menuText(user.locale, 'selfHint')];
        yield* clearKeyboard(user.chatId, messageId);
        const card = yield* gameCardScreen(user, outcome.sessionId, header.join('\n'));
        yield* showScreen(user.chatId, null, card);

        return Option.none<string>();
    }

    const lines = withPoll ? yield* resultLines(user, draft, data, outcome.sessionId) : [menuText(user.locale, 'createdQuiet')];
    const card = yield* gameCardScreen(user, outcome.sessionId, lines.join('\n'));
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
        yield* clearAdminState(user.tgUserId);
        const home = yield* homeScreen(user);
        yield* showScreen(user.chatId, tap.messageId, home);

        return Option.none<string>();
    }

    const data = yield* loadNewGameData(user);
    yield* presentNewGame(user, applyOp(draft, tap.op, tap.arg, data), data, tap.messageId);

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

    if (placeInput) {
        const placed = yield* applyPlaceInput(user, draft, input);
        const fresh = yield* loadNewGameData(user);
        yield* presentNewGame(user, placed, fresh, null);

        return true;
    }

    const next = outcome?._tag === 'draft' ? outcome.draft : { ...draft, notice: outcome?._tag === 'invalid' ? outcome.notice : null };
    yield* presentNewGame(user, next, data, null);

    return true;
});
