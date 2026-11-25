import { isDefined, isNotEmptyString } from '@rnw-community/shared';
import { withCommunityLock } from '@rondo/db/service/with-community-lock';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Predicate from 'effect/Predicate';

import { grantAdmin, isAdminOf } from '../access/admin-access';
import { linkedChatsOf } from '../community/community.repository';
import { ActionFailedError } from '../error/action-failed.error';
import { deliverNotices } from '../notify/deliver-notices';
import { previewedTargets, requirePreviewed } from '../notify/notice-preview';
import { linkAlias, requireAlias, unlinkAlias } from '../people/alias-links.service';
import { arePeopleOf, createPerson, mergePeople, renamePerson } from '../people/people.service';
import { deleteSession } from '../sessions/delete-session';
import { instantOf, localTimeOf, todayIn } from '../sessions/local-time';
import { cancelSession, createSession, findSameGame, requireSession, updateSession } from '../sessions/session.service';
import { forwardPoll } from '../signups/forward-poll';
import { publishPoll } from '../signups/publish-poll';
import { closePollsOf } from '../signups/signup.service';
import { executePublishTeams, setSeedRating } from '../teams/team.service';
import { createVenue, requireVenue, updateVenue } from '../venues/venue.service';

import type { Locale } from '../i18n/locale';
import type { GroupTarget } from '../interface/group-target.interface';
import type { Approval } from '../telegram/write-to-chat';
import type { Action } from './action.model';

export interface ActionContext {
    readonly communityId: string;
    readonly timezone: string;
    readonly group: Option.Option<GroupTarget>;
    readonly groupLocale: Locale;
    readonly actorPersonId: string | null;
    readonly requester?: bigint;
}

interface Decision {
    readonly approval: Extract<Approval, { _tag: 'approver' }>;
    readonly summary: string;
}

const requireGroup = (context: ActionContext) =>
    Option.isSome(context.group)
        ? Effect.succeed(context.group.value)
        : Effect.fail(ActionFailedError.make({ failure: { code: 'no_group' } }));

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
        return yield* ActionFailedError.make({ failure: { code: 'chat_not_linked' } });
    }

    if (!found.isPosting) {
        return yield* ActionFailedError.make({ failure: { code: 'group_off' } });
    }

    if (!Predicate.isUndefined(topicId) && found.topicId !== topicId) {
        return yield* ActionFailedError.make({ failure: { code: 'preview_changed' } });
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
                return yield* ActionFailedError.make({ failure: { code: 'game_exists', sessionId: existing.value } });
            }

            return yield* createSession({ ...action, communityId, timezone, actorPersonId });
        })
    );

