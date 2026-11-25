import { isEmptyString, isNotEmptyArray } from '@rnw-community/shared';
import { person } from '@rondo/db/schema/identity.schema';
import { messageRef } from '@rondo/db/schema/platform.schema';
import { rating, team, teamColor, teamMember } from '@rondo/db/schema/play.schema';
import { session, signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { withCommunityLock } from '@rondo/ingest-telegram/load/with-community-lock';
import { escapeHtml } from '@rondo/telegram/format/html';
import { Telegram } from '@rondo/telegram/service/telegram.service';
import { and, asc, eq, inArray } from 'drizzle-orm';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as Ref from 'effect/Ref';

import { recordAudit } from '../audit/record-audit';
import { ActionFailedError } from '../error/action-failed.error';
import { formatSessionLabel, text } from '../i18n/messages';
import { arePeopleOf } from '../people/people.service';
import { footballActivity, requireSession } from '../sessions/session.service';
import { placeHtml, placeOf } from '../signups/place-block';
import { topicOptions } from '../utils/topic-options.util';

import { balanceTeams, type BalancedTeam, type BalancePlayer } from './balance-teams';

import type { Locale } from '../i18n/locale';
import type { GroupTarget } from '../interface/group-target.interface';
import type { SessionView } from '../sessions/session.model';

const defaultStrength = 5;

const playersSignedIn = Effect.fn('Core.playersSignedIn')(function* (sessionId: string) {
    const db = yield* Db;
    const rows = yield* db
        .select({ personId: signup.personId, displayName: person.displayName, role: signup.role, activityId: session.activityId })
        .from(signup)
        .innerJoin(person, eq(person.id, signup.personId))
        .innerJoin(session, eq(session.id, signup.sessionId))
        .where(and(eq(signup.sessionId, sessionId), eq(signup.status, 'in')))
        .orderBy(asc(signup.createdAt));

    if (!isNotEmptyArray(rows)) {
        return [];
    }

    const ratings = yield* db
        .select({ personId: rating.personId, mu: rating.mu })
        .from(rating)
        .where(
            and(
                eq(rating.activityId, rows[0].activityId),
                eq(rating.model, 'organizer_seed'),
                inArray(
                    rating.personId,
                    rows.map(row => row.personId)
                )
            )
        );
    const strengthOf = new Map(ratings.map(row => [row.personId, row.mu]));

    return rows.map((row): BalancePlayer => ({
        personId: row.personId,
        displayName: row.displayName,
        strength: strengthOf.get(row.personId) ?? defaultStrength,
        isGk: row.role === 'gk'
    }));
});

export const proposeTeams = Effect.fn('Core.proposeTeams')(function* (sessionId: string, teamCount: number) {
    const players = yield* playersSignedIn(sessionId);

    return balanceTeams(players, teamCount);
});

export const setSeedRating = Effect.fn('Core.setSeedRating')(function* (input: {
    readonly personId: string;
    readonly communityId: string;
    readonly level: number;
    readonly actorPersonId: string | null;
}) {
    const db = yield* Db;
    const activityId = yield* footballActivity(input.communityId);

    yield* db
        .insert(rating)
        .values({ personId: input.personId, activityId, model: 'organizer_seed', mu: input.level, sigma: 0 })
        .onConflictDoUpdate({ target: [rating.personId, rating.activityId, rating.model], set: { mu: input.level } });
    yield* recordAudit({
        communityId: input.communityId,
        actorPersonId: input.actorPersonId,
        action: 'rating.seed',
        entityType: 'person',
        entityId: input.personId
    });
});

const lineupText = (locale: Locale, target: SessionView, teams: readonly BalancedTeam[], emojis: readonly string[]): string => {
    const lines = teams.map((entry, index) => {
        const names = entry.players.map(player => `${escapeHtml(player.displayName)}${player.isGk ? ' 🧤' : ''}`).join(', ');

        return `${emojis[index] ?? `${entry.ordinal}.`} ${names}`;
    });

    const place = placeHtml(placeOf(target));

    return [
        `<b>${text(locale, 'lineups')}: ${escapeHtml(formatSessionLabel(locale, target))}</b>`,
        ...(isEmptyString(place) ? [] : [place]),
        ...lines
    ].join('\n');
};

const teamColorsOf = Effect.fn('Core.teamColorsOf')(function* (communityId: string) {
    const db = yield* Db;

    return yield* db.select().from(teamColor).where(eq(teamColor.communityId, communityId)).orderBy(asc(teamColor.name));
});

export const lineupHtml = Effect.fn('Core.lineupHtml')(function* (locale: Locale, target: SessionView, teams: readonly BalancedTeam[]) {
    const colors = yield* teamColorsOf(target.communityId);

    return lineupText(
        locale,
        target,
        teams,
        colors.map(color => color.emoji ?? '')
    );
});

interface PublishInput {
    readonly target: SessionView;
    readonly teams: readonly BalancedTeam[];
    readonly groups: readonly GroupTarget[];
    readonly locale: Locale;
    readonly actorPersonId: string | null;
}

const storeTeams = Effect.fn('Core.storeTeams')(function* ({ target, teams }: PublishInput, colorIds: readonly string[]) {
    const db = yield* Db;
    yield* requireSession(target.communityId, target.id);

    if (
        !(yield* arePeopleOf(
            target.communityId,
            teams.flatMap(({ players }) => players.map(({ personId }) => personId))
        ))
    ) {
        return yield* ActionFailedError.make({ reason: 'player not found in this community' });
    }

    const publishedAt = yield* DateTime.nowAsDate;
    yield* db.delete(team).where(eq(team.sessionId, target.id));

    for (const entry of teams) {
        const [stored] = yield* db
            .insert(team)
            .values({
                sessionId: target.id,
                ordinal: entry.ordinal,
                colorId: colorIds[entry.ordinal - 1],
                predictedStrength: entry.strength,
                publishedAt
            })
            .returning({ id: team.id });

        if (isNotEmptyArray(entry.players)) {
            yield* db.insert(teamMember).values(
                entry.players.map(player => ({
                    teamId: stored?.id ?? '',
                    sessionId: target.id,
                    personId: player.personId,
                    isGk: player.isGk,
                    assignedBy: 'balancer' as const
                }))
            );
        }
    }

    return target.id;
});

// Stored and sent in one transaction, so a refused post keeps the teams that are in the group
export const publishTeams = Effect.fn('Core.publishTeams')(function* (input: PublishInput) {
    const db = yield* Db;
    const telegram = yield* Telegram;
    const { communityId } = input.target;
    const isSent = yield* Ref.make(false);
    const publish = Effect.gen(function* () {
        const colors = yield* teamColorsOf(communityId);
        yield* storeTeams(
            input,
            colors.map(color => color.id)
        );
        yield* recordAudit({
            communityId,
            actorPersonId: input.actorPersonId,
            action: 'teams.publish',
            entityType: 'session',
            entityId: input.target.id
        });
        const emojis = colors.map(color => color.emoji ?? '');
        for (const group of input.groups) {
            const sent = yield* telegram.call('sendMessage', api =>
                api.sendMessage(Number(group.chatId), lineupText(input.locale, input.target, input.teams, emojis), {
                    parse_mode: 'HTML',
                    ...topicOptions(group)
                })
            );
            yield* Ref.set(isSent, true);
            yield* db
                .insert(messageRef)
                .values({
                    chatId: group.chatId,
                    messageId: sent.message_id,
                    purpose: 'lineup',
                    entityType: 'session',
                    entityId: input.target.id
                })
                .onConflictDoNothing();
        }
    });

    yield* withCommunityLock({ id: communityId }, publish).pipe(
        Effect.catchCause(cause =>
            Effect.gen(function* () {
                if (!(yield* Ref.get(isSent))) {
                    return yield* Effect.failCause(cause);
                }

                yield* Effect.logError('[teams] sent but not saved', cause);

                return yield* ActionFailedError.make({ reason: 'the teams were sent but may not be saved, check the group' });
            })
        )
    );
});
