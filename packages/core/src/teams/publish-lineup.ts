import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { telegramChat } from '@rondo/db/schema/org.schema';
import { messageRef } from '@rondo/db/schema/platform.schema';
import { team, teamColor, teamDraft, teamMember } from '@rondo/db/schema/play.schema';
import { Db } from '@rondo/db/service/db.service';
import { withCommunityLock } from '@rondo/ingest-telegram/load/with-community-lock';
import { Telegram } from '@rondo/telegram/service/telegram.service';
import { and, eq, lt } from 'drizzle-orm';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Ref from 'effect/Ref';

import { recordAudit } from '../audit/record-audit';
import { ActionFailedError } from '../error/action-failed.error';
import { noticeTargets } from '../signups/audience';
import { topicOptions } from '../utils/topic-options.util';

import { badgeOfColour, badgeOfRow } from './badges';
import { placementOf, postOf, postTeamsOf, publishedPlacement } from './lineup-of-draft';
import { lineupDiff, lineupPostHtml } from './lineup-post';
import { loadDraft } from './team-draft.service';
import { loadTeamInputs } from './team-inputs';

import type { Locale } from '../i18n/locale';
import type { GroupTarget } from '../interface/group-target.interface';
import type { DraftState } from './draft-state';
import type { GroupOutcome, PublishOutcome } from './interface/publish.interface';

const notModified = /message is not modified/iu;

const colourIdOf = Effect.fn('Core.colourIdOf')(function* (communityId: string, colour: string) {
    const db = yield* Db;
    const rows = yield* db.select().from(teamColor).where(eq(teamColor.communityId, communityId));
    const found = rows.find(row => badgeOfRow(row)?.colour === colour);

    if (isDefined(found)) {
        return found.id;
    }

    yield* db
        .insert(teamColor)
        .values({ communityId, name: colour, emoji: badgeOfColour(colour)?.badge ?? null })
        .onConflictDoNothing();
    const [created] = yield* db
        .select({ id: teamColor.id })
        .from(teamColor)
        .where(and(eq(teamColor.communityId, communityId), eq(teamColor.name, colour)));

    return created?.id ?? null;
});

