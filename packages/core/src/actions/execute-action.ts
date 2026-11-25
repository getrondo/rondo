import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { withCommunityLock } from '@rondo/ingest-telegram/load/with-community-lock';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Predicate from 'effect/Predicate';

import { grantAdmin, isAdminOf } from '../access/admin-access';
import { linkedChatsOf } from '../community/community.repository';
import { ActionFailedError } from '../error/action-failed.error';
import { notifySessionCancelled, notifySessionChanged } from '../notify/notifier';
import { linkAlias, requireAlias, unlinkAlias } from '../people/alias-links.service';
import { arePeopleOf, createPerson, mergePeople, renamePerson } from '../people/people.service';
import { deleteSession } from '../sessions/delete-session';
import { todayIn } from '../sessions/local-time';
import { cancelSession, createSession, findSameGame, requireSession, updateSession } from '../sessions/session.service';
import { noticeTargets } from '../signups/audience';
import { forwardPoll } from '../signups/forward-poll';
import { publishPoll } from '../signups/publish-poll';
import { closePollsOf } from '../signups/signup.service';
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
    readonly requester?: bigint;
}

const requireGroup = (context: ActionContext) =>
    Option.isSome(context.group)
        ? Effect.succeed(context.group.value)
        : Effect.fail(ActionFailedError.make({ reason: 'no group is linked to this community yet' }));

const targetsOf = Effect.fn('Core.targetsOf')(function* (context: ActionContext, sessionId: string) {
    const requester = isDefined(context.requester) ? [{ chatId: context.requester, topicId: null }] : [];

    return yield* noticeTargets(sessionId, Option.isSome(context.group) ? [context.group.value] : requester);
});

const toAudience = Effect.fn('Core.toAudience')(function* <Value, Failure, Requirements>(
    context: ActionContext,
    sessionId: string,
    effect: (group: GroupTarget) => Effect.Effect<Value, Failure, Requirements>
) {
    const targets = yield* targetsOf(context, sessionId);

    for (const group of targets) {
        yield* effect(group);
    }
});

interface Destination {
    readonly chatId?: string | undefined;
    readonly topicId?: number | null | undefined;
}

// A previewed destination is checked against the current links and never swapped for another chat
const linkedTarget = Effect.fn('Core.linkedTarget')(function* (context: ActionContext, destination: Destination, requester?: bigint) {
    const { chatId, topicId } = destination;

    if (!isDefined(chatId)) {
        return yield* requireGroup(context);
    }

    if (isDefined(requester) && chatId === String(requester)) {
        return { chatId: requester, topicId: null };
    }

    const chats = yield* linkedChatsOf(context.communityId);
    const found = chats.find(chat => String(chat.chatId) === chatId);

    if (!isDefined(found)) {
        return yield* ActionFailedError.make({ reason: 'this chat is not linked to the community' });
    }

    if (!Predicate.isUndefined(topicId) && found.topicId !== topicId) {
        return yield* ActionFailedError.make({ reason: 'the group link changed after the preview, ask for a new one' });
    }

    return { chatId: found.chatId, topicId: found.topicId };
});

type ActionResult = Readonly<Record<string, string | number>>;

const asResult = Effect.map((value: ActionResult): ActionResult => value);

const createFrom = (action: Extract<Action, { _tag: 'create_session' }>, { communityId, timezone, actorPersonId }: ActionContext) =>
    withCommunityLock(
        { id: communityId },
        Effect.gen(function* () {
            const existing = yield* findSameGame({ ...action, communityId, timezone });

            if (Option.isSome(existing)) {
                return yield* ActionFailedError.make({ reason: `the game already exists: ${existing.value}` });
            }

            return yield* createSession({ ...action, communityId, timezone, actorPersonId });
        })
    );

const executeAction = Effect.fn('Core.executeAction')(function* (
    action: Exclude<Action, { _tag: 'announce_session' }>,
    context: ActionContext
) {
    const { actorPersonId, communityId, groupLocale: locale } = context;

    switch (action._tag) {
        case 'create_session': {
            const sessionId = yield* createFrom(action, context);

            return { sessionId } satisfies ActionResult;
        }
        case 'update_session': {
            return yield* Effect.gen(function* () {
                const before = yield* requireSession(communityId, action.sessionId);
                yield* updateSession(before, action, context.timezone, actorPersonId);
                const after = yield* requireSession(communityId, action.sessionId);
                if (action.notify) {
                    yield* toAudience(context, action.sessionId, group => notifySessionChanged({ before, after, group, locale }));
                }

                return { sessionId: action.sessionId };
            }).pipe(asResult);
        }
        case 'cancel_session': {
            return yield* Effect.gen(function* () {
                const target = yield* requireSession(communityId, action.sessionId);
                yield* cancelSession(target, action.reason, actorPersonId);
                yield* closePollsOf(target.id);
                if (action.notify) {
                    yield* toAudience(context, action.sessionId, group =>
                        notifySessionCancelled({ target, reason: action.reason, group, locale })
                    );
                }

                return { sessionId: action.sessionId };
            }).pipe(asResult);
        }
        case 'publish_teams': {
            return yield* Effect.gen(function* () {
                const target = yield* requireSession(communityId, action.sessionId);
                const groups = yield* targetsOf(context, action.sessionId);

                if (!isNotEmptyArray(groups)) {
                    return yield* ActionFailedError.make({ reason: 'no group is linked to this community yet' });
                }

                yield* publishTeams({ target, teams: action.teams, groups, locale, actorPersonId });

                return { sessionId: action.sessionId };
            }).pipe(asResult);
        }
        case 'delete_session': {
            const now = yield* DateTime.nowAsDate;

            return yield* deleteSession({
                communityId,
                sessionId: action.sessionId,
                today: todayIn(context.timezone, now),
                actorPersonId
            }).pipe(Effect.as({ sessionId: action.sessionId }), asResult);
        }
        case 'forward_poll': {
            return yield* Effect.gen(function* () {
                const target = yield* linkedTarget(context, { chatId: action.chatId }, context.requester);
                const forwarded = yield* forwardPoll(action.sessionId, target);

                return { sessionId: action.sessionId, messageId: forwarded.messageId };
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
        case 'announce_session':
        case 'delete_session':
        case 'forward_poll': {
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

export const runAdminAction = Effect.fn('Core.runAdminAction')(function* <Failure, Requirements>(
    tgUserId: bigint,
    action: Action,
    context: ActionContext,
    { summary, settle }: { readonly summary: string; readonly settle: (result: ActionResult) => Effect.Effect<void, Failure, Requirements> }
) {
    if (!(yield* isAdminOf(tgUserId, context.communityId))) {
        return yield* ActionFailedError.make({ reason: 'not an admin any more' });
    }

    yield* requireActionScope(action, context.communityId);

    if ('chatId' in action && isDefined(action.chatId)) {
        yield* linkedTarget(context, action, tgUserId);
    }

    if (action._tag === 'announce_session' || (action._tag === 'create_session' && action.announce)) {
        const group = yield* linkedTarget(context, action, tgUserId);
        const prepare = action._tag === 'create_session' ? createFrom(action, context) : Effect.succeed(action.sessionId);

        return yield* publishPoll({
            communityId: context.communityId,
            group,
            note: action.note,
            approvedSummary: summary,
            prepare,
            settle
        });
    }

    const result = yield* executeAction(action, context);
    yield* settle(result);

    return result;
});
