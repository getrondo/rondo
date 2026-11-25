import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { community, telegramChat } from '@rondo/db/schema/org.schema';
import { pendingAction } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { withCommunityLock } from '@rondo/db/service/with-community-lock';
import { and, eq, ne, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Predicate from 'effect/Predicate';
import * as Schema from 'effect/Schema';

import { ActionSchema } from '../actions/action.model';
import { groupsTouched } from '../actions/groups-touched';
import { recordAudit } from '../audit/record-audit';
import { ActionFailedError } from '../error/action-failed.error';

import { mainGroupOf } from './community.repository';
import { findKnownChat } from './group-settings';

interface ChatOf {
    readonly communityId: string;
    readonly chatId: bigint;
    readonly actorPersonId: string | null;
}

const audited = ({ communityId, chatId, actorPersonId }: ChatOf, action: string, diff: unknown = null) =>
    recordAudit({ communityId, actorPersonId, action, entityType: 'telegram_chat', entityId: String(chatId), diff });

const decodeAction = Schema.decodeUnknownOption(ActionSchema);

// What was proposed for this group while the bot wrote only privately must be shown and approved again
const dropProposals = Effect.fn('Core.dropProposals')(function* (communityId: string, chatId: bigint) {
    const db = yield* Db;
    const group = yield* mainGroupOf(communityId);
    const proposed = yield* db
        .select({ id: pendingAction.id, payload: pendingAction.payload })
        .from(pendingAction)
        .where(and(eq(pendingAction.communityId, communityId), eq(pendingAction.status, 'proposed')));

    for (const { id, payload } of proposed) {
        const action = decodeAction(payload);
        const touched = Option.isSome(action) ? yield* groupsTouched(action.value, { communityId, group }) : [];

        if (touched.some(chat => chat.chatId === chatId)) {
            yield* db
                .update(pendingAction)
                .set({ status: 'expired' })
                .where(and(eq(pendingAction.id, id), eq(pendingAction.status, 'proposed')));
        }
    }
});

export const linkChat = Effect.fn('Core.linkChat')((input: ChatOf & { readonly title: string; readonly topicId?: number | null }) =>
    withCommunityLock(
        { id: input.communityId },
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, chatId } = input;
            const known = yield* findKnownChat(Number(chatId)).pipe(
                Effect.flatMap(found => Effect.fromOption(found.pipe(Option.filter(entry => entry.communityId === communityId)))),
                Effect.mapError(() => ActionFailedError.make({ failure: { code: 'chat_not_linked' } }))
            );

            const { purpose } = known.chat;
            const { title } = input;
            const topicId = Predicate.isUndefined(input.topicId) ? (known.chat.topicId ?? null) : input.topicId;

            if (purpose === 'main') {
                yield* db
                    .update(telegramChat)
                    .set({ purpose: 'other' })
                    .where(
                        and(eq(telegramChat.communityId, communityId), eq(telegramChat.purpose, 'main'), ne(telegramChat.chatId, chatId))
                    );
                yield* db
                    .update(community)
                    .set({ liveSince: sql`coalesce(${community.liveSince}, now())` })
                    .where(eq(community.id, communityId));
            }

            const linked = yield* db
                .insert(telegramChat)
                .values({ chatId, communityId, kind: 'supergroup', purpose, title, topicId })
                .onConflictDoUpdate({
                    target: telegramChat.chatId,
                    set: { purpose, title, ...(Predicate.isUndefined(input.topicId) ? {} : { topicId }) },
                    setWhere: eq(telegramChat.communityId, communityId)
                })
                .returning({ chatId: telegramChat.chatId });

            if (!isNotEmptyArray(linked)) {
                return yield* ActionFailedError.make({ failure: { code: 'chat_not_linked' } });
            }

            return yield* audited(input, 'chat.link', { purpose, topicId });
        })
    )
);

export const unlinkChat = Effect.fn('Core.unlinkChat')((input: ChatOf) =>
    withCommunityLock(
        { id: input.communityId },
        Effect.gen(function* () {
            const db = yield* Db;
            yield* db
                .delete(telegramChat)
                .where(and(eq(telegramChat.chatId, input.chatId), eq(telegramChat.communityId, input.communityId)));
            yield* audited(input, 'chat.unlink');
        })
    )
);

export const setChatSwitch = Effect.fn('Core.setChatSwitch')(
    (input: ChatOf, change: { readonly isPosting: boolean } | { readonly isMentioning: boolean }) =>
        withCommunityLock(
            { id: input.communityId },
            Effect.gen(function* () {
                const db = yield* Db;
                const [changed] = yield* db
                    .update(telegramChat)
                    .set('isPosting' in change && !change.isPosting ? { ...change, isMentioning: false } : change)
                    .where(and(eq(telegramChat.chatId, input.chatId), eq(telegramChat.communityId, input.communityId)))
                    .returning({ title: telegramChat.title });

                if (!isDefined(changed)) {
                    return yield* ActionFailedError.make({ failure: { code: 'chat_not_linked' } });
                }

                if ('isPosting' in change && change.isPosting) {
                    yield* dropProposals(input.communityId, input.chatId);
                }

                yield* audited(input, 'chat.switch', change);

                return changed;
            })
        )
);
