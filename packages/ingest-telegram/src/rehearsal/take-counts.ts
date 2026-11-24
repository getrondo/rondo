import { Db } from '@rondo/db/service/db.service';
import { sql, type SQL } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';

const ResultSchema = Schema.Struct({ rows: Schema.Array(Schema.Struct({ value: Schema.Union([Schema.String, Schema.Finite]) })) });

const entries = (condition: SQL) =>
    sql`select count(*)::int as value from play.lineup_entry entry where not entry.is_guest and ${condition}`;

const hasAccount = sql`exists (select 1 from identity.telegram_account account where account.person_id = entry.person_id)`;

const queries: Readonly<Record<string, SQL>> = {
    games: sql`select count(*)::int as value from scheduling.session`,
    playedGames: sql`select count(*)::int as value from scheduling.session where status = 'played'`,
    gamesWithTeams: sql`select count(distinct session_id)::int as value from play.team_member`,
    gamesWithLineup: sql`select count(distinct session_id)::int as value from play.lineup_entry where team_ordinal > 0`,
    gamesWithVotes: sql`select count(distinct session_id)::int as value from comms.poll_vote`,
    votes: sql`select count(*)::int as value from comms.poll_vote`,
    yesVotes: sql`select count(*)::int as value from comms.poll_vote where choice = 'yes'`,
    accounts: sql`select count(*)::int as value from identity.telegram_account`,
    personsWithAccount: sql`select count(distinct person_id)::int as value from identity.telegram_account`,
    persons: sql`select count(*)::int as value from identity.person`,
    activeMembers: sql`select count(*)::int as value from org.membership where status = 'active'`,
    attendance: sql`select count(*)::int as value from scheduling.attendance`,
    attendanceManual: sql`select count(*)::int as value from scheduling.attendance where source = 'manual'`,
    aliases: sql`select count(*)::int as value from identity.person_alias`,
    sharedAliases: sql`select count(*)::int as value from identity.person_alias where kind = 'placeholder'`,
    sharedEntries: sql`select count(*)::int as value from play.lineup_entry entry join identity.person_alias alias on alias.id = entry.alias_id where alias.kind = 'placeholder' and not entry.is_guest`,
    aliasesLinkedByVotes: sql`select count(*)::int as value from identity.person_alias where resolution::text = 'vote'`,
    aliasesConfirmed: sql`select count(*)::int as value from identity.person_alias where resolution = 'confirmed'`,
    openAliasesWithTenEntries: sql`select count(*)::int as value from identity.person_alias where resolution::text in ('unresolved', 'suggested', 'guest') and occurrences >= 10`,
    entries: entries(sql`true`),
    entriesByAccount: entries(sql`entry.resolved_by = 'account'`),
    entriesByHandle: entries(sql`entry.resolved_by = 'handle'`),
    entriesByAlias: entries(sql`entry.resolved_by = 'alias'`),
    entriesByVote: entries(sql`entry.resolved_by = 'vote'`),
    entriesByVoteShared: entries(
        sql`entry.resolved_by = 'vote' and entry.alias_id in (select id from identity.person_alias where kind = 'placeholder')`
    ),
    entriesManual: entries(sql`entry.resolved_by = 'manual'`),
    entriesWithAccount: entries(hasAccount),
    entriesNicknameOnly: entries(sql`entry.person_id is not null and not ${hasAccount}`),
    entriesUnidentified: entries(sql`entry.person_id is null`),
    guestEntries: sql`select count(*)::int as value from play.lineup_entry where is_guest`,
    guestEntriesWithHost: sql`select count(*)::int as value from play.lineup_entry where is_guest and guest_of_person_id is not null`
};

const checksum = sql`select md5(coalesce(string_agg(line, '|' order by line), '')) as value from (
    select concat_ws(',', session_id, team_ordinal, position, raw, person_id, guest_of_person_id, resolved_by, is_guest) as line from play.lineup_entry
) lines`;

const valueOf = Effect.fn('Rehearsal.valueOf')(function* (query: SQL) {
    const db = yield* Db;
    const result = yield* db.execute(query);
    const { rows } = yield* Schema.decodeUnknownEffect(ResultSchema)(result);

    return String(rows[0]?.value ?? '');
});

export const takeCounts = Effect.fn('Rehearsal.takeCounts')(function* () {
    const names = Object.entries({ ...queries, entryChecksum: checksum });
    const values = yield* Effect.all(names.map(([name, query]) => valueOf(query).pipe(Effect.map(value => [name, value] as const))));

    return new Map(values);
});

export const takeCountsBeforeMigration = Effect.fn('Rehearsal.takeCountsBeforeMigration')(function* () {
    const names = Object.entries(queries);
    const values = yield* Effect.all(
        names.map(([name, query]) =>
            valueOf(query).pipe(
                Effect.orElseSucceed(() => 'n/a'),
                Effect.map(value => [name, value] as const)
            )
        )
    );

    return new Map(values);
});
