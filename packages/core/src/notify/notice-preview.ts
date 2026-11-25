import { isDefined } from '@rnw-community/shared';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Predicate from 'effect/Predicate';

import { displayOfVenue } from '../actions/describe-action';
import { ActionFailedError } from '../error/action-failed.error';
import { requireSession } from '../sessions/session.service';
import { noticeTargets } from '../signups/audience';

import { sessionCancelledHtml, sessionChangedHtml } from './notifier';

import type { Action } from '../actions/action.model';
import type { ActionContext } from '../actions/execute-action';
import type { GroupTarget } from '../interface/group-target.interface';
import type { SessionView } from '../sessions/session.model';

type NoticeContext = Pick<ActionContext, 'communityId' | 'group' | 'groupLocale' | 'requester'>;

type NoticeAction = Extract<Action, { _tag: 'update_session' | 'cancel_session' }>;

export const isNoticeAction = (action: Action): action is NoticeAction =>
    action._tag === 'update_session' || action._tag === 'cancel_session';

const afterChange = Effect.fn('Core.afterChange')(function* (game: SessionView, action: Extract<Action, { _tag: 'update_session' }>) {
    const display = isDefined(action.venueId) ? yield* displayOfVenue(action.venueId, game.communityId) : {};

    return {
        ...game,
        ...display,
        localDate: action.localDate ?? game.localDate,
        localTime: action.localTime ?? game.localTime,
        capacityMax: Predicate.isUndefined(action.capacityMax) ? game.capacityMax : action.capacityMax,
        venueId: action.venueId ?? game.venueId
    };
});

export const previewedTargets = (action: NoticeAction): readonly GroupTarget[] =>
    action.preview?.targets.map(target => ({ chatId: BigInt(target.chatId), topicId: target.topicId })) ?? [];

const noticeTargetsOf = Effect.fn('Core.noticeTargetsOf')(function* (context: NoticeContext, sessionId: string) {
    const requester = isDefined(context.requester) ? [{ chatId: context.requester, topicId: null }] : [];

    return yield* noticeTargets(sessionId, Option.isSome(context.group) ? [context.group.value] : requester, requester);
});

const noticeHtml = Effect.fn('Core.noticeHtml')(function* (action: NoticeAction, game: SessionView, context: NoticeContext) {
    const locale = context.groupLocale;

    switch (action._tag) {
        case 'update_session': {
            return yield* sessionChangedHtml({ before: game, after: yield* afterChange(game, action), locale });
        }
        case 'cancel_session': {
            return yield* sessionCancelledHtml({ target: game, reason: action.reason, locale });
        }
        default: {
            return yield* Effect.die(new Error('not a notice'));
        }
    }
});

export const noticeOf = Effect.fn('Core.noticeOf')(function* (action: NoticeAction, context: NoticeContext) {
    const game = yield* requireSession(context.communityId, action.sessionId);
    const html = yield* noticeHtml(action, game, context);
    const targets = yield* noticeTargetsOf(context, action.sessionId);

    return { html, targets: targets.map(target => ({ chatId: String(target.chatId), topicId: target.topicId })) };
});

export const withNotice = Effect.fn('Core.withNotice')(function* (action: Action, context: NoticeContext) {
    return isNoticeAction(action) && action.notify ? { ...action, preview: yield* noticeOf(action, context) } : action;
});

export const requirePreviewed = Effect.fn('Core.requirePreviewed')(function* (action: NoticeAction, context: NoticeContext) {
    if (!action.notify) {
        return action;
    }

    if (!isDefined(action.preview)) {
        return yield* ActionFailedError.make({ failure: { code: 'preview_changed' } });
    }

    const current = yield* noticeOf(action, context);

    if (current.html !== action.preview.html || JSON.stringify(current.targets) !== JSON.stringify(action.preview.targets)) {
        return yield* ActionFailedError.make({ failure: { code: 'preview_changed' } });
    }

    return action;
});
