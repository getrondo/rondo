import { isDefined } from '@rnw-community/shared';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { grantAdmin, isAdminOf } from '../access/admin-access';
import { ActionFailedError } from '../error/action-failed.error';
import { notifySessionCancelled, notifySessionChanged } from '../notify/notifier';
import { linkAlias, requireAlias, unlinkAlias } from '../people/alias-links.service';
import { arePeopleOf, createPerson, mergePeople, renamePerson } from '../people/people.service';
import { cancelSession, createSession, requireSession, updateSession } from '../sessions/session.service';
import { announceSession, closePollsOf } from '../signups/signup.service';
import { publishTeams, setSeedRating } from '../teams/team.service';
import { createVenue, requireVenue, updateVenue } from '../venues/venue.service';

import type { Locale } from '../i18n/locale';
import type { GroupTarget } from '../interface/group-target.interface';
import type { Action } from './action.model';

export interface ActionContext {
    readonly communityId: string;
    readonly timezone: string;
    readonly group: Option.Option<GroupTarget>;
    readonly groupLocale: Locale;
    readonly actorPersonId: string | null;
}

const requireGroup = (context: ActionContext) =>
    Option.isSome(context.group)
        ? Effect.succeed(context.group.value)
        : Effect.fail(ActionFailedError.make({ reason: 'no group is linked to this community yet' }));

const whenGroup = <Value, Failure, Requirements>(
    context: ActionContext,
    enabled: boolean,
    effect: (group: GroupTarget) => Effect.Effect<Value, Failure, Requirements>
) => (enabled && Option.isSome(context.group) ? Effect.asVoid(effect(context.group.value)) : Effect.void);

type ActionResult = Readonly<Record<string, string | number>>;

const asResult = Effect.map((value: ActionResult): ActionResult => value);

const executeAction = Effect.fn('Core.executeAction')(function* (action: Action, context: ActionContext) {
    const { actorPersonId, communityId, groupLocale: locale } = context;

    switch (action._tag) {
        case 'create_session': {
            return yield* Effect.gen(function* () {
                if (action.announce) {
                    yield* requireGroup(context);
                }

                const sessionId = yield* createSession({ ...action, communityId, timezone: context.timezone, actorPersonId });

                if (action.announce) {
                    const created = yield* requireSession(communityId, sessionId);
                    const group = yield* requireGroup(context);
                    yield* announceSession(created, group, locale);
                }

                return { sessionId };
            }).pipe(asResult);
        }
        case 'update_session': {
            return yield* Effect.gen(function* () {
                const before = yield* requireSession(communityId, action.sessionId);
                yield* updateSession(before, action, context.timezone, actorPersonId);
                const after = yield* requireSession(communityId, action.sessionId);
                yield* whenGroup(context, action.notify, group => notifySessionChanged({ before, after, group, locale }));

                return { sessionId: action.sessionId };
            }).pipe(asResult);
        }
        case 'cancel_session': {
            return yield* Effect.gen(function* () {
                const target = yield* requireSession(communityId, action.sessionId);
                yield* cancelSession(target, action.reason, actorPersonId);
                yield* closePollsOf(target.id);
                yield* whenGroup(context, action.notify, group => notifySessionCancelled({ target, reason: action.reason, group, locale }));

                return { sessionId: action.sessionId };
            }).pipe(asResult);
        }
        case 'announce_session': {
            return yield* Effect.gen(function* () {
                const target = yield* requireSession(communityId, action.sessionId);
                const group = yield* requireGroup(context);
                const messageId = yield* announceSession(target, group, locale);

                return { messageId };
            }).pipe(asResult);
        }
        case 'publish_teams': {
            return yield* Effect.gen(function* () {
                const target = yield* requireSession(communityId, action.sessionId);
                yield* publishTeams({ target, teams: action.teams, group: yield* requireGroup(context), locale, actorPersonId });

                return { sessionId: action.sessionId };
            }).pipe(asResult);
        }
        case 'merge_people': {
            return yield* mergePeople({ ...action, communityId, actorPersonId }).pipe(
                Effect.as({ personId: action.intoPersonId }),
                asResult
            );
        }
        case 'link_alias': {
            return yield* linkAlias({ ...action, communityId, actorPersonId }).pipe(Effect.as({ personId: action.personId }), asResult);
        }
        case 'unlink_alias': {
            return yield* unlinkAlias({ ...action, communityId, actorPersonId }).pipe(Effect.as({ aliasId: action.aliasId }), asResult);
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
        case 'create_person': {
            const personId = yield* createPerson({ displayName: action.displayName, communityId, actorPersonId });

            return { personId } satisfies ActionResult;
        }
        case 'create_venue': {
            const { _tag, ...details } = action;
            const venueId = yield* createVenue({ ...details, communityId, actorPersonId });

            return { venueId } satisfies ActionResult;
        }
        case 'update_venue': {
            const { _tag, venueId, ...patch } = action;
            yield* updateVenue({ communityId, venueId, patch, actorPersonId });

            return { venueId } satisfies ActionResult;
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
        case 'link_alias':
        case 'rename_person':
        case 'grant_admin':
        case 'set_rating': {
            return [action.personId];
        }
        case 'unlink_alias':
        case 'create_person':
        case 'create_venue':
        case 'update_venue':
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

    if ('sessionId' in action && isDefined(action.sessionId)) {
        yield* requireSession(communityId, action.sessionId);
    }

    if ('aliasId' in action) {
        yield* requireAlias(communityId, action.aliasId);
    }

    if ('venueId' in action && isDefined(action.venueId)) {
        const found = yield* requireVenue(communityId, action.venueId);

        if (action._tag !== 'update_venue' && found.status !== 'active') {
            return yield* ActionFailedError.make({ reason: 'this venue is no longer used' });
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
