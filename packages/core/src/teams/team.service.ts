import { isNotEmptyArray } from '@rnw-community/shared';
import { person } from '@rondo/db/schema/identity.schema';
import { messageRef } from '@rondo/db/schema/platform.schema';
import { rating, team, teamColor, teamMember } from '@rondo/db/schema/play.schema';
import { session, signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { escapeHtml } from '@rondo/telegram/format/html';
import { Telegram } from '@rondo/telegram/service/telegram.service';
import { and, asc, eq, inArray } from 'drizzle-orm';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';

import { recordAudit } from '../audit/record-audit';
import { formatSessionLabel, text } from '../i18n/messages';
import { footballActivity } from '../sessions/session.service';

import { balanceTeams, type BalancedTeam, type BalancePlayer } from './balance-teams';

import type { Locale } from '../i18n/locale';
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

    return [`<b>${text(locale, 'lineups')}: ${escapeHtml(formatSessionLabel(locale, target))}</b>`, ...lines].join('\n');
};

export const publishTeams = Effect.fn('Core.publishTeams')(function* (input: {
    readonly target: SessionView;
    readonly teams: readonly BalancedTeam[];
    readonly chatId: bigint;
    readonly locale: Locale;
    readonly actorPersonId: string | null;
}) {
    const db = yield* Db;
    const telegram = yield* Telegram;
    const colors = yield* db
        .select()
        .from(teamColor)
        .where(eq(teamColor.communityId, input.target.communityId))
        .orderBy(asc(teamColor.name));
    const emojis = colors.map(color => color.emoji ?? '');

    yield* db.delete(team).where(eq(team.sessionId, input.target.id));

    for (const entry of input.teams) {
        const publishedAt = yield* DateTime.nowAsDate;
        const [stored] = yield* db
            .insert(team)
            .values({
                sessionId: input.target.id,
                ordinal: entry.ordinal,
                colorId: colors[entry.ordinal - 1]?.id,
                predictedStrength: entry.strength,
                publishedAt
            })
            .returning({ id: team.id });

        if (isNotEmptyArray(entry.players)) {
            yield* db.insert(teamMember).values(
                entry.players.map(player => ({
                    teamId: stored?.id ?? '',
                    sessionId: input.target.id,
                    personId: player.personId,
                    isGk: player.isGk,
                    assignedBy: 'balancer' as const
                }))
            );
        }
    }

    const sent = yield* telegram.call('sendMessage', api =>
        api.sendMessage(Number(input.chatId), lineupText(input.locale, input.target, input.teams, emojis), { parse_mode: 'HTML' })
    );
    yield* db
        .insert(messageRef)
        .values({ chatId: input.chatId, messageId: sent.message_id, purpose: 'lineup', entityType: 'session', entityId: input.target.id })
        .onConflictDoNothing();
    yield* recordAudit({
        communityId: input.target.communityId,
        actorPersonId: input.actorPersonId,
        action: 'teams.publish',
        entityType: 'session',
        entityId: input.target.id
    });
});
