import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { groupLocaleOf, mainGroupOf } from '@rondo/core/community/community.repository';
import { personIdOfTelegramUser } from '@rondo/core/identity/telegram-user';
import { loadAdminState, saveAdminState } from '@rondo/core/menu/admin-state.repository';
import { waitingOf } from '@rondo/core/signups/roster.service';
import { planLineup } from '@rondo/core/teams/lineup-plan';
import { changeDraft, openDraft, rebalanced, type DraftRow } from '@rondo/core/teams/team-draft.service';
import { loadTeamInputs, personNames } from '@rondo/core/teams/team-inputs';
import { claimLevelsOffer } from '@rondo/core/teams/team-schedule';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

import { showScreen } from '../show-screen';

import { stackRows } from './teams-editor.screen';

import type { MenuUser, Screen } from '../screen.interface';
import type { EditorView } from './teams-view.interface';

export const TeamsDraftSchema = Schema.Struct({
    flow: Schema.Literal('teams'),
    sessionId: Schema.String,
    step: Schema.Literals(['editor', 'guest']),
    host: Schema.NullOr(Schema.String),
    paste: Schema.NullOr(Schema.Unknown)
});

export type TeamsDraft = typeof TeamsDraftSchema.Type;

const decodeTeamsDraft = Schema.decodeUnknownOption(TeamsDraftSchema);

export const actorOf = (user: MenuUser) => personIdOfTelegramUser(user.tgUserId);

export const planOf = Effect.fn('Bot.teamsPlan')(function* (
    user: MenuUser,
    loaded: { readonly row: DraftRow; readonly inputs: EditorView['inputs'] },
    retryToken: string | null = null
) {
    return yield* planLineup({
        communityId: user.communityId,
        sessionId: loaded.row.sessionId,
        locale: yield* groupLocaleOf(user.communityId),
        privateChatId: user.chatId,
        fallback: yield* mainGroupOf(user.communityId),
        loaded,
        retryToken
    });
});

export const loadView = Effect.fn('Bot.loadTeamsView')(function* (
    user: MenuUser,
    sessionId: string,
    options: {
        readonly page?: number;
        readonly notes?: readonly string[];
        readonly after?: EditorView['after'];
        readonly row?: DraftRow;
        readonly offerLevels?: boolean;
        readonly place?: boolean;
    } = {}
) {
    const actor = yield* actorOf(user);
    const loaded = isDefined(options.row)
        ? { row: options.row, inputs: yield* loadTeamInputs(user.communityId, sessionId) }
        : yield* openDraft(user.communityId, sessionId, actor);
    const placed =
        options.place === true && isNotEmptyArray(loaded.row.state.pending)
            ? yield* changeDraft(
                  { sessionId, version: loaded.row.version, key: `place:${loaded.row.version}`, actorPersonId: actor },
                  state => Effect.succeed(rebalanced(loaded.inputs, state))
              )
            : null;
    const opened = { row: placed?.row ?? loaded.row, inputs: loaded.inputs };
    const plan = yield* planOf(user, opened);
    const pages = Math.max(1, Math.ceil(opened.row.state.teams.length / 2));
    const { waiting } = yield* waitingOf(sessionId);
    const names = yield* personNames([...opened.row.state.joined, ...opened.row.state.left]);

    return {
        row: opened.row,
        inputs: opened.inputs,
        plan,
        waiting: waiting.map(entry => entry.displayName),
        joinedNames: opened.row.state.joined.map(personId => names.get(personId) ?? '?'),
        leftNames: opened.row.state.left.map(personId => names.get(personId) ?? '?'),
        selected: null,
        page: Math.min(options.page ?? 0, pages - 1),
        notes: options.notes ?? [],
        after: options.after ?? null,
        offerLevels: options.offerLevels === true && (yield* claimLevelsOffer(user.communityId, actor, user.now))
    } satisfies EditorView;
});

export const showTeams = Effect.fn('Bot.showTeams')(function* (
    user: MenuUser,
    messageId: number | null,
    content: { readonly sessionId: string; readonly screen: Screen; readonly draft?: Partial<TeamsDraft> }
) {
    const shownId = yield* showScreen(user.chatId, messageId, { text: content.screen.text, keyboard: stackRows(content.screen.keyboard) });
    const draft: TeamsDraft = { flow: 'teams', sessionId: content.sessionId, step: 'editor', host: null, paste: null, ...content.draft };
    const live = yield* loadAdminState(user.tgUserId, user.now);
    const isOtherFlow = Option.exists(live, row => row.messageId !== shownId && Option.isNone(decodeTeamsDraft(row.draft)));

    if (isOtherFlow) {
        return shownId;
    }

    yield* saveAdminState({
        tgUserId: user.tgUserId,
        communityId: user.communityId,
        messageId: shownId,
        awaiting: 'teams',
        draft,
        now: user.now
    });

    return shownId;
});
