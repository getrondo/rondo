import { expect, layer } from '@effect/vitest';
import { aliasLink, person, personAlias, telegramAccount } from '@rondo/db/schema/identity.schema';
import { auditLog, pollVote } from '@rondo/db/schema/platform.schema';
import { lineupEntry } from '@rondo/db/schema/play.schema';
import { attendance, session, signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { removeUnusedNicknames } from '@rondo/ingest-telegram/load/remove-unused-nicknames';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Tracer from 'effect/Tracer';

import { syncMember, upsertTelegramUser } from '../src/identity/telegram-user';
import { ingestGroupMessage } from '../src/live/live-ingest';
import { linkAlias, linkEntry, reviewEntries, suggestAliasLinks, unlinkAlias, unlinkEntry } from '../src/people/alias-links.service';
import { mergePeople, renamePerson, searchPeople } from '../src/people/people.service';
import { createSession, updateSession, requireSession } from '../src/sessions/session.service';
import { signedUpByVotes } from '../src/signups/signed-up-by-votes';
import { applyPollAnswer } from '../src/signups/signup.service';
import { personStatistics, topPlayers } from '../src/stats/participation.service';
import { inactivePlayers } from '../src/stats/stats.service';
import { publishTeams } from '../src/teams/team.service';
import { recordedTelegramDbLayer } from '../src/testing/recorded-telegram.layer';
import { seedCommunity, seedConfig } from '../src/testing/seed-community';

const linkColumns = {
    status: aliasLink.status,
    personId: aliasLink.personId,
    during: sql<string>`${aliasLink.during}::text`,
    method: aliasLink.method,
    decidedBy: aliasLink.decidedBy,
    decidedAt: aliasLink.decidedAt
};

const range = { from: '2026-01-01', to: '2026-12-31' };

const seeded = Effect.fn('test.seeded')(function* (slug: string, orgId: bigint, lineup: string) {
    const db = yield* Db;
    const config = seedConfig(slug);
    const { communityId } = yield* seedCommunity(config);
    const organizer = yield* upsertTelegramUser({ id: orgId, firstName: 'Org' });
    yield* ingestGroupMessage(communityId, config, {
        chatId: -orgId,
        messageId: 1,
        sentAt: new Date('2026-05-04T15:00:00Z'),
        senderPersonId: organizer,
        senderTgUserId: orgId,
        senderName: 'Org',
        isTrusted: true,
        text: `Составы на сегодня, North:\n${lineup}`
    });
    yield* db.update(session).set({ status: 'played' }).where(eq(session.communityId, communityId));
    const [game] = yield* db.select().from(session).where(eq(session.communityId, communityId));
    const aliases = yield* db.select().from(personAlias).where(eq(personAlias.communityId, communityId));
    const account = yield* syncMember(communityId, { id: orgId + 1n, firstName: 'Tele', lastName: 'Gram' }, 'active');

    return {
        communityId,
        organizer,
        account,
        sessionId: game?.id ?? '',
        aliasId: (norm: string) => aliases.find(alias => alias.aliasNorm === norm)?.id ?? ''
    };
});

const gamesOf = Effect.fn('test.gamesOf')(function* (communityId: string) {
    return Object.fromEntries(
        (yield* topPlayers(communityId, range, { by: 'attendance', limit: 50 })).map(({ name, games }) => [name, games])
    );
});

const firstStatementOf = Effect.fn('test.firstStatementOf')(function* <Value, Failure, Requirements>(
    effect: Effect.Effect<Value, Failure, Requirements>
) {
    const statements: string[] = [];
    const tracer = Tracer.make({
        span: options => {
            const span = new Tracer.NativeSpan(options);
            const record = span.attribute.bind(span);
            span.attribute = (key, value) => {
                if (key === 'db.query.text') {
                    statements.push(String(value));
                }

                record(key, value);
            };

            return span;
        }
    });
    yield* effect.pipe(Effect.withTracer(tracer));

    return statements[0] ?? '';
});

const underLockGuard = <Value, Failure, Requirements>(slug: string, table: SQL, effect: Effect.Effect<Value, Failure, Requirements>) =>
    Effect.gen(function* () {
        const db = yield* Db;
        yield* db.execute(sql`
            create function play.require_lock() returns trigger language plpgsql as $$
            begin
                if not exists (
                    select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and granted
                    and ((classid::bigint << 32) | objid::bigint) = hashtextextended(tg_argv[0], 0)
                ) then
                    raise exception 'no community lock';
                end if;
                return new;
            end $$`);
        yield* db.execute(
            sql`create trigger require_lock before insert on ${table} for each row execute function play.require_lock(${sql.raw(`'rondo.community:${slug}'`)})`
        );

        return yield* Effect.exit(effect).pipe(
            Effect.ensuring(db.execute(sql`drop function play.require_lock cascade`).pipe(Effect.orDie))
        );
    });

const recordedOf = Effect.fn('test.recordedOf')(function* (communityId: string, personId: string) {
    const { total } = yield* personStatistics(communityId, personId);

    return { games: total.games.attendanceRecorded };
});

const nameOf = Effect.fn('test.nameOf')(function* (personId: string) {
    const db = yield* Db;
    const [row] = yield* db.select({ name: person.displayName }).from(person).where(eq(person.id, personId));

    return row?.name;
});

layer(recordedTelegramDbLayer, { timeout: 60_000 })('alias links', it => {
    it.effect('links and unlinks a nickname, restores the counts and keeps names out of the audit log', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, account, aliasId } = yield* seeded('link-fc', 100n, '🟢Я, Гонзо +1\n🔵Олег, Семён');
            const before = yield* gamesOf(communityId);
            const target = { communityId, aliasId: aliasId('гонзо'), actorPersonId: null };

            yield* linkAlias({ ...target, personId: account });
            const linkedName = yield* nameOf(account);
            const linkedGames = yield* recordedOf(communityId, account);
            const [guest] = yield* db.select().from(lineupEntry).where(eq(lineupEntry.guestOfPersonId, account));
            yield* renamePerson({ communityId, personId: account, displayName: 'Chosen', actorPersonId: null });
            yield* unlinkAlias(target);
            const renamed = yield* nameOf(account);
            const audit = yield* db
                .select()
                .from(auditLog)
                .where(and(eq(auditLog.communityId, communityId), eq(auditLog.entityType, 'alias')));

            expect(linkedName).toBe('Гонзо');
            expect(linkedGames).toMatchObject({ games: 1 });
            expect(guest?.resolvedBy).toBe('guest');
            expect(yield* gamesOf(communityId)).toEqual(before);
            expect(renamed).toBe('Chosen');
            expect(audit.map(({ action }) => action).toSorted()).toEqual(['alias.link', 'alias.unlink']);
            expect(JSON.stringify(audit)).not.toContain('Гонзо');
        })
    );

    it.effect('refuses a link when the player is already in the same line-up', () =>
        Effect.gen(function* () {
            const { communityId, account, aliasId, organizer } = yield* seeded('refuse-fc', 110n, '🟢Я, Гонзо\n🔵Олег, Семён');
            const link = (norm: string, personId: string) =>
                linkAlias({ communityId, aliasId: aliasId(norm), personId, actorPersonId: null });

            yield* link('гонзо', account);
            const sameAlias = yield* Effect.flip(link('олег', account));
            const self = yield* Effect.flip(link('олег', organizer));

            expect(sameAlias._tag).toBe('ActionFailedError');
            expect(self._tag).toBe('ActionFailedError');
        })
    );

    it.effect('marks a nickname shared after two games, links it per entry and offers it for review', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const lineup = '🟢Я, Зорро\n🔵Олег, Зорро';
            const { communityId, account, aliasId, sessionId, organizer } = yield* seeded('shared-fc', 120n, lineup);
            const once = yield* db.select().from(attendance).where(eq(attendance.sessionId, sessionId));
            yield* ingestGroupMessage(communityId, seedConfig('shared-fc'), {
                chatId: -120n,
                messageId: 2,
                sentAt: new Date('2026-05-11T15:00:00Z'),
                senderPersonId: organizer,
                senderTgUserId: 120n,
                senderName: 'Org',
                isTrusted: true,
                text: `Составы на сегодня, North:\n${lineup}`
            });
            const votedAt = new Date('2026-05-01T00:00:00Z');
            yield* db.insert(pollVote).values({ pollId: 'shared-1', tgUserId: 121n, sessionId, choice: 'yes', votedAt });
            const twice = yield* db.select().from(attendance).where(eq(attendance.sessionId, sessionId));
            const ranked = yield* gamesOf(communityId);
            const refused = yield* Effect.flip(
                linkAlias({ communityId, aliasId: aliasId('зорро'), personId: account, actorPersonId: null })
            );
            const review = yield* reviewEntries(communityId, 20);
            const [offered, twin] = review.filter(entry => entry.shared && entry.sessionId === sessionId);
            const target = { communityId, entryId: offered?.entryId ?? '', actorPersonId: null };
            yield* linkEntry({ ...target, personId: account });
            const sameGame = yield* Effect.flip(linkEntry({ ...target, entryId: twin?.entryId ?? '', personId: account }));
            const linked = yield* recordedOf(communityId, account);
            yield* unlinkEntry(target);
            const unlinked = yield* recordedOf(communityId, account);

            expect(once).toHaveLength(3);
            expect(twice).toHaveLength(2);
            expect(Object.keys(ranked).toSorted()).toEqual(['Org', 'Олег']);
            expect(refused).toMatchObject({ _tag: 'ActionFailedError', reason: 'several players share this nickname, link it per game' });
            expect(review.filter(entry => entry.shared)).toHaveLength(4);
            expect(offered?.candidatePersonIds).toEqual([account]);
            expect(sameGame._tag).toBe('ActionFailedError');
            expect(linked).toMatchObject({ games: 1 });
            expect(unlinked).toMatchObject({ games: 0 });
            expect((yield* suggestAliasLinks(communityId, 10)).map(suggestion => suggestion.alias)).not.toContain('Зорро');
        })
    );

    it.effect.each([
        { resolvedBy: 'vote' as const, orgId: 180n },
        { resolvedBy: 'alias' as const, orgId: 320n }
    ])('keeps an entry linked by $resolvedBy and undone by an admin as a manual record', ({ resolvedBy, orgId }) =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, account, aliasId, sessionId } = yield* seeded(`${resolvedBy}-undo-fc`, orgId, '🟢Я, Гонзо\n🔵Олег, Семён');
            const ofAlias = and(eq(lineupEntry.aliasId, aliasId('гонзо')), eq(lineupEntry.sessionId, sessionId));
            const [entry] = yield* db.update(lineupEntry).set({ personId: account, resolvedBy }).where(ofAlias).returning();
            yield* unlinkEntry({ communityId, entryId: entry?.id ?? '', actorPersonId: null });
            const [undone] = yield* db.select().from(lineupEntry).where(ofAlias);

            expect(undone?.resolvedBy).toBe('manual');
            expect(undone?.personId).not.toBe(account);
        })
    );

    it.effect('merges two accounts of one player and refuses when both are in one game', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, account, organizer, sessionId } = yield* seeded('two-accounts-fc', 130n, '🟢Я, Гонзо\n🔵Олег, Семён');
            const second = yield* syncMember(communityId, { id: 139n, firstName: 'Second' }, 'active');
            const [inGame] = yield* db
                .select()
                .from(lineupEntry)
                .where(and(eq(lineupEntry.raw, 'Гонзо'), eq(lineupEntry.sessionId, sessionId)));
            const merge = (fromPersonId: string, intoPersonId: string) =>
                mergePeople({ communityId, fromPersonId, intoPersonId, actorPersonId: null });

            yield* merge(second, account);
            const accounts = yield* db.select().from(telegramAccount).where(eq(telegramAccount.personId, account));
            const found = yield* searchPeople(communityId, 'Tele', 10);
            const conflict = yield* Effect.flip(merge(inGame?.personId ?? '', organizer));

            expect(accounts).toHaveLength(2);
            expect(found).toHaveLength(1);
            expect(conflict._tag).toBe('ActionFailedError');
        })
    );

    it.effect('promotes a player with two accounts once and does not waste a seat', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, account } = yield* seeded('promote-fc', 140n, '🟢Я, Гонзо\n🔵Олег, Семён');
            const second = yield* syncMember(communityId, { id: 149n, firstName: 'Second' }, 'active');
            yield* mergePeople({ communityId, fromPersonId: second, intoPersonId: account, actorPersonId: null });
            const sessionId = yield* createSession({
                communityId,
                timezone: 'Europe/Vienna',
                localDate: '2026-12-01',
                localTime: '19:00',
                venueId: null,
                capacityMax: 1,
                title: null,
                actorPersonId: null
            });
            const others = yield* Effect.all([150n, 151n].map(id => syncMember(communityId, { id, firstName: `P${id}` }, 'active')));
            yield* db.insert(signup).values([
                { sessionId, personId: others[0] ?? '', status: 'in' },
                { sessionId, personId: account, status: 'waitlisted', updatedAt: new Date('2026-11-01T00:00:00Z') },
                { sessionId, personId: others[1] ?? '', status: 'waitlisted', updatedAt: new Date('2026-11-02T00:00:00Z') }
            ]);
            yield* db.execute(
                `insert into comms.telegram_poll (poll_id, chat_id, message_id, session_id, options) values ('promote', -1, 1, '${sessionId}', '["in","gk","out"]')`
            );
            const target = yield* requireSession(communityId, sessionId);
            yield* updateSession(target, { capacityMax: 2 }, 'Europe/Vienna', null);
            const outcome = yield* applyPollAnswer({ pollId: 'promote', user: { id: 150n, firstName: 'P150' }, optionIds: [2] });

            expect(outcome).toMatchObject({ value: { promoted: [{ personId: account }, { personId: others[1] }] } });
        })
    );

    it.effect('moves a username to the account that shows it last', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            yield* upsertTelegramUser({ id: 160n, firstName: 'Old', username: 'Striker' });
            yield* upsertTelegramUser({ id: 161n, firstName: 'New', username: 'striker' });
            const rows = yield* db.select().from(telegramAccount).where(eq(telegramAccount.tgUserId, 160n));
            const [owner] = yield* db.select().from(telegramAccount).where(eq(telegramAccount.tgUserId, 161n));

            expect(rows[0]?.username).toBeNull();
            expect(owner?.username).toBe('striker');
        })
    );

    it.effect('lists yes voters in time order, separate from attendance', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, account, organizer, sessionId } = yield* seeded('votes-fc', 170n, '🟢Я, Гонзо\n🔵Олег, Семён');
            yield* db.insert(pollVote).values([
                { pollId: 'votes-1', tgUserId: 171n, sessionId, choice: 'yes', votedAt: new Date('2026-05-02T10:00:00Z') },
                { pollId: 'votes-1', tgUserId: 170n, sessionId, choice: 'yes', votedAt: new Date('2026-05-01T10:00:00Z') }
            ]);
            const voters = yield* signedUpByVotes(sessionId);

            expect(voters.map(({ personId }) => personId)).toEqual([organizer, account]);
            expect(yield* recordedOf(communityId, account)).toMatchObject({ games: 0 });
        })
    );

    it.effect('confirms only the nicknames of the merged person and leaves vote links of the other alone', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, account, aliasId } = yield* seeded('merge-names-fc', 190n, '🟢Я, Гонзо\n🔵Олег, Семён');
            const byId = (norm: string) => eq(personAlias.id, aliasId(norm));
            const [merged] = yield* db.select().from(personAlias).where(byId('олег'));
            yield* db.update(personAlias).set({ personId: account, resolution: 'vote' }).where(byId('гонзо'));
            yield* mergePeople({ communityId, fromPersonId: merged?.personId ?? '', intoPersonId: account, actorPersonId: null });
            const [kept] = yield* db.select().from(personAlias).where(byId('гонзо'));
            const [confirmed] = yield* db.select().from(personAlias).where(byId('олег'));

            expect(kept).toMatchObject({ personId: account, resolution: 'vote' });
            expect(kept?.guestPersonId).not.toBeNull();
            expect(confirmed).toMatchObject({ personId: account, resolution: 'confirmed' });
        })
    );

    it.effect('hides persons left behind by a removed nickname from search and rankings', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seeded('orphan-fc', 200n, '🟢Я, Гонзо\n🔵Олег, Семён');
            const [orphan] = yield* db.insert(person).values({ displayName: 'Сирота', source: 'import' }).returning({ id: person.id });
            const name = { communityId, personId: orphan?.id, guestPersonId: orphan?.id, alias: 'Сирота', aliasNorm: 'сирота' };
            yield* db.insert(personAlias).values(name);
            yield* db.transaction(transaction => removeUnusedNicknames({ transaction, communityId }));
            const [stored] = yield* db
                .select()
                .from(person)
                .where(eq(person.id, orphan?.id ?? ''));

            expect(stored?.displayName).toBe('Сирота');
            expect(yield* searchPeople(communityId, 'Сирота', 10)).toEqual([]);
            expect(Object.keys(yield* gamesOf(communityId))).not.toContain('Сирота');
            expect(yield* inactivePlayers(communityId, { notSince: '2027-01-01', minGames: 0, limit: 50 })).not.toContainEqual(
                expect.objectContaining({ name: 'Сирота' })
            );
        })
    );

    it.effect('undoes a link after the guest was merged into the linked player', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, account, aliasId } = yield* seeded('undo-merge-fc', 220n, '🟢Я, Гонзо\n🔵Олег, Семён');
            const target = { communityId, aliasId: aliasId('гонзо'), actorPersonId: null };
            const aliasNow = () => db.select().from(personAlias).where(eq(personAlias.id, target.aliasId));
            const [before] = yield* aliasNow();
            yield* linkAlias({ ...target, personId: account });
            yield* mergePeople({ communityId, fromPersonId: before?.guestPersonId ?? '', intoPersonId: account, actorPersonId: null });
            const [merged] = yield* aliasNow();
            yield* unlinkAlias(target);
            const [undone] = yield* aliasNow();

            expect(merged?.personId).toBe(account);
            expect(merged?.guestPersonId).not.toBe(account);
            expect(undone?.personId).not.toBe(account);
            expect(yield* recordedOf(communityId, account)).toMatchObject({ games: 0 });
        })
    );

    it.effect('confirms both nicknames when two players without Telegram are merged', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, aliasId } = yield* seeded('merge-guests-fc', 230n, '🟢Я, Гонзо\n🔵Семён');
            const [olegPerson] = yield* db.insert(person).values({ displayName: 'Олег', source: 'import' }).returning({ id: person.id });
            const [oleg] = yield* db
                .insert(personAlias)
                .values({ communityId, personId: olegPerson?.id, guestPersonId: olegPerson?.id, alias: 'Олег', aliasNorm: 'олег' })
                .returning();
            const [gonzo] = yield* db
                .select()
                .from(personAlias)
                .where(eq(personAlias.id, aliasId('гонзо')));
            const survivor = gonzo?.personId ?? '';
            yield* mergePeople({ communityId, fromPersonId: oleg?.personId ?? '', intoPersonId: survivor, actorPersonId: null });
            const merged = yield* db.select().from(personAlias).where(eq(personAlias.personId, survivor));

            expect(merged.map(({ aliasNorm, resolution }) => `${aliasNorm} ${resolution}`).toSorted()).toEqual([
                'гонзо confirmed',
                'олег confirmed'
            ]);
            expect(merged.every(({ guestPersonId }) => guestPersonId !== survivor)).toBe(true);
        })
    );

    it.effect('takes the community lock before it reads, in every change of links, people and teams', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const slug = 'lock-order-fc';
            const { communityId, account, aliasId, sessionId } = yield* seeded(slug, 240n, '🟢Я, Гонзо\n🔵Олег, Семён');
            const alias = { communityId, aliasId: aliasId('гонзо'), actorPersonId: null };
            const [entry] = yield* db
                .select()
                .from(lineupEntry)
                .where(and(eq(lineupEntry.aliasId, aliasId('олег')), eq(lineupEntry.sessionId, sessionId)));
            const entryTarget = { communityId, entryId: entry?.id ?? '', actorPersonId: null };
            const other = yield* syncMember(communityId, { id: 249n, firstName: 'Second' }, 'active');
            const target = yield* requireSession(communityId, sessionId);
            const firstStatements = [
                yield* firstStatementOf(linkAlias({ ...alias, personId: account })),
                yield* firstStatementOf(unlinkAlias(alias)),
                yield* firstStatementOf(linkEntry({ ...entryTarget, personId: account })),
                yield* firstStatementOf(unlinkEntry(entryTarget)),
                yield* firstStatementOf(mergePeople({ communityId, fromPersonId: other, intoPersonId: account, actorPersonId: null })),
                yield* firstStatementOf(
                    publishTeams({ target, teams: [], group: { chatId: -240n, topicId: null }, locale: 'uk', actorPersonId: null })
                )
            ];

            expect(firstStatements.filter(statement => !statement.includes('pg_advisory_xact_lock'))).toEqual([]);
        })
    );

    it.effect('refuses to link a nickname that an import removed', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, account } = yield* seeded('gone-alias-fc', 250n, '🟢Я, Гонзо\n🔵Олег, Семён');
            const [unused] = yield* db.insert(personAlias).values({ communityId, alias: 'Лишний', aliasNorm: 'лишний' }).returning();
            const link = linkAlias({ communityId, aliasId: unused?.id ?? '', personId: account, actorPersonId: null });
            yield* db.transaction(transaction => removeUnusedNicknames({ transaction, communityId }));
            const refused = yield* Effect.flip(link);

            expect(refused._tag).toBe('ActionFailedError');
        })
    );

    it.effect('stores a live line-up only under the community lock', () =>
        Effect.gen(function* () {
            const outcome = yield* underLockGuard(
                'live-lock-fc',
                sql`play.team`,
                seeded('live-lock-fc', 210n, '🟢Я, Гонзо\n🔵Олег, Семён')
            );
            const otherKey = yield* underLockGuard(
                'another-fc',
                sql`play.team`,
                seeded('live-lock-2-fc', 260n, '🟢Я, Гонзо\n🔵Олег, Семён')
            );

            expect(Exit.isSuccess(outcome)).toBe(true);
            expect(Exit.isFailure(otherKey)).toBe(true);
        })
    );

    it.effect('records approvals and rejections and refuses to touch periods of another player', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, account, aliasId, sessionId } = yield* seeded('decide-fc', 270n, '🟢Я, Гонзо\n🔵Олег, Семён');
            const second = yield* syncMember(communityId, { id: 279n, firstName: 'Second' }, 'active');
            const gonzo = { communityId, aliasId: aliasId('гонзо'), actorPersonId: account };
            const linksOf = (id: string) => db.select(linkColumns).from(aliasLink).where(eq(aliasLink.aliasId, id));
            yield* linkAlias({ ...gonzo, personId: account });
            const approved = yield* linksOf(gonzo.aliasId);
            const relinked = yield* Effect.flip(linkAlias({ ...gonzo, personId: second }));
            yield* unlinkAlias(gonzo);
            const rejected = yield* linksOf(gonzo.aliasId);
            const oleg = { communityId, aliasId: aliasId('олег'), actorPersonId: null };
            yield* db
                .update(lineupEntry)
                .set({ personId: second, resolvedBy: 'vote' })
                .where(and(eq(lineupEntry.aliasId, oleg.aliasId), eq(lineupEntry.sessionId, sessionId)));
            const overwritten = yield* Effect.flip(linkAlias({ ...oleg, personId: account }));

            expect(approved.map(({ status, personId, during, decidedBy }) => [status, personId, during, decidedBy])).toEqual([
                ['approved', account, '(,)', account]
            ]);
            expect(relinked._tag).toBe('ActionFailedError');
            expect(rejected.map(({ status, personId }) => [status, personId])).toEqual([['rejected', account]]);
            expect(overwritten).toMatchObject({ reason: 'another player has a period under this nickname, undo that first' });
        })
    );

    it.effect('refuses to undo a nickname with periods of several players at once', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, account, aliasId, organizer } = yield* seeded('periods-fc', 280n, '🟢Я, Гонзо\n🔵Олег, Семён');
            const row = { communityId, aliasId: aliasId('гонзо'), method: 'owner_list' as const, status: 'approved' as const };
            yield* db.insert(aliasLink).values([
                { ...row, personId: account, during: '[2025-01-01,2025-06-01)' },
                { ...row, personId: organizer, during: '[2025-06-01,2025-12-01)' }
            ]);
            const refused = yield* Effect.flip(unlinkAlias({ communityId, aliasId: row.aliasId, actorPersonId: null }));

            expect(refused).toMatchObject({ _tag: 'ActionFailedError' });
        })
    );

    it.effect('moves decisions in a merge and refuses contradicting ones', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, account, aliasId } = yield* seeded('merge-decide-fc', 290n, '🟢Я, Гонзо\n🔵Олег, Семён');
            const second = yield* syncMember(communityId, { id: 299n, firstName: 'Second' }, 'active');
            const third = yield* syncMember(communityId, { id: 298n, firstName: 'Third' }, 'active');
            const row = { communityId, aliasId: aliasId('гонзо'), method: 'owner_list' as const, status: 'approved' as const };
            yield* db.insert(aliasLink).values([
                { ...row, personId: account, during: '[2025-01-01,2025-06-01)' },
                { ...row, personId: second, during: '[2025-03-01,2025-12-01)' },
                { ...row, personId: third, during: '[2025-03-01,2025-04-01)', status: 'rejected' }
            ]);
            const merge = (fromPersonId: string) => mergePeople({ communityId, fromPersonId, intoPersonId: account, actorPersonId: null });
            yield* merge(second);
            const moved = yield* db.select(linkColumns).from(aliasLink).where(eq(aliasLink.personId, account));
            const refused = yield* Effect.flip(merge(third));

            expect(moved.map(({ during, status }) => [during, status])).toEqual([['[2025-01-01,2025-12-01)', 'approved']]);
            expect(refused._tag).toBe('ActionFailedError');
        })
    );

    it.effect('pins an approved nickname in a new live line-up and keeps it when the nickname becomes shared', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const slug = 'pin-live-fc';
            const { communityId, account, aliasId, organizer, sessionId } = yield* seeded(slug, 300n, '🟢Я, Зорро\n🔵Олег, Зорро');
            yield* db.insert(aliasLink).values({
                communityId,
                aliasId: aliasId('зорро'),
                personId: account,
                during: '[2026-05-01,2026-06-01)',
                method: 'owner_list',
                status: 'approved'
            });
            yield* ingestGroupMessage(communityId, seedConfig(slug), {
                chatId: -300n,
                messageId: 2,
                sentAt: new Date('2026-05-11T15:00:00Z'),
                senderPersonId: organizer,
                senderTgUserId: 300n,
                senderName: 'Org',
                isTrusted: true,
                text: 'Составы на сегодня, North:\n🟢Я, Зорро\n🔵Олег, Зорро'
            });
            const [alias] = yield* db
                .select()
                .from(personAlias)
                .where(eq(personAlias.id, aliasId('зорро')));
            const pinned = yield* db
                .select()
                .from(lineupEntry)
                .where(and(eq(lineupEntry.aliasId, aliasId('зорро')), eq(lineupEntry.personId, account)));
            const links = yield* db
                .select(linkColumns)
                .from(aliasLink)
                .where(eq(aliasLink.aliasId, aliasId('зорро')));

            expect(alias?.kind).toBe('placeholder');
            expect(pinned.map(entry => entry.sessionId)).toContain(sessionId);
            expect(pinned).toHaveLength(2);
            expect(links).toHaveLength(1);
        })
    );

    it.effect('refuses to replace a whole link by votes that was approved', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, account, aliasId, organizer, sessionId } = yield* seeded(
                'approved-whole-fc',
                310n,
                '🟢Я, Гонзо\n🔵Олег, Семён'
            );
            const second = yield* syncMember(communityId, { id: 319n, firstName: 'Second' }, 'active');
            const id = aliasId('гонзо');
            yield* db.update(personAlias).set({ personId: account, resolution: 'vote' }).where(eq(personAlias.id, id));
            yield* db
                .update(lineupEntry)
                .set({ personId: account, resolvedBy: 'alias' })
                .where(and(eq(lineupEntry.aliasId, id), eq(lineupEntry.sessionId, sessionId)));
            yield* db.insert(aliasLink).values({
                communityId,
                aliasId: id,
                personId: account,
                during: '[2026-05-01,2026-06-01)',
                method: 'owner_list',
                status: 'approved',
                decidedBy: organizer
            });
            const refused = yield* Effect.flip(linkAlias({ communityId, aliasId: id, personId: second, actorPersonId: null }));

            expect(refused).toMatchObject({ reason: 'another player has a period under this nickname, undo that first' });
        })
    );

    it.effect('approves the nickname of a merged player and refuses one that was rejected for the survivor', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, account, aliasId } = yield* seeded('merge-approve-fc', 330n, '🟢Я, Гонзо\n🔵Олег, Семён');
            const personOf = Effect.fn('test.personOf')(function* (norm: string) {
                const [alias] = yield* db
                    .select()
                    .from(personAlias)
                    .where(eq(personAlias.id, aliasId(norm)));

                return alias?.personId ?? '';
            });
            yield* db.insert(aliasLink).values({
                communityId,
                aliasId: aliasId('олег'),
                personId: account,
                during: '(,)',
                method: 'admin',
                status: 'rejected'
            });
            const merge = (fromPersonId: string) => mergePeople({ communityId, fromPersonId, intoPersonId: account, actorPersonId: null });
            yield* merge(yield* personOf('гонзо'));
            const refused = yield* Effect.flip(merge(yield* personOf('олег')));
            const links = yield* db
                .select(linkColumns)
                .from(aliasLink)
                .where(eq(aliasLink.aliasId, aliasId('гонзо')));

            expect(links.map(({ status, personId, during }) => [status, personId, during])).toEqual([['approved', account, '(,)']]);
            expect(refused).toMatchObject({ reason: 'one of these nicknames was rejected for this player' });
        })
    );

    it.effect('does not let an unreadable answer hide an earlier yes vote', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { account, sessionId } = yield* seeded('hidden-yes-fc', 340n, '🟢Я, Гонзо\n🔵Олег, Семён');
            const vote = { tgUserId: 341n, sessionId };
            yield* db.insert(pollVote).values([
                { ...vote, pollId: 'hidden-1', choice: 'yes', votedAt: new Date('2026-05-01T10:00:00Z') },
                { ...vote, pollId: 'hidden-2', choice: 'other', votedAt: new Date('2026-05-02T10:00:00Z') }
            ]);

            expect((yield* signedUpByVotes(sessionId)).map(({ personId }) => personId)).toEqual([account]);
        })
    );
});