const executeAction = Effect.fn('Core.executeAction')(function* (
    action: Exclude<Action, { _tag: 'announce_session' }>,
    context: ActionContext,
    { approval }: Pick<Decision, 'approval'>
) {
    const { actorPersonId, communityId, groupLocale: locale } = context;
    const notify = (notice: Extract<Action, { _tag: 'update_session' | 'cancel_session' }>) =>
        notice.notify && isDefined(notice.preview)
            ? deliverNotices({ approval, locale, html: notice.preview.html, targets: previewedTargets(notice) })
            : Effect.void;

    switch (action._tag) {
        case 'create_session': {
            const sessionId = yield* createFrom(action, context);

            return { sessionId } satisfies ActionResult;
        }
        case 'update_session': {
            return yield* Effect.gen(function* () {
                yield* requirePreviewed(action, context);
                const before = yield* requireSession(communityId, action.sessionId);
                yield* updateSession(before, action, context.timezone, actorPersonId);
                yield* notify(action);

                return { sessionId: action.sessionId };
            }).pipe(asResult);
        }
        case 'cancel_session': {
            return yield* Effect.gen(function* () {
                yield* requirePreviewed(action, context);
                const target = yield* requireSession(communityId, action.sessionId);
                yield* cancelSession(target, action.reason, actorPersonId);
                const kept = yield* closePollsOf(target.id, { ...approval, closes: action.closes });
                yield* notify(action);

                return {
                    sessionId: action.sessionId,
                    ...(isNotEmptyString(kept) ? { openIn: kept } : {})
                };
            }).pipe(asResult);
        }
        case 'publish_teams': {
            return yield* executePublishTeams(action, {
                communityId,
                locale,
                actorPersonId,
                approval,
                privateChatId: isDefined(context.requester) ? Number(context.requester) : null,
                fallback: context.group
            }).pipe(Effect.as({ sessionId: action.sessionId }), asResult);
        }
        case 'delete_session': {
            const now = yield* DateTime.nowAsDate;

            return yield* deleteSession({
                communityId,
                sessionId: action.sessionId,
                today: todayIn(context.timezone, now),
                actorPersonId,
                approval: { ...approval, closes: action.closes }
            }).pipe(Effect.as({ sessionId: action.sessionId }), asResult);
        }
        case 'forward_poll': {
            return yield* Effect.gen(function* () {
                const target = yield* linkedTarget(context, { chatId: action.chatId, topicId: action.topicId }, context.requester);
                const forwarded = yield* forwardPoll(action.sessionId, target, {
                    resend: action.resend ?? null,
                    pollId: action.pollId,
                    approval
                });

                return forwarded;
            }).pipe(asResult);
        }
        case 'merge_people': {
            return yield* mergePeople({ ...action, communityId, actorPersonId, decidedBy: approval.tgUserId }).pipe(
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
    if (action._tag === 'merge_people') {
        return [action.fromPersonId, action.intoPersonId];
    }

    return 'personId' in action ? [action.personId] : [];
};

export const requireActionScope = Effect.fn('Core.requireActionScope')(function* (action: Action, communityId: string) {
    if (!(yield* arePeopleOf(communityId, peopleIn(action)))) {
        return yield* ActionFailedError.make({ failure: { code: 'person_not_found' } });
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
            return yield* ActionFailedError.make({ failure: { code: 'venue_unused' } });
        }
    }

    return action;
});

// A request to the approver ends with the kick-off that is planned now
export const kickoffOf = Effect.fn('Core.kickoffOf')(function* (action: Action, { communityId, timezone }: ActionContext) {
    if (action._tag === 'create_session') {
        return instantOf(action.localDate, action.localTime, timezone);
    }

    return 'sessionId' in action && isDefined(action.sessionId) ? (yield* requireSession(communityId, action.sessionId)).startsAt : null;
});

const plannedKickoff = Effect.fn('Core.plannedKickoff')(function* (action: Action, communityId: string) {
    if (action._tag === 'create_session') {
        return Option.some({ localDate: action.localDate, localTime: action.localTime });
    }

    if (action._tag === 'announce_session') {
        const stored = yield* requireSession(communityId, action.sessionId);

        return Option.some({ localDate: stored.localDate, localTime: stored.localTime });
    }

    if (action._tag !== 'update_session' || (!isDefined(action.localDate) && !isDefined(action.localTime))) {
        return Option.none<{ readonly localDate: string; readonly localTime: string }>();
    }

    const before = yield* requireSession(communityId, action.sessionId);

    return Option.some({ localDate: action.localDate ?? before.localDate, localTime: action.localTime ?? before.localTime });
});

const requireKickoff = Effect.fn('Core.requireKickoff')(function* (action: Action, context: ActionContext) {
    const planned = yield* plannedKickoff(action, context.communityId);

    if (Option.isNone(planned)) {
        return action;
    }

    const { localDate, localTime } = planned.value;
    const startsAt = instantOf(localDate, localTime, context.timezone);

    if (localTimeOf(startsAt, context.timezone) !== localTime || todayIn(context.timezone, startsAt) !== localDate) {
        return yield* ActionFailedError.make({ failure: { code: 'no_such_time' } });
    }

    if (startsAt.getTime() <= (yield* DateTime.nowAsDate).getTime()) {
        return yield* ActionFailedError.make({ failure: { code: 'time_passed' } });
    }

    return action;
});

export const runAdminAction = Effect.fn('Core.runAdminAction')(function* <Failure, Requirements>(
    tgUserId: bigint,
    action: Action,
    context: ActionContext,
    decision: Decision & { readonly settle: (result: ActionResult) => Effect.Effect<void, Failure, Requirements> }
) {
    const { approval, summary, settle } = decision;

    if (!(yield* isAdminOf(tgUserId, context.communityId))) {
        return yield* ActionFailedError.make({ failure: { code: 'not_admin' } });
    }

    yield* requireActionScope(action, context.communityId);
    yield* requireKickoff(action, context);

    if ('chatId' in action && isDefined(action.chatId)) {
        yield* linkedTarget(context, action, tgUserId);
    }

    if (action._tag === 'announce_session' || (action._tag === 'create_session' && action.announce)) {
        const group = yield* linkedTarget(context, action, tgUserId);
        const prepare = action._tag === 'create_session' ? createFrom(action, context) : Effect.succeed(action.sessionId);

        return yield* publishPoll({
            communityId: context.communityId,
            group,
            approval,
            note: action.note,
            approvedSummary: summary,
            prepare,
            settle
        });
    }

    const result = yield* executeAction(action, context, decision);
    yield* settle(result);

    return result;
});
