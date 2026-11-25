import { isDefined, isNotEmptyString } from '@rnw-community/shared';
import {
    clearAdminState,
    consumeAdminState,
    moveAdminMessage,
    restoreAdminState,
    saveAdminState,
    takeAwaiting
} from '@rondo/core/menu/admin-state.repository';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { gameCardScreen } from '../games.screen';
import { homeScreen } from '../home.screen';
import { menuText } from '../menu-text';
import { runConfirmed } from '../run-confirmed';
import { showScreen } from '../show-screen';

import { loadNewGameData } from './new-game.data';
import { applyOp, applyText, audienceOfDraft, awaitingOf, destinationOf, isSelfAudience, startDraft } from './new-game.flow';
import { newGameKeyboard } from './new-game.keyboard';
import { actionOf, newGameText, withSummary } from './new-game.screen';
import { applyPlaceInput } from './place-input';

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

const confirm = Effect.fn('Bot.confirmNewGame')(function* (
    user: MenuUser,
    row: AdminStateRow,
    draft: Draft,
    tap: { readonly withPoll: boolean; readonly messageId: number }
) {
    const consumed = yield* consumeAdminState(user.tgUserId, row.revision, user.now);

    if (Option.isNone(consumed)) {
        return Option.some(menuText(user.locale, 'stale'));
    }

    const data = yield* loadNewGameData(user);
    const { messageId } = tap;
    const announce = tap.withPoll;
    const outcome = yield* runConfirmed(user, actionOf(draft, announce, data), announce ? draft.summary : null);

    if (outcome._tag === 'failed' || !isDefined(outcome.sessionId)) {
        yield* restoreAdminState(consumed.value, user.now);
        yield* presentNewGame(user, { ...draft, notice: outcome._tag === 'failed' ? outcome.text : null }, data, messageId);

        return Option.none<string>();
    }

    const self = isSelfAudience(draft, data);
    const where = destinationOf(draft, data);
    const forwards = announce && !isSelfAudience(draft, data) ? audienceOfDraft(draft, data).slice(1) : [];
    const failures: string[] = [];

    for (const chatId of forwards) {
        const forwarded = yield* runConfirmed(user, { _tag: 'forward_poll', sessionId: outcome.sessionId, chatId }, null);

        if (forwarded._tag === 'failed') {
            failures.push(forwarded.text);
        }
    }

    const results = { announced: self ? 'announcedMe' : 'announced', created: self ? 'createdMe' : 'created' } as const;
    const result = isDefined(draft.sessionId) ? results.announced : results.created;
    const header = [
        menuText(user.locale, announce ? result : 'createdQuiet', { where }),
        ...(announce && self ? [menuText(user.locale, 'selfHint')] : []),
        ...failures
    ].join('\n');
    const card = yield* gameCardScreen(user, outcome.sessionId, header);
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
