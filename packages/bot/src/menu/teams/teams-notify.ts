import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { communityProfile } from '@rondo/core/community/community.repository';
import { formatSessionLabel } from '@rondo/core/i18n/messages';
import { localTimeOf, todayIn } from '@rondo/core/sessions/local-time';
import { getSession } from '@rondo/core/sessions/session.service';
import { badgeOfColour } from '@rondo/core/teams/badges';
import {
    changeDraft,
    createDraft,
    loadDraft,
    markRosterChanged,
    minimumPlayers,
    openDraft,
    prepareProposal,
    rebalanced
} from '@rondo/core/teams/team-draft.service';
import { loadTeamInputs, personNames, teamSettingsOf } from '@rondo/core/teams/team-inputs';
import {
    afterStartMs,
    claimFewNotice,
    claimNotice,
    claimProposal,
    communityAdmins,
    hasStoredTeams,
    releaseNotice,
    releaseProposal
} from '@rondo/core/teams/team-schedule';
import { escapeHtml } from '@rondo/telegram/format/html';
import { Telegram } from '@rondo/telegram/service/telegram.service';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { teamsData } from './teams-callback';
import { stackRows } from './teams-editor.screen';
import { overviewScreen } from './teams-publish';
import { teamsText } from './teams-text';
import { loadView } from './teams-view';

import type { MenuUser, Screen } from '../screen.interface';
import type { Locale } from '@rondo/core/i18n/locale';

const hourMinutes = 60;
const hourMs = hourMinutes * 60_000;

interface Game {
    readonly id: string;
    readonly communityId: string;
    readonly startsAt: Date;
}

const adminUsers = Effect.fn('Bot.teamsAdminUsers')(function* (communityId: string, now: Date) {
    const profile = yield* communityProfile(communityId);
    const timezone = Option.match(profile, { onNone: () => 'Europe/Vienna', onSome: value => value.timezone });
    const admins = yield* communityAdmins(communityId);

    return admins.map((admin): MenuUser => ({
        tgUserId: admin.tgUserId,
        chatId: Number(admin.tgUserId),
        communityId,
        locale: admin.locale,
        now,
        today: todayIn(timezone, now),
        nowTime: localTimeOf(now, timezone),
        timezone
    }));
});

const sendScreen = Effect.fn('Bot.sendTeamsScreen')(function* (user: MenuUser, screen: Screen) {
    const telegram = yield* Telegram;

    return yield* telegram
        .call('sendMessage', api =>
            api.sendMessage(user.chatId, screen.text, {
                parse_mode: 'HTML',
                disable_notification: true,
                link_preview_options: { is_disabled: true },
                reply_markup: { inline_keyboard: stackRows(screen.keyboard) }
            })
        )
        .pipe(
            Effect.as(true),
            Effect.catchTag('TelegramApiError', error =>
                Effect.logWarning('[teams] admin not reached', { isUncertain: error.isUncertain }).pipe(Effect.as(error.isUncertain))
            )
        );
});

const labelOf = (locale: Locale, game: Parameters<typeof formatSessionLabel>[1]) => escapeHtml(formatSessionLabel(locale, game));

export const proposeTeamsFor = Effect.fn('Bot.proposeTeamsFor')(function* (game: Game, now: Date) {
    const settings = yield* teamSettingsOf(game.communityId);
    const hour = Math.floor(now.getTime() / hourMs) * hourMs;
    const isDue = game.startsAt.getTime() - hour < (settings.leadMinutes + hourMinutes) * 60_000 && now < game.startsAt;
    const existing = yield* loadDraft(game.id);

    if (!isDue || (yield* hasStoredTeams(game.id)) || Option.exists(existing, row => isDefined(row.proposedAt))) {
        return 'skipped';
    }

    const inputs = yield* loadTeamInputs(game.communityId, game.id);
    const admins = yield* adminUsers(game.communityId, now);

    if (!isNotEmptyArray(admins)) {
        return 'skipped';
    }

    if (inputs.players.length < minimumPlayers) {
        if (yield* claimFewNotice(game.communityId, game.id)) {
            for (const admin of admins) {
                yield* sendScreen(admin, {
                    text: teamsText(admin.locale, 'few', { label: labelOf(admin.locale, inputs.game), count: inputs.players.length }),
                    keyboard: []
                });
            }
        }

        return 'few';
    }

    yield* Option.isNone(existing)
        ? createDraft(inputs, { actorPersonId: null, proposedAt: null })
        : prepareProposal(inputs, existing.value);

    if (!(yield* claimProposal(game.id, now))) {
        return 'skipped';
    }

    const send = Effect.gen(function* () {
        const reached: boolean[] = [];

        for (const admin of admins) {
            const isReached = yield* loadView(admin, game.id, { offerLevels: true }).pipe(
                Effect.flatMap(view => overviewScreen(admin, view)),
                Effect.flatMap(screen => sendScreen(admin, screen)),
                Effect.catchCause(cause => Effect.logError('[teams] proposal screen failed', cause).pipe(Effect.as(false)))
            );
            reached.push(isReached);
        }

        return reached.includes(true);
    });
    const isHeard = yield* send.pipe(Effect.onError(() => releaseProposal(game.id).pipe(Effect.ignore)));

    if (!isHeard) {
        yield* releaseProposal(game.id);

        return 'skipped';
    }

    return 'proposed';
});

