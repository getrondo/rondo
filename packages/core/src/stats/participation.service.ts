import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { person, telegramAccount } from '@rondo/db/schema/identity.schema';
import { importedPoll, pollVote, telegramPoll } from '@rondo/db/schema/platform.schema';
import { lineupEntry, teamMember } from '@rondo/db/schema/play.schema';
import { attendance, session, signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, asc, between, countDistinct, desc, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { hasYes, summarize } from './summarize-participation';

import type { PersonGame, PersonPoll } from './participation.model';
import type { DateRange } from './stats.service';

const signedUp = ['in', 'waitlisted'] as const;

export const personPolls = Effect.fn('Core.personPolls')(function* (communityId: string, personId: string) {
    const db = yield* Db;
    const imported = yield* db
        .selectDistinctOn([pollVote.pollId], {
            pollId: pollVote.pollId,
            kind: importedPoll.kind,
            answers: importedPoll.answers,
            choice: pollVote.choice,
            sessionId: importedPoll.sessionId,
            postedOn: sql<string>`${importedPoll.postedAt}::date::text`
        })
        .from(pollVote)
        .innerJoin(importedPoll, eq(importedPoll.pollId, pollVote.pollId))
        .innerJoin(telegramAccount, eq(telegramAccount.tgUserId, pollVote.tgUserId))
        .where(and(eq(importedPoll.communityId, communityId), eq(telegramAccount.personId, personId)))
        .orderBy(pollVote.pollId, desc(pollVote.votedAt));
    const fromBot = yield* db
        .select({
            pollId: telegramPoll.pollId,
            status: signup.status,
            options: telegramPoll.options,
            sessionId: telegramPoll.sessionId,
            postedOn: sql<string>`${telegramPoll.createdAt}::date::text`
        })
        .from(telegramPoll)
        .innerJoin(session, eq(session.id, telegramPoll.sessionId))
        .innerJoin(signup, eq(signup.sessionId, telegramPoll.sessionId))
        .where(and(eq(session.communityId, communityId), eq(signup.personId, personId)));

    return [
        ...imported.map((poll): PersonPoll => Object.assign(poll, { source: 'imported' as const })),
        ...fromBot.map(({ status, options, ...poll }): PersonPoll =>
            Object.assign(poll, {
                source: 'bot' as const,
                kind: 'participation' as const,
                answers: options.length,
                choice: status === 'out' ? 'no' : 'yes'
            })
        )
    ];
});

const voteOf = (polls: readonly PersonPoll[]): PersonGame['vote'] => {
    if (hasYes({ polls })) {
        return 'yes';
    }

    if (polls.some(({ choice }) => choice === 'no')) {
        return 'no';
    }

    return isNotEmptyArray(polls) ? 'unreadable' : 'none';
};

export const personGames = Effect.fn('Core.personGames')(function* (communityId: string, personId: string, polls: readonly PersonPoll[]) {
    const db = yield* Db;
    const votedIn = polls.flatMap(({ sessionId }) => (isDefined(sessionId) ? [sessionId] : []));
    const squadPosted = sql<boolean>`(
        exists (select 1 from play.lineup_entry posted where posted.session_id = scheduling.session.id and posted.team_ordinal > 0)
        or exists (select 1 from play.team_member posted where posted.session_id = scheduling.session.id)
    )`;
    const entries = yield* db
        .select({ sessionId: lineupEntry.sessionId, entryId: lineupEntry.id, messageId: lineupEntry.messageId })
        .from(lineupEntry)
        .where(and(eq(lineupEntry.personId, personId), eq(lineupEntry.isGuest, false), gt(lineupEntry.teamOrdinal, 0)));
    const members = yield* db.select({ sessionId: teamMember.sessionId }).from(teamMember).where(eq(teamMember.personId, personId));
    const played = yield* db
        .select({ sessionId: attendance.sessionId, outcome: attendance.outcome, source: attendance.source })
        .from(attendance)
        .where(eq(attendance.personId, personId));
    const ids = [...new Set([...votedIn, ...[...entries, ...members, ...played].map(({ sessionId }) => sessionId)])];
    const games = yield* db
        .select({ sessionId: session.id, localDate: session.localDate, status: session.status, squadPosted })
        .from(session)
        .where(and(eq(session.communityId, communityId), inArray(session.id, ids)))
        .orderBy(asc(session.localDate));
    const entryBySession = new Map(entries.map(entry => [entry.sessionId, entry]));
    const inTeam = new Set(members.map(({ sessionId }) => sessionId));
    const attendanceBySession = new Map(played.map(row => [row.sessionId, row]));

    return games.map(({ sessionId, localDate, status, squadPosted: isPosted }): PersonGame => {
        const ofGame = polls.filter(poll => poll.sessionId === sessionId);
        const participation = ofGame.filter(({ kind }) => kind === 'participation');
        const entry = entryBySession.get(sessionId);
        const recorded = attendanceBySession.get(sessionId);
        const absent = isPosted ? ('not_named' as const) : ('not_posted' as const);

        return {
            sessionId,
            localDate,
            status,
            polls: participation,
            reserve: ofGame.filter(({ kind }) => kind === 'reserve'),
            vote: voteOf(participation),
            squad: isDefined(entry) || inTeam.has(sessionId) ? 'named' : absent,
            squadEntryId: entry?.entryId ?? null,
            squadMessageId: entry?.messageId ?? null,
            attendance: recorded?.outcome ?? null,
            attendanceSource: recorded?.source ?? null
        };
    });
});

export const personStatistics = Effect.fn('Core.personStatistics')(function* (communityId: string, personId: string) {
    const polls = yield* personPolls(communityId, personId);
    const games = yield* personGames(communityId, personId, polls);
    const yearOf = (date: string): string => date.slice(0, 4);
    const years = [...new Set([...polls.map(({ postedOn }) => yearOf(postedOn)), ...games.map(({ localDate }) => yearOf(localDate))])];

    return {
        total: summarize(polls, games),
        years: years.toSorted().map(year =>
            Object.assign(
                summarize(
                    polls.filter(({ postedOn }) => yearOf(postedOn) === year),
                    games.filter(({ localDate }) => yearOf(localDate) === year)
                ),
                { year }
            )
        )
    };
});

export const rankings = ['participation', 'squads', 'attendance'] as const;

export type Ranking = (typeof rankings)[number];

export const topPlayers = Effect.fn('Core.topPlayers')(function* (
    communityId: string,
    range: DateRange,
    { by = 'participation', limit }: { readonly by?: Ranking; readonly limit: number }
) {
    const db = yield* Db;
    const games = countDistinct(session.id);
    const inRange = and(eq(session.communityId, communityId), between(session.localDate, range.from, range.to));
    const columns = { personId: person.id, name: person.displayName, games };
    const order = [desc(games), asc(person.displayName)] as const;

    if (by === 'squads') {
        return yield* db
            .select(columns)
            .from(lineupEntry)
            .innerJoin(session, eq(session.id, lineupEntry.sessionId))
            .innerJoin(person, eq(person.id, lineupEntry.personId))
            .where(and(inRange, gt(lineupEntry.teamOrdinal, 0)))
            .groupBy(person.id)
            .orderBy(...order)
            .limit(limit);
    }

    if (by === 'attendance') {
        return yield* db
            .select(columns)
            .from(attendance)
            .innerJoin(session, eq(session.id, attendance.sessionId))
            .innerJoin(person, eq(person.id, attendance.personId))
            .where(and(inRange, inArray(attendance.outcome, ['attended', 'late', 'left_early']), eq(session.status, 'played')))
            .groupBy(person.id)
            .orderBy(...order)
            .limit(limit);
    }

    const yesVotes = db
        .select({ sessionId: pollVote.sessionId, personId: telegramAccount.personId })
        .from(pollVote)
        .innerJoin(telegramAccount, eq(telegramAccount.tgUserId, pollVote.tgUserId))
        .where(and(eq(pollVote.choice, 'yes'), isNotNull(pollVote.sessionId)))
        .unionAll(
            db
                .select({ sessionId: signup.sessionId, personId: signup.personId })
                .from(signup)
                .where(inArray(signup.status, [...signedUp]))
        )
        .as('yes_votes');

    return yield* db
        .select(columns)
        .from(yesVotes)
        .innerJoin(session, eq(session.id, yesVotes.sessionId))
        .innerJoin(person, eq(person.id, yesVotes.personId))
        .where(inRange)
        .groupBy(person.id)
        .orderBy(...order)
        .limit(limit);
});
