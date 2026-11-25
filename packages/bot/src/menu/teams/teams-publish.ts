import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { groupLocaleOf, mainGroupOf } from '@rondo/core/community/community.repository';
import { formatSessionLabel } from '@rondo/core/i18n/messages';
import { placementOf, postOf, postTeamsOf, publishedPlacement } from '@rondo/core/teams/lineup-of-draft';
import { lineupDiff, lineupPostHtml } from '@rondo/core/teams/lineup-post';
import { publishLineup } from '@rondo/core/teams/publish-lineup';
import { escapeHtml } from '@rondo/telegram/format/html';
import { Telegram } from '@rondo/telegram/service/telegram.service';
import * as Effect from 'effect/Effect';

import { toShortId } from '../../utils/to-short-id.util';

import { teamsData } from './teams-callback';
import { destinationLabel, editorScreen } from './teams-editor.screen';
import { teamsText } from './teams-text';
import { actorOf, loadView } from './teams-view';

import type { MenuUser, Screen } from '../screen.interface';
import type { EditorView } from './teams-view.interface';
import type { PublishOutcome } from '@rondo/core/teams/interface/publish.interface';

const postHtmlOf = Effect.fn('Bot.teamsPostHtml')(function* (user: MenuUser, view: EditorView) {
    const locale = yield* groupLocaleOf(user.communityId);
    const teams = postTeamsOf(view.row.state, view.inputs.members);

    return {
        teams,
        html: lineupPostHtml(postOf(view.inputs.game, teams, { locale, showHandles: view.inputs.settings.showHandles, isUpdate: false }))
    };
});

export const previewScreen = Effect.fn('Bot.teamsPreview')(function* (user: MenuUser, view: EditorView) {
    const { teams, html } = yield* postHtmlOf(user, view);
    const before = isDefined(view.row.publishedAt) ? yield* publishedPlacement(view.row.sessionId) : [];
    const diff = isDefined(view.row.publishedAt) ? lineupDiff(before, placementOf(teams)) : [];
    const isSame = isDefined(view.row.publishedAt) && (view.audience.isPrivate ? view.row.privateText === html : !isNotEmptyArray(diff));
    const base = { sessionId: view.row.sessionId, version: view.row.version, page: view.page };

    return {
        text: [
            teamsText(user.locale, 'title', { label: escapeHtml(formatSessionLabel(user.locale, view.inputs.game)) }),
            teamsText(user.locale, 'preview'),
            `<blockquote>${html}</blockquote>`,
            ...(isNotEmptyArray(diff) ? [teamsText(user.locale, 'changes'), escapeHtml(diff.join('\n'))] : []),
            teamsText(user.locale, isSame ? 'unchanged' : 'quiet')
        ].join('\n'),
        keyboard: [
            ...(isSame ? [] : [[{ text: destinationLabel(user, view), callback_data: teamsData(base, 'X') }]]),
            [{ text: teamsText(user.locale, 'toEditor'), callback_data: teamsData(base, 'e') }]
        ]
    } satisfies Screen;
});

const outcomeNotes = (user: MenuUser, outcome: PublishOutcome): string[] => [
    ...(outcome.privateStatus === 'sent' ? [teamsText(user.locale, 'doneMe')] : []),
    ...(outcome.privateStatus === 'unchanged' && !isNotEmptyArray(outcome.groups) ? [teamsText(user.locale, 'unchanged')] : []),
    ...outcome.groups.map(group => {
        const title = escapeHtml(group.title);

        if (group.status === 'refused') {
            return teamsText(user.locale, 'refusedGroup', { title });
        }

        return teamsText(user.locale, group.status === 'edited' ? 'editedGroup' : 'doneGroup', { title });
    })
];

const telegramPrefix = /^Call to '\w+' failed! \(\d+: (?<detail>.*)\)$/u;

const failureNote = (user: MenuUser, reason: string): string =>
    reason.includes('may not be saved')
        ? teamsText(user.locale, 'failedMaybe')
        : teamsText(user.locale, 'failedNothing', { reason: escapeHtml(telegramPrefix.exec(reason)?.groups?.detail ?? reason) });

const publishTeams = Effect.fn('Bot.publishTeams')(function* (user: MenuUser, view: EditorView) {
    const telegram = yield* Telegram;
    const locale = yield* groupLocaleOf(user.communityId);
    const actorPersonId = yield* actorOf(user);
    const outcome = yield* publishLineup({
        communityId: user.communityId,
        sessionId: view.row.sessionId,
        version: view.row.version,
        locale,
        actorPersonId,
        privateChatId: user.chatId,
        fallback: yield* mainGroupOf(user.communityId)
    }).pipe(
        Effect.map(success => ({ _tag: 'published' as const, success })),
        Effect.catchTags({
            ActionFailedError: failure => Effect.succeed({ _tag: 'failed' as const, reason: failure.reason }),
            TelegramApiError: failure =>
                Effect.succeed({ _tag: 'failed' as const, reason: failure.isUncertain ? 'may not be saved' : failure.description })
        })
    );

    if (outcome._tag === 'failed') {
        return [failureNote(user, outcome.reason)];
    }

    if (outcome.success.privateStatus === 'sent') {
        yield* telegram.call('sendMessage', api =>
            api.sendMessage(
                user.chatId,
                [
                    teamsText(user.locale, 'hint'),
                    ...(isNotEmptyArray(outcome.success.diff)
                        ? ['', teamsText(user.locale, 'changes'), escapeHtml(outcome.success.diff.join('\n'))]
                        : [])
                ].join('\n'),
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [[{ text: teamsText(user.locale, 'card'), callback_data: `m:g:${toShortId(view.row.sessionId)}` }]]
                    }
                }
            )
        );
    }

    return outcomeNotes(user, outcome.success);
});

export const publishAndShow = Effect.fn('Bot.publishAndShow')(function* (user: MenuUser, view: EditorView) {
    const notes = yield* publishTeams(user, view);
    const fresh = yield* loadView(user, view.row.sessionId, { page: view.page, notes });

    return editorScreen(user, fresh);
});
