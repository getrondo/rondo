import { isDefined, isNotEmptyArray, isNotEmptyString } from '@rnw-community/shared';
import { describeAction, displayOfVenue } from '@rondo/core/actions/describe-action';
import { requireSession } from '@rondo/core/sessions/session.service';
import { pollFor } from '@rondo/core/signups/poll-for';
import { escapeHtml } from '@rondo/telegram/format/html';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { buttonBudget } from '../../utils/button-budget.util';
import { dayLabel } from '../../utils/day-label.util';
import { labelWidth } from '../../utils/label-width.util';
import { isMenuKey, menuText, type MenuKey } from '../menu-text';

import { audienceOfDraft, destinationTitles, isSelfAudience, quotedTitles } from './audience';
import { otherGameLabel, venueLabel } from './new-game.keyboard';

import type { MenuUser } from '../screen.interface';
import type { Draft, NewGameData } from './draft';
import type { Action } from '@rondo/core/actions/action.model';
import type { PollText } from '@rondo/core/interface/poll.interface';

const prompts: Partial<Record<Draft['view'], MenuKey>> = {
    day: 'pickDay',
    place: 'pickPlace',
    venues: 'allPlaces',
    venue_name: 'newPlaceName',
    time: 'pickTime',
    size: 'pickSize',
    note: 'pickNote',
    dest: 'where'
};

export const actionOf = (draft: Draft, announce: boolean, data: NewGameData): Action => {
    const [first] = draft.targets;
    const chatId = first?.id ?? audienceOfDraft(draft, data)[0] ?? data.selfChatId;
    const target = chatId === data.selfChatId ? { chatId } : { chatId, topicId: first?.topicId ?? null };

    return isDefined(draft.sessionId)
        ? { _tag: 'announce_session', sessionId: draft.sessionId, ...target }
        : {
              _tag: 'create_session',
              localDate: draft.localDate ?? '',
              localTime: draft.localTime ?? '',
              venueId: draft.venueId,
              capacityMax: draft.places,
              fieldsPlanned: draft.fields,
              title: null,
              note: draft.note,
              announce,
              ...(announce ? target : {})
          };
};

const pollOf = Effect.fn('Bot.pollOf')(function* (user: MenuUser, draft: Draft) {
    if (isDefined(draft.sessionId)) {
        const target = yield* requireSession(user.communityId, draft.sessionId);

        return yield* pollFor(user.communityId, target, null);
    }

    const display = yield* displayOfVenue(draft.venueId);
    const game = {
        localDate: draft.localDate ?? '',
        localTime: draft.localTime ?? '',
        fieldsPlanned: draft.fields,
        capacityMax: draft.places
    };

    return yield* pollFor(user.communityId, { ...game, ...display }, draft.note);
});

export const pollHtml = (poll: PollText): string => {
    const answers = poll.answers.map(answer => `▫️ ${escapeHtml(answer)}`).join('\n');

    return `<blockquote>${[escapeHtml(poll.question), ...(isDefined(poll.description) ? [poll.description] : []), answers].join('\n\n')}</blockquote>`;
};

export const withSummary = Effect.fn('Bot.withSummary')(function* (user: MenuUser, draft: Draft, data: NewGameData) {
    if (draft.view !== 'main') {
        return draft;
    }

    return yield* describeAction(actionOf(draft, true, data), user.locale, user.communityId).pipe(
        Effect.map(summary => ({ ...draft, summary })),
        Effect.catchTag('ActionFailedError', error => Effect.succeed({ ...draft, summary: null, notice: error.reason }))
    );
});

const noticeText = (user: MenuUser, notice: string | null): string[] =>
    isNotEmptyString(notice) ? [isMenuKey(notice) ? menuText(user.locale, notice) : notice] : [];

const selection = (user: MenuUser, draft: Draft, data: NewGameData): string =>
    [
        ...(isDefined(draft.localDate) ? [dayLabel(user.locale, draft.localDate)] : []),
        ...(isDefined(draft.localTime) ? [draft.localTime] : []),
        ...(isDefined(draft.venueId) ? [venueLabel(data, draft.venueId)] : []),
        ...(draft.sized ? [`👥 ${draft.places ?? '♾'}`] : [])
    ].join(' · ');

const destinationLine = (user: MenuUser, draft: Draft, data: NewGameData): string =>
    isSelfAudience(draft, data)
        ? menuText(user.locale, 'selfLine')
        : menuText(user.locale, 'destLine', { where: escapeHtml(quotedTitles(destinationTitles(draft, data), user.locale)) });

const otherGameLine = (user: MenuUser, draft: Draft, data: NewGameData): string[] => {
    const other = otherGameLabel(data, draft, user.locale);

    return isDefined(other) && labelWidth(other.label) > buttonBudget(1)
        ? [menuText(user.locale, 'otherGameLine', { what: escapeHtml(other.full) })]
        : [];
};

const lastLines = (user: MenuUser, draft: Draft): string[] => {
    const lines = [...noticeText(user, draft.notice), ...(isDefined(draft.warning) ? [draft.warning] : [])];

    return isNotEmptyArray(lines) ? lines : [`<i>${menuText(user.locale, 'nothingSent')}</i>`];
};

const mainText = Effect.fn('Bot.newGameMainText')(function* (user: MenuUser, draft: Draft, data: NewGameData) {
    const poll = yield* pollOf(user, draft).pipe(Effect.option);
    const duplicate = data.planned.some(game => game.localDate === draft.localDate && game.sessionId !== draft.sessionId);

    return [
        menuText(user.locale, isDefined(draft.sessionId) ? 'ngAnnounce' : 'ngTitle'),
        ...Option.match(poll, { onNone: () => [], onSome: value => [pollHtml(value)] }),
        destinationLine(user, draft, data),
        ...(duplicate && isDefined(draft.localDate)
            ? [menuText(user.locale, 'duplicate', { label: dayLabel(user.locale, draft.localDate) })]
            : []),
        ...otherGameLine(user, draft, data),
        ...(data.typingHint && !isDefined(draft.sessionId) ? [menuText(user.locale, 'typingHint')] : []),
        ...lastLines(user, draft)
    ].join('\n');
});

export const newGameText = Effect.fn('Bot.newGameText')(function* (user: MenuUser, draft: Draft, data: NewGameData) {
    if (draft.view === 'main') {
        return yield* mainText(user, draft, data);
    }

    const prompt = prompts[draft.view];
    const venueName = data.venues.find(entry => entry.id === draft.venueId)?.name ?? '';
    const ask = isDefined(prompt) ? menuText(user.locale, prompt) : menuText(user.locale, 'pin', { name: escapeHtml(venueName) });
    const chosen = selection(user, draft, data);
    const title = isNotEmptyString(chosen)
        ? `${menuText(user.locale, 'newGame')}: ${escapeHtml(chosen)}`
        : menuText(user.locale, 'newGame');
    const notice = noticeText(user, draft.notice);
    const heading = draft.notice === 'tooLittle' ? [] : [title];
    const extra = draft.view === 'size' ? [menuText(user.locale, 'fieldsOptional')] : [];

    return [...heading, ...(isNotEmptyArray(notice) ? notice : [ask, ...extra])].join('\n');
});