const changesText = (names: (personId: string) => string, joined: readonly string[], left: readonly string[]): string =>
    [
        ...(isNotEmptyArray(joined) ? [`+${joined.length}: ${joined.map(personId => names(personId)).join(', ')}`] : []),
        ...(isNotEmptyArray(left) ? [`−${left.length}: ${left.map(personId => names(personId)).join(', ')}`] : [])
    ].join('. ');

export const notifyRosterChange = Effect.fn('Bot.notifyRosterChange')(function* (sessionId: string, now: Date) {
    const game = yield* getSession(sessionId);
    const before = yield* loadDraft(sessionId);
    const previous = Option.match(before, { onNone: () => null, onSome: row => row.notifiedAt });

    if (
        Option.isNone(game) ||
        now.getTime() > game.value.startsAt.getTime() + afterStartMs ||
        !(yield* claimNotice(sessionId, now, game.value.startsAt))
    ) {
        return false;
    }

    const opened = yield* openDraft(game.value.communityId, sessionId, null);
    const { joined, left } = opened.row.state;

    if (!isNotEmptyArray(joined) && !isNotEmptyArray(left)) {
        yield* releaseNotice(sessionId, now, previous);

        return false;
    }

    const cleared = yield* changeDraft(
        { sessionId, version: opened.row.version, key: `notice:${now.getTime()}`, actorPersonId: null },
        state => Effect.succeed({ ...state, joined: [], left: [] })
    );

    if (cleared._tag !== 'changed') {
        yield* releaseNotice(sessionId, now, previous);

        return false;
    }

    const proposal = rebalanced(opened.inputs, cleared.row.state);
    const known = yield* personNames([...joined, ...left, ...opened.inputs.members.map(member => member.personId)]);
    const names = (personId: string) => escapeHtml(known.get(personId) ?? '?');
    const base = { sessionId, version: cleared.row.version, page: 0 };
    const reached: boolean[] = [];

    for (const admin of yield* adminUsers(game.value.communityId, now)) {
        const teams = proposal.teams.map(
            (members, team) =>
                `${badgeOfColour(proposal.colours[team])?.badge ?? `${team + 1}.`} ${members.map(personId => names(personId)).join(', ')}`
        );

        const isReached = yield* sendScreen(admin, {
            text: [
                teamsText(admin.locale, 'title', { label: labelOf(admin.locale, opened.inputs.game) }),
                teamsText(admin.locale, 'readapt', { changes: changesText(names, joined, left) }),
                teamsText(admin.locale, 'readaptReady'),
                ...teams
            ].join('\n'),
            keyboard: [
                [
                    {
                        text: teamsText(admin.locale, isDefined(opened.row.publishedAt) ? 'acceptSend' : 'accept'),
                        callback_data: teamsData(base, 'A')
                    }
                ],
                [
                    { text: teamsText(admin.locale, 'rebalanceScratch'), callback_data: teamsData(base, 'f') },
                    { text: teamsText(admin.locale, 'edit'), callback_data: teamsData(base, 'e') }
                ]
            ]
        });
        reached.push(isReached);
    }

    if (!reached.includes(true)) {
        yield* changeDraft({ sessionId, version: cleared.row.version, key: `unheard:${now.getTime()}`, actorPersonId: null }, state =>
            Effect.succeed({ ...state, joined: [...joined, ...state.joined], left: [...left, ...state.left] })
        );
        yield* releaseNotice(sessionId, now, previous);

        return false;
    }

    return true;
});

export const rosterChanged = Effect.fn('Bot.teamsRosterChanged')(function* (sessionId: string, now: Date) {
    const draft = yield* loadDraft(sessionId);

    if (Option.isNone(draft)) {
        return;
    }

    yield* markRosterChanged(sessionId, now);
    yield* notifyRosterChange(sessionId, now);
});
