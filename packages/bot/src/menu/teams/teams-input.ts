import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { loadAdminState, replaceAdminState } from '@rondo/core/menu/admin-state.repository';
import { addGuests } from '@rondo/core/signups/roster.service';
import { badgeOfColour } from '@rondo/core/teams/badges';
import { setColour, teamIndexOf, withChange, movePlayers, type DraftState } from '@rondo/core/teams/draft-state';
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
import { Db } from '@rondo/db/service/db.service';
import { escapeHtml } from '@rondo/telegram/format/html';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

import { failureText } from '../failure-text';

import { teamsData, type TeamsTap } from './teams-callback';
import { editorScreen } from './teams-editor.screen';
import { joinTyped } from './teams-join';
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

    return yield* changeDraft(
        { sessionId, version: row.version, key: `${user.tgUserId}:typed:${row.version}`, actorPersonId: yield* actorOf(user) },
        state => Effect.succeed(transform(state))
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
                    { text: candidate.label, callback_data: teamsData(base, 'Q', [paste.revision, ambiguous, index]) }
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

const placePaste = Effect.fn('Bot.placePaste')(function* (user: MenuUser, sessionId: string, paste: Paste, addUnknown: boolean | null) {
    const { ambiguous, unknown } = openQuestion(paste);

    if (ambiguous >= 0 || (isNotEmptyArray(unknown) && !isDefined(addUnknown))) {
        return { _tag: 'question' as const, paste };
    }

    const placed = yield* applyPaste(
        { communityId: user.communityId, sessionId, actorPersonId: yield* actorOf(user) },
        paste,
        addUnknown ?? false
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

    return {
        _tag: 'placed' as const,
        notes: [
            teamsText(user.locale, 'pasted'),
            ...(isNotEmptyArray(placed.queued) ? [teamsText(user.locale, 'queued', { names: escapeHtml(placed.queued.join(', ')) })] : []),
            ...placed.twice.map(entry =>
                teamsText(user.locale, 'twice', {
                    name: escapeHtml(entry.name),
                    badge: badgeOfColour(placed.colours[entry.team])?.badge ?? `${entry.team + 1}.`
                })
            )
        ]
    };
});

const showPasted = Effect.fn('Bot.showPasted')(function* (
    user: MenuUser,
    sessionId: string,
    messageId: number | null,
    outcome: Effect.Success<ReturnType<typeof placePaste>>
) {
    if (outcome._tag === 'placed') {
        yield* showEditor(user, sessionId, messageId, outcome.notes);

        return;
    }

    const view = yield* loadView(user, sessionId);
    const screen = questionScreen(user, outcome.paste, { sessionId, version: view.row.version, page: 0 });
    yield* showTeams(user, messageId, { sessionId, screen: screen ?? editorScreen(user, view), draft: { paste: outcome.paste } });
});

const typedInput = Effect.fn('Bot.teamsTypedInput')(function* (user: MenuUser, row: AdminStateRow, text: string) {
    const draft = decodeDraft(row.draft);

    if (Option.isNone(draft)) {
        return false;
    }

    const { sessionId } = draft.value;
    const view = yield* loadView(user, sessionId);
    const players = [...view.row.state.teams.flat(), ...view.row.state.pending];

    if (
        draft.value.step === 'guest' &&
        draft.value.host === 'n' &&
        !text.includes('\n') &&
        (yield* joinTyped(user, sessionId, text.trim()))
    ) {
        return true;
    }

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
    const outcome = yield* placePaste(user, sessionId, paste, null);
    yield* showPasted(user, sessionId, null, outcome);

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

    if (
        Option.isNone(state) ||
        Option.isNone(paste) ||
        Option.isNone(draft) ||
        draft.value.sessionId !== tap.sessionId ||
        state.value.messageId !== messageId
    ) {
        yield* showEditor(user, tap.sessionId, messageId, []);

        return;
    }

    const [revision, first, second] = tap.args;
    const index = Number(first);
    const member = paste.value.teams.flatMap(team => team.members)[index];

    if (revision !== String(paste.value.revision) || (tap.op === 'Q' && !isNotEmptyArray(member?.candidates))) {
        return;
    }

    const answered = tap.op === 'U' ? paste.value : choose(paste.value, index, member?.candidates[Number(second)]?.personId ?? null);
    // The answer is taken, and the paste cleared or its next question stored, in one transaction: a retried tap finds nothing to answer
    const withPaste = (next: Paste | null) => ({ ...state.value, draft: { ...draft.value, paste: next }, now: user.now });
    const outcome = yield* Db.use(db =>
        db.transaction(() =>
            replaceAdminState(withPaste(null), state.value.revision).pipe(
                Effect.flatMap(claimed =>
                    Option.isSome(claimed)
                        ? placePaste(user, tap.sessionId, answered, tap.op === 'U' ? first === '1' : null).pipe(
                              Effect.tap(placed =>
                                  placed._tag === 'question'
                                      ? replaceAdminState(withPaste(placed.paste), claimed.value.revision)
                                      : Effect.void
                              )
                          )
                        : Effect.succeed(null)
                )
            )
        )
    );

    if (isDefined(outcome)) {
        yield* showPasted(user, tap.sessionId, messageId, outcome);
    }
});
