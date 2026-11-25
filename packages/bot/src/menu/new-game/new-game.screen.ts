import { isDefined, isNotEmptyString } from '@rnw-community/shared';
import { describeAction, displayOfVenue } from '@rondo/core/actions/describe-action';
import { communityProfile } from '@rondo/core/community/community.repository';
import { requireSession } from '@rondo/core/sessions/session.service';
import { placeHtml } from '@rondo/core/signups/place-block';
import { pollFor } from '@rondo/core/signups/poll-for';
import { escapeHtml } from '@rondo/telegram/format/html';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { dayLabel } from '../../utils/day-label.util';
import { isMenuKey, menuText, type MenuKey } from '../menu-text';

import { audienceOfDraft } from './new-game.flow';
import { venueLabel } from './new-game.keyboard';

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
    note: 'pickNote'
};

export const actionOf = (draft: Draft, announce: boolean, data: NewGameData): Action => {
    const [chatId] = audienceOfDraft(draft, data);
    const target = isDefined(chatId) && (data.chats.length > 1 || chatId === data.selfChatId) ? { chatId } : {};

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

export const pollHtml = (poll: PollText): string =>
    [
        `<blockquote>${escapeHtml(poll.question)}\n\n${poll.answers.map(answer => `▫️ ${escapeHtml(answer)}`).join('\n')}</blockquote>`,
        ...(isDefined(poll.place) ? [placeHtml(poll.place)] : []),
        ...(isDefined(poll.route) ? [`<a href="${escapeHtml(poll.route.url)}">${poll.route.label}</a>`] : [])
    ].join('\n');

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

const mainText = Effect.fn('Bot.newGameMainText')(function* (user: MenuUser, draft: Draft, data: NewGameData) {
    const profile = yield* communityProfile(user.communityId);
    const slug = Option.match(profile, { onNone: () => '', onSome: value => value.slug });
    const poll = yield* pollOf(user, draft).pipe(Effect.option);
    const venue = data.venues.find(entry => entry.id === draft.venueId);
    const duplicate = data.planned.some(game => game.localDate === draft.localDate && game.sessionId !== draft.sessionId);
    const warnings = [
        ...(data.hasGroup ? [] : [menuText(user.locale, 'noGroup', { slug: escapeHtml(slug) })]),
        ...(isDefined(venue) && !venue.located && !isDefined(draft.sessionId) ? [menuText(user.locale, 'noAddress')] : []),
        ...(duplicate && isDefined(draft.localDate)
            ? [menuText(user.locale, 'duplicate', { label: dayLabel(user.locale, draft.localDate) })]
            : [])
    ];

    return [
        menuText(user.locale, isDefined(draft.sessionId) ? 'ngAnnounce' : 'ngTitle'),
        '',
        ...Option.match(poll, { onNone: () => [], onSome: value => [pollHtml(value)] }),
        '',
        ...warnings,
        ...noticeText(user, draft.notice),
        `<i>${menuText(user.locale, 'nothingSent')}</i>`
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
    const heading = draft.notice === 'tooLittle' ? [] : [title];

    return [...heading, ...noticeText(user, draft.notice), ask].join('\n');
});
