import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { grantAdmin } from '../access/admin-access';
import { ActionFailedError } from '../error/action-failed.error';
import { notifySessionCancelled, notifySessionChanged } from '../notify/notifier';
import { mergePeople, renamePerson } from '../people/people.service';
import { cancelSession, createSession, getSession, updateSession } from '../sessions/session.service';
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

const requireSession = (sessionId: string) =>
    getSession(sessionId).pipe(
        Effect.flatMap(found => Effect.fromOption(found)),
        Effect.mapError(() => ActionFailedError.make({ reason: `session ${sessionId} not found` }))
    );

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

export const executeAction = Effect.fn('Core.executeAction')(function* (action: Action, context: ActionContext) {
    const { actorPersonId, communityId, groupLocale: locale } = context;

    switch (action._tag) {
        case 'create_session': {
            return yield* Effect.gen(function* () {
                const sessionId = yield* createSession({ ...action, communityId, timezone: context.timezone, actorPersonId });

                if (action.announce) {
                    const created = yield* requireSession(sessionId);
                    const chatId = yield* requireChat(context);
                    yield* announceSession(created, chatId, locale);
                }

                return { sessionId };
            }).pipe(asResult);
        }
        case 'update_session': {
            return yield* Effect.gen(function* () {
                const before = yield* requireSession(action.sessionId);
                yield* updateSession(before, action, context.timezone, actorPersonId);
                const after = yield* requireSession(action.sessionId);
                yield* whenChat(context, action.notify, chatId => notifySessionChanged({ before, after, chatId, locale }));

                return { sessionId: action.sessionId };
            }).pipe(asResult);
        }
        case 'cancel_session': {
            return yield* Effect.gen(function* () {
                const target = yield* requireSession(action.sessionId);
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
                const target = yield* requireSession(action.sessionId);
                const chatId = yield* requireChat(context);
                const messageId = yield* announceSession(target, chatId, locale);

                return { messageId };
            }).pipe(asResult);
        }
        case 'publish_teams': {
            return yield* Effect.gen(function* () {
                const target = yield* requireSession(action.sessionId);
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
