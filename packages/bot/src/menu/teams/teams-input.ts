import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { loadAdminState } from '@rondo/core/menu/admin-state.repository';
import { addGuests } from '@rondo/core/signups/roster.service';
import { badgeOfColour } from '@rondo/core/teams/badges';
import { setColour, syncByAdmin, teamIndexOf, withChange, movePlayers, type DraftState } from '@rondo/core/teams/draft-state';
import {
    applyPaste,
    choose,
    isSameName,
    openQuestion,
    parsePaste,
    PasteSchema,
    resolvePaste,
    type Paste
} from '@rondo/core/teams/paste-lineup';
import { changeDraft, loadDraft } from '@rondo/core/teams/team-draft.service';
import { loadTeamInputs } from '@rondo/core/teams/team-inputs';
import { escapeHtml } from '@rondo/telegram/format/html';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

import { failureText } from '../failure-text';

import { teamsData, type TeamsTap } from './teams-callback';
import { editorScreen, shortName } from './teams-editor.screen';
import { teamsText } from './teams-text';
import { actorOf, loadView, showTeams, TeamsDraftSchema } from './teams-view';

import type { MenuUser, Screen } from '../screen.interface';
import type { AdminStateRow } from '@rondo/core/menu/admin-state.interface';

const decodeDraft = Schema.decodeUnknownOption(TeamsDraftSchema);
const decodePaste = Schema.decodeUnknownOption(PasteSchema);
const hostWithGuests = /^(?<name>[^\n+]*[^\s+])\s*\+\s*(?<count>[1-9])$/u;

const changeLatest = Effect.fn('Bot.changeLatestDraft')(function* (
    user: MenuUser,
    sessionId: string,
    transform: (state: DraftState) => DraftState
) {
    const row = yield* loadDraft(sessionId).pipe(
        Effect.flatMap(found => Effect.fromOption(found)),
        Effect.orDie
    );
    const inputs = yield* loadTeamInputs(user.communityId, sessionId);
    const synced = syncByAdmin(
        row.state,
        inputs.members.map(member => member.personId)
    );

    return yield* changeDraft(
        { sessionId, version: row.version, key: `${user.tgUserId}:typed:${row.version}`, actorPersonId: yield* actorOf(user) },
        state => Effect.succeed(transform(state === row.state ? synced : state))
    );
});

const showEditor = Effect.fn('Bot.teamsEditorAfterInput')(function* (
    user: MenuUser,
    sessionId: string,
    messageId: number | null,
    notes: readonly string[]
) {
    const view = yield* loadView(user, sessionId, { notes });
    yield* showTeams(user, messageId, { sessionId, screen: editorScreen(user, view) });
});

const addTypedGuests = Effect.fn('Bot.addTypedGuests')(function* (
    user: MenuUser,
    sessionId: string,
    guest: { readonly hostId: string | null; readonly count: number; readonly name: string | null }
) {
    const change = { communityId: user.communityId, sessionId, actorPersonId: yield* actorOf(user) };
    const added = yield* addGuests(change, { hostPersonId: guest.hostId, count: guest.count, name: guest.name });
    const seated = added.filter(entry => entry.status === 'in').map(entry => entry.personId);
    yield* changeLatest(user, sessionId, state => {
        const hostTeam = isDefined(guest.hostId) ? teamIndexOf(state, guest.hostId) : -1;
        const sizes = state.teams.map(members => members.length);
        const team = hostTeam >= 0 ? hostTeam : sizes.indexOf(Math.min(...sizes));

        return movePlayers(state, seated, team);
    });

    return added.length;
});

const questionScreen = (
    user: MenuUser,
    paste: Paste,
    base: { readonly sessionId: string; readonly version: number; readonly page: number }
): Screen | null => {
    const { ambiguous, unknown } = openQuestion(paste);
    const member = paste.teams.flatMap(team => team.members)[ambiguous];

    if (isDefined(member)) {
        return {
            text: teamsText(user.locale, 'whoIs', { name: escapeHtml(member.name) }),
            keyboard: [
                ...member.candidates.map((candidate, index) => [
                    { text: shortName(candidate.label, 30), callback_data: teamsData(base, 'Q', [paste.revision, ambiguous, index]) }
                ]),
                [{ text: teamsText(user.locale, 'skip'), callback_data: teamsData(base, 'Q', [paste.revision, ambiguous, 'n']) }]
            ]
        };
    }

    return isNotEmptyArray(unknown)
        ? {
              text: teamsText(user.locale, 'unknownNames', { names: escapeHtml(unknown.join(', ')) }),
              keyboard: [
                  [
                      { text: teamsText(user.locale, 'addAsGuests'), callback_data: teamsData(base, 'U', [paste.revision, 1]) },
                      { text: teamsText(user.locale, 'skip'), callback_data: teamsData(base, 'U', [paste.revision, 0]) }
                  ]
              ]
          }
        : null;
};

