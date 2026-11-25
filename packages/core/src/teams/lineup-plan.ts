import { createHash } from 'node:crypto';

import { isDefined, isEmptyArray, isNotEmptyArray, isNotEmptyString } from '@rnw-community/shared';
import { telegramChat } from '@rondo/db/schema/org.schema';
import { importedPoll } from '@rondo/db/schema/platform.schema';
import { lineupDelivery, ratingEvent } from '@rondo/db/schema/play.schema';
import { Db } from '@rondo/db/service/db.service';
import { eq } from 'drizzle-orm';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { postingChatsOf } from '../community/community.repository';
import { ActionFailedError } from '../error/action-failed.error';
import { noticeTargets } from '../signups/audience';

import { placementOf, postOf, postTeamsOf, publishedPlacement } from './lineup-of-draft';
import { lineupDiff, lineupPostHtml } from './lineup-post';
import { busyMs } from './publish-claim';
import { loadDraft, type DraftRow } from './team-draft.service';
import { loadTeamInputs } from './team-inputs';

import type { Locale } from '../i18n/locale';
import type { GroupTarget } from '../interface/group-target.interface';
import type { DraftState } from './draft-state';
import type { LineupPlan, PlannedDelivery } from './interface/publish.interface';
import type { TeamInputs } from './interface/team-inputs.interface';

export interface PlanInput {
    readonly communityId: string;
    readonly sessionId: string;
    readonly locale: Locale;
    readonly privateChatId: number | null;
    readonly fallback: Option.Option<GroupTarget>;
    readonly state?: DraftState;
    readonly loaded?: { readonly row: DraftRow; readonly inputs: TeamInputs };
    readonly retryToken?: string | null;
    readonly asNewMessage?: boolean;
}

const audienceForTeams = Effect.fn('Core.audienceForTeams')(function* (
    communityId: string,
    sessionId: string,
    { fallback, privateChatId }: Pick<PlanInput, 'fallback' | 'privateChatId'>
) {
    const db = yield* Db;
    // The chats of the imported polls decide: the groups the bot has, else the admin, never the main group
    const imported = yield* db.select({ chatId: importedPoll.chatId }).from(importedPoll).where(eq(importedPoll.sessionId, sessionId));
    const ownIds = new Set(imported.flatMap(({ chatId }) => (isDefined(chatId) ? [BigInt(chatId)] : [])));
    const own = (yield* postingChatsOf(communityId)).filter(chat => ownIds.has(chat.chatId));
    const admin = isDefined(privateChatId) ? [{ chatId: BigInt(privateChatId), topicId: null }] : [];
    const audience = yield* noticeTargets(sessionId, isNotEmptyArray(imported) ? own : Option.toArray(fallback), admin);
    const isPrivate = audience.some(target => target.chatId > 0n);
    const targets = audience.filter(target => target.chatId < 0n);
    const titles = isNotEmptyArray(targets)
        ? yield* db
              .select({ chatId: telegramChat.chatId, title: telegramChat.title })
              .from(telegramChat)
              .where(eq(telegramChat.communityId, communityId))
        : [];

    return {
        groups: targets.map(target => ({
            chatId: target.chatId,
            topicId: target.topicId,
            title: titles.find(row => row.chatId === target.chatId)?.title ?? ''
        })),
        isPrivate
    };
});

const isDueBy = (
    stored: PlannedDelivery['stored'],
    storedText: string | null,
    text: string,
    { isRetry, isUnsaved }: { readonly isRetry: boolean; readonly isUnsaved: boolean }
): boolean => {
    if (stored === 'busy') {
        return false;
    }

    if (stored === 'claimed' || stored === 'uncertain') {
        return isRetry;
    }

    // A posted line-up without its stored squad is posted again, so the squad is stored with it
    return stored !== 'sent' || storedText !== text || isUnsaved;
};

const fingerprintOf = (deliveries: readonly PlannedDelivery[], clearsResult: boolean): string =>
    createHash('sha256')
        .update(
            JSON.stringify([
                clearsResult,
                deliveries.map(entry => [String(entry.chatId), entry.topicId, entry.isDue ? entry.html : [entry.stored, entry.token]])
            ])
        )
        .digest('base64url')
        .slice(0, 8);

export const planLineup = Effect.fn('Core.planLineup')(function* (input: PlanInput) {
    const db = yield* Db;
    const row =
        input.loaded?.row ??
        (yield* loadDraft(input.sessionId).pipe(
            Effect.flatMap(found => Effect.fromOption(found)),
            Effect.mapError(() => ActionFailedError.make({ failure: { code: 'no_teams' } }))
        ));
    const inputs = input.loaded?.inputs ?? (yield* loadTeamInputs(input.communityId, input.sessionId));
    const teams = postTeamsOf(input.state ?? row.state, inputs.members);
    const previous = yield* publishedPlacement(input.sessionId);
    const placement = placementOf(teams);
    const diff = isNotEmptyArray(previous) ? lineupDiff(previous, placement, input.locale) : [];
    const teamOf = new Map(previous.map(entry => [entry.personId, entry.team]));
    const isSquadChanged = previous.length !== placement.length || placement.some(entry => teamOf.get(entry.personId) !== entry.team);
    const audience = yield* audienceForTeams(input.communityId, input.sessionId, input);
    const stored = yield* db.select().from(lineupDelivery).where(eq(lineupDelivery.sessionId, input.sessionId));
    const results = yield* db.select({ at: ratingEvent.at }).from(ratingEvent).where(eq(ratingEvent.sessionId, input.sessionId)).limit(1);
    const post = (isUpdate: boolean) =>
        lineupPostHtml(postOf(inputs.game, teams, { locale: input.locale, showHandles: inputs.settings.showHandles, isUpdate }));
    const clean = post(false);
    const isUpdate = stored.some(entry => entry.status === 'sent');
    // The admin gets the line-up to forward when the poll went to them or no group of the bot can get it
    const isToAdmin = audience.isPrivate || isEmptyArray(audience.groups);
    const self = isToAdmin && isDefined(input.privateChatId) ? [{ chatId: BigInt(input.privateChatId), topicId: null, title: null }] : [];
    const now = yield* DateTime.nowAsDate;
    const deliveries = [...audience.groups, ...self].map((target): PlannedDelivery => {
        const found = stored.find(entry => entry.chatId === target.chatId);
        const isBusy = found?.status === 'claimed' && found.updatedAt.getTime() > now.getTime() - busyMs;
        const status = isBusy ? 'busy' : (found?.status ?? null);
        const isPrivate = target.chatId > 0n;
        // A post in another topic of the same chat is a new message, never an edit or a receipt of the old one
        const isSameTopic = (found?.topicId ?? null) === target.topicId;
        const isDue = isDueBy(status, isSameTopic ? (found?.text ?? null) : null, clean, {
            isRetry: isDefined(found) && isNotEmptyString(input.retryToken) && found.token.startsWith(input.retryToken),
            isUnsaved: isSquadChanged
        });

        return {
            chatId: target.chatId,
            topicId: target.topicId,
            title: target.title,
            html: isPrivate && isUpdate && isDue ? post(true) : clean,
            text: clean,
            messageId: isPrivate || !isSameTopic || input.asNewMessage === true ? null : (found?.messageId ?? null),
            stored: status,
            token: found?.token ?? null,
            isDue
        };
    });
    const clearsResult = isNotEmptyArray(results) && isSquadChanged;

    return {
        version: row.version,
        teams,
        deliveries,
        diff,
        isUpdate,
        clearsResult,
        fingerprint: fingerprintOf(deliveries, clearsResult)
    } satisfies LineupPlan;
});
