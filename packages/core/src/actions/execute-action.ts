import { isDefined } from '@rnw-community/shared';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { grantAdmin, isAdminOf } from '../access/admin-access';
import { ActionFailedError } from '../error/action-failed.error';
import { notifySessionCancelled, notifySessionChanged } from '../notify/notifier';
import { arePeopleOf, mergePeople, renamePerson } from '../people/people.service';
import { cancelSession, createSession, listVenues, requireSession, updateSession } from '../sessions/session.service';
import { announceSession, closePollsOf } from '../signups/signup.service';
import { publishTeams, setSeedRating } from '../teams/team.service';

import type { Locale } from '../i18n/locale';
import type { Action } from './action.model';

export interface ActionContext {
    readonly communityId: string;
    readonly timezone: string;
    readonly mainChatId: Option.Option<bigint>;
    readonly groupLocale: Locale;
    readonly actorPersonId: string | null;
}

const requireChat = (context: ActionContext) =>
    Option.isSome(context.mainChatId)
        ? Effect.succeed(context.mainChatId.value)
        : Effect.fail(ActionFailedError.make({ reason: 'no group is linked to this community yet' }));

const whenChat = <Value, Failure, Requirements>(
    context: ActionContext,
    enabled: boolean,
    effect: (chatId: bigint) => Effect.Effect<Value, Failure, Requirements>
) => (enabled && Option.isSome(context.mainChatId) ? Effect.asVoid(effect(context.mainChatId.value)) : Effect.void);

type ActionResult = Readonly<Record<string, string | number>>;

const asResult = Effect.map((value: ActionResult): ActionResult => value);

const executeAction = Effect.fn('Core.executeAction')(function* (action: Action, context: ActionContext) {
    const { actorPersonId, communityId, groupLocale: locale } = context;

    switch (action._tag) {
        case 'create_session': {
            return yield* Effect.gen(function* () {
                const sessionId = yield* createSession({ ...action, communityId, timezone: context.timezone, actorPersonId });

                if (action.announce) {
                    const created = yield* requireSession(communityId, sessionId);
                    const chatId = yield* requireChat(context);
                    yield* announceSession(created, chatId, locale);
                }

                return { sessionId };
            }).pipe(asResult);
        }
        case 'update_session': {
            return yield* Effect.gen(function* () {
                const before = yield* requireSession(communityId, action.sessionId);
                yield* updateSession(before, action, context.timezone, actorPersonId);
                const after = yield* requireSession(communityId, action.sessionId);
                yield* whenChat(context, action.notify, chatId => notifySessionChanged({ before, after, chatId, locale }));

                return { sessionId: action.sessionId };
            }).pipe(asResult);
        }
        case 'cancel_session': {
            return yield* Effect.gen(function* () {
                const target = yield* requireSession(communityId, action.sessionId);
                yield* cancelSession(target, action.reason, actorPersonId);
                yield* closePollsOf(target.id);
                yield* whenChat(context, action.notify, chatId =>
                    notifySessionCancelled({ target, reason: action.reason, chatId, locale })
                );

                return { sessionId: action.sessionId };
            }).pipe(asResult);
        }
        case 'announce_session': {
            return yield* Effect.gen(function* () {
                const target = yield* requireSession(communityId, action.sessionId);
                const chatId = yield* requireChat(context);
                const messageId = yield* announceSession(target, chatId, locale);

                return { messageId };
            }).pipe(asResult);
        }
        case 'publish_teams': {
            return yield* Effect.gen(function* () {
                const target = yield* requireSession(communityId, action.sessionId);
                yield* publishTeams({ target, teams: action.teams, chatId: yield* requireChat(context), locale, actorPersonId });

                return { sessionId: action.sessionId };
            }).pipe(asResult);
        }
        case 'merge_people': {
            return yield* mergePeople({ ...action, communityId, actorPersonId }).pipe(
                Effect.as({ personId: action.intoPersonId }),
                asResult
            );
        }
        case 'rename_person': {
            return yield* renamePerson({ ...action, communityId, actorPersonId }).pipe(Effect.as({ personId: action.personId }), asResult);
        }
        case 'grant_admin': {
            return yield* grantAdmin({ communityId, personId: action.personId, grantedBy: actorPersonId }).pipe(
                Effect.as({ personId: action.personId }),
                asResult
            );
        }
        case 'set_rating': {
            return yield* setSeedRating({ ...action, communityId, actorPersonId }).pipe(Effect.as({ personId: action.personId }), asResult);
        }
        default: {
            return yield* Effect.die(new Error('unknown action'));
        }
    }
});

const peopleIn = (action: Action): readonly string[] => {
    switch (action._tag) {
        case 'publish_teams': {
            return action.teams.flatMap(({ players }) => players.map(({ personId }) => personId));
        }
        case 'merge_people': {
            return [action.fromPersonId, action.intoPersonId];
        }
        case 'rename_person':
        case 'grant_admin':
        case 'set_rating': {
            return [action.personId];
        }
        case 'create_session':
        case 'update_session':
        case 'cancel_session':
        case 'announce_session': {
            return [];
        }
        default: {
            return [];
        }
    }
};

export const requireActionScope = Effect.fn('Core.requireActionScope')(function* (action: Action, communityId: string) {
    if (!(yield* arePeopleOf(communityId, peopleIn(action)))) {
        return yield* ActionFailedError.make({ reason: 'player not found in this community' });
    }

    if ('sessionId' in action) {
        yield* requireSession(communityId, action.sessionId);
    }

    if ('venueId' in action && isDefined(action.venueId)) {
        const venues = yield* listVenues(communityId);

        if (!venues.some(({ id }) => id === action.venueId)) {
            return yield* ActionFailedError.make({ reason: 'venue not found in this community' });
        }
    }

    return action;
});

export const runAdminAction = Effect.fn('Core.runAdminAction')(function* (tgUserId: bigint, action: Action, context: ActionContext) {
    if (!(yield* isAdminOf(tgUserId, context.communityId))) {
        return yield* ActionFailedError.make({ reason: 'not an admin any more' });
    }

    yield* requireActionScope(action, context.communityId);

    return yield* executeAction(action, context);
});