export const audienceForTeams = Effect.fn('Core.audienceForTeams')(function* (
    communityId: string,
    sessionId: string,
    fallback: Option.Option<GroupTarget>
) {
    const db = yield* Db;
    const audience = yield* noticeTargets(sessionId, Option.toArray(fallback));
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

const storeSquad = Effect.fn('Core.storeSquad')(function* (communityId: string, sessionId: string, state: DraftState) {
    const db = yield* Db;
    const publishedAt = yield* DateTime.nowAsDate;
    yield* db.delete(team).where(eq(team.sessionId, sessionId));

    for (const [index, members] of state.teams.entries()) {
        const [stored] = yield* db
            .insert(team)
            .values({ sessionId, ordinal: index + 1, colorId: yield* colourIdOf(communityId, state.colours[index] ?? ''), publishedAt })
            .returning({ id: team.id });

        if (isNotEmptyArray(members)) {
            yield* db.insert(teamMember).values(
                members.map(personId => ({
                    teamId: stored?.id ?? '',
                    sessionId,
                    personId,
                    isGk: state.keepers.includes(personId),
                    assignedBy: 'balancer' as const
                }))
            );
        }
    }

    return publishedAt;
});

const toGroup = Effect.fn('Core.lineupToGroup')(function* (
    sessionId: string,
    group: GroupTarget & { readonly title: string },
    html: string
) {
    const db = yield* Db;
    const telegram = yield* Telegram;
    const [existing] = yield* db
        .select({ messageId: messageRef.messageId })
        .from(messageRef)
        .where(
            and(
                eq(messageRef.entityId, sessionId),
                eq(messageRef.purpose, 'lineup'),
                eq(messageRef.chatId, group.chatId),
                lt(messageRef.chatId, 0n)
            )
        );
    const options = { parse_mode: 'HTML' as const, link_preview_options: { is_disabled: true } };

    if (isDefined(existing)) {
        return yield* telegram
            .call('editMessageText', api => api.editMessageText(Number(group.chatId), existing.messageId, html, options))
            .pipe(
                Effect.as<GroupOutcome>({ chatId: group.chatId, title: group.title, status: 'edited', reason: null }),
                Effect.catchIf(
                    error => !error.isUncertain,
                    error =>
                        Effect.succeed<GroupOutcome>({
                            chatId: group.chatId,
                            title: group.title,
                            status: notModified.test(error.description) ? 'edited' : 'refused',
                            reason: error.description
                        })
                )
            );
    }

    const sent = yield* telegram.call('sendMessage', api =>
        api.sendMessage(Number(group.chatId), html, { ...options, ...topicOptions(group) })
    );
    yield* db
        .insert(messageRef)
        .values({ chatId: group.chatId, messageId: sent.message_id, purpose: 'lineup', entityType: 'session', entityId: sessionId })
        .onConflictDoNothing();

    return { chatId: group.chatId, title: group.title, status: 'sent', reason: null } satisfies GroupOutcome;
});

export const publishLineup = Effect.fn('Core.publishLineup')(function* (input: {
    readonly communityId: string;
    readonly sessionId: string;
    readonly version: number | null;
    readonly locale: Locale;
    readonly actorPersonId: string | null;
    readonly privateChatId: number | null;
    readonly fallback: Option.Option<GroupTarget>;
}) {
    const db = yield* Db;
    const telegram = yield* Telegram;
    const isSent = yield* Ref.make(false);
    const publish = Effect.gen(function* () {
        const row = yield* loadDraft(input.sessionId).pipe(
            Effect.flatMap(found => Effect.fromOption(found)),
            Effect.mapError(() => ActionFailedError.make({ reason: 'there are no teams to post' }))
        );

        if (isDefined(input.version) && row.version !== input.version) {
            return yield* ActionFailedError.make({ reason: 'the teams were changed by another admin' });
        }

        const inputs = yield* loadTeamInputs(input.communityId, input.sessionId);
        const teams = postTeamsOf(row.state, inputs.members);
        const previous = yield* publishedPlacement(input.sessionId);
        const diff = isNotEmptyArray(previous) ? lineupDiff(previous, placementOf(teams)) : [];
        const audience = yield* audienceForTeams(input.communityId, input.sessionId, input.fallback);
        const post = (isUpdate: boolean) =>
            lineupPostHtml(postOf(inputs.game, teams, { locale: input.locale, showHandles: inputs.settings.showHandles, isUpdate }));
        const clean = post(false);
        const publishedAt = yield* storeSquad(input.communityId, input.sessionId, row.state);
        const groups: GroupOutcome[] = [];

        for (const group of audience.groups) {
            const outcome = yield* toGroup(input.sessionId, group, clean);
            yield* Ref.update(isSent, wasSent => wasSent || outcome.status !== 'refused');
            groups.push(outcome);
        }

        const isPrivateDue = audience.isPrivate && isDefined(input.privateChatId) && row.privateText !== clean;

        if (isPrivateDue) {
            yield* telegram.call('sendMessage', api =>
                api.sendMessage(input.privateChatId ?? 0, post(isDefined(row.privateText)), {
                    parse_mode: 'HTML',
                    link_preview_options: { is_disabled: true }
                })
            );
            yield* Ref.set(isSent, true);
        }

        if (isNotEmptyArray(groups) && groups.every(outcome => outcome.status === 'refused') && !isPrivateDue) {
            return yield* ActionFailedError.make({
                reason: groups.find(outcome => isDefined(outcome.reason))?.reason ?? 'Telegram refused'
            });
        }

        yield* db
            .update(teamDraft)
            .set({ publishedAt, ...(isPrivateDue ? { privateText: clean } : {}) })
            .where(eq(teamDraft.sessionId, input.sessionId));
        yield* recordAudit({
            communityId: input.communityId,
            actorPersonId: input.actorPersonId,
            action: 'teams.publish',
            entityType: 'session',
            entityId: input.sessionId,
            diff: { groups: groups.length, isPrivate: isPrivateDue }
        });

        const privateStatus = isPrivateDue ? 'sent' : 'unchanged';

        return { groups, privateStatus: audience.isPrivate ? privateStatus : null, diff } satisfies PublishOutcome;
    });

    return yield* withCommunityLock({ id: input.communityId }, publish).pipe(
        Effect.catchCause(cause =>
            Effect.gen(function* () {
                if (!(yield* Ref.get(isSent))) {
                    return yield* Effect.failCause(cause);
                }

                yield* Effect.logError('[teams] sent but not saved', cause);

                return yield* ActionFailedError.make({ reason: 'the teams were sent but may not be saved, check the chat' });
            })
        )
    );
});