const finishPaste = Effect.fn('Bot.finishPaste')(function* (
    user: MenuUser,
    sessionId: string,
    paste: Paste,
    options: { readonly addUnknown: boolean | null; readonly messageId: number | null }
) {
    const { ambiguous, unknown } = openQuestion(paste);

    if (ambiguous >= 0 || (isNotEmptyArray(unknown) && !isDefined(options.addUnknown))) {
        const view = yield* loadView(user, sessionId);
        const screen = questionScreen(user, paste, { sessionId, version: view.row.version, page: 0 });
        yield* showTeams(user, options.messageId, { sessionId, screen: screen ?? editorScreen(user, view), draft: { paste } });

        return;
    }

    const placed = yield* applyPaste(
        { communityId: user.communityId, sessionId, actorPersonId: yield* actorOf(user) },
        paste,
        options.addUnknown ?? false
    );
    yield* changeLatest(user, sessionId, state => {
        const playing = new Set([...state.teams.flat(), ...state.pending, ...placed.teams.flat()]);
        const teams = placed.teams.map(members => members.filter(personId => playing.has(personId)));
        const mentioned = new Set(teams.flat());
        const next = withChange(state, {
            teams,
            pending: [...playing].filter(personId => !mentioned.has(personId)),
            keepers: [...new Set([...state.keepers, ...placed.keepers])],
            locks: []
        });

        return placed.colours.reduce(
            (current, colour, team) => (isDefined(colour) && team < teams.length ? setColour(current, team, colour) : current),
            next
        );
    });
    yield* showEditor(user, sessionId, options.messageId, [
        teamsText(user.locale, 'pasted'),
        ...placed.twice.map(entry =>
            teamsText(user.locale, 'twice', {
                name: escapeHtml(entry.name),
                badge: badgeOfColour(placed.colours[entry.team])?.badge ?? `${entry.team + 1}.`
            })
        )
    ]);
});

const typedInput = Effect.fn('Bot.teamsTypedInput')(function* (user: MenuUser, row: AdminStateRow, text: string) {
    const draft = decodeDraft(row.draft);

    if (Option.isNone(draft)) {
        return false;
    }

    const { sessionId } = draft.value;
    const view = yield* loadView(user, sessionId);
    const players = [...view.row.state.teams.flat(), ...view.row.state.pending];

    if (draft.value.step === 'guest' && !text.includes('\n')) {
        const hostId = draft.value.host === 'n' || !players.includes(draft.value.host ?? '') ? null : draft.value.host;
        yield* addTypedGuests(user, sessionId, { hostId, count: 1, name: text.slice(0, 40) });
        yield* showEditor(user, sessionId, null, [teamsText(user.locale, 'guestsAdded', { names: escapeHtml(text.slice(0, 40)) })]);

        return true;
    }

    const typed = hostWithGuests.exec(text.trim());
    const host = view.inputs.members.find(member => !member.isGuest && isSameName(member.displayName, typed?.groups?.name ?? ''));

    if (isDefined(typed) && isDefined(host)) {
        const count = yield* addTypedGuests(user, sessionId, { hostId: host.personId, count: Number(typed.groups?.count), name: null });
        yield* showEditor(user, sessionId, null, [
            teamsText(user.locale, 'guestsAdded', { names: escapeHtml(`${host.displayName} +${count}`) })
        ]);

        return true;
    }

    const teams = text.includes('\n') ? parsePaste(text, user.timezone) : null;

    if (!isDefined(teams)) {
        return false;
    }

    const paste = yield* resolvePaste(user.communityId, sessionId, teams);
    yield* finishPaste(user, sessionId, paste, { addUnknown: null, messageId: null });

    return true;
});

export const handleTeamsInput = (user: MenuUser, row: AdminStateRow, text: string) =>
    typedInput(user, row, text).pipe(
        Effect.catchTag('ActionFailedError', error =>
            Effect.gen(function* () {
                const sessionId = Option.getOrNull(decodeDraft(row.draft))?.sessionId ?? '';
                yield* showEditor(user, sessionId, null, [failureText(user.locale, error.reason, { where: '', isPrivate: false }).text]);

                return true;
            })
        )
    );

export const handlePasteTap = Effect.fn('Bot.handlePasteTap')(function* (user: MenuUser, tap: TeamsTap, messageId: number) {
    const state = yield* loadAdminState(user.tgUserId, user.now);
    const draft = state.pipe(Option.flatMap(row => decodeDraft(row.draft)));
    const paste = draft.pipe(Option.flatMap(value => decodePaste(value.paste)));

    const isCurrent = Option.exists(state, row => row.messageId === messageId);

    if (Option.isNone(paste) || Option.isNone(draft) || draft.value.sessionId !== tap.sessionId || !isCurrent) {
        yield* showEditor(user, tap.sessionId, messageId, []);

        return;
    }

    const [revision, first, second] = tap.args;
    const index = Number(first);
    const member = paste.value.teams.flatMap(team => team.members)[index];

    if (revision !== String(paste.value.revision) || (tap.op === 'Q' && !isNotEmptyArray(member?.candidates))) {
        return;
    }

    if (tap.op === 'U') {
        yield* finishPaste(user, tap.sessionId, paste.value, { addUnknown: first === '1', messageId });

        return;
    }

    const chosen = member?.candidates[Number(second)]?.personId ?? null;
    yield* finishPaste(user, tap.sessionId, choose(paste.value, index, chosen), { addUnknown: null, messageId });
});
