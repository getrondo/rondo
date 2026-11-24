import { expect, layer } from '@effect/vitest';
import { person, personAlias, telegramAccount } from '@rondo/db/schema/identity.schema';
import { auditLog, pollVote } from '@rondo/db/schema/platform.schema';
import { lineupEntry } from '@rondo/db/schema/play.schema';
import { attendance, session, signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { syncMember, upsertTelegramUser } from '../src/identity/telegram-user';
import { ingestGroupMessage } from '../src/live/live-ingest';
import { linkAlias, linkEntry, reviewEntries, suggestAliasLinks, unlinkAlias, unlinkEntry } from '../src/people/alias-links.service';
import { mergePeople, renamePerson, searchPeople } from '../src/people/people.service';
import { createSession, updateSession, requireSession } from '../src/sessions/session.service';
import { signedUpByVotes } from '../src/signups/signed-up-by-votes';
import { applyPollAnswer } from '../src/signups/signup.service';
import { playerHistory, topAttendance } from '../src/stats/stats.service';
import { recordedTelegramDbLayer } from '../src/testing/recorded-telegram.layer';
import { seedCommunity, seedConfig } from '../src/testing/seed-community';

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
        senderIsAdmin: true,
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
    return Object.fromEntries((yield* topAttendance(communityId, range, 50)).map(({ name, games }) => [name, games]));
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
            const linkedGames = yield* playerHistory(communityId, account);
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
                senderIsAdmin: true,
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
            const linked = yield* playerHistory(communityId, account);
            yield* unlinkEntry(target);
            const unlinked = yield* playerHistory(communityId, account);

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

    it.effect('keeps a vote link undone by an admin as a manual record', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, account, aliasId, sessionId } = yield* seeded('vote-undo-fc', 180n, '🟢Я, Гонзо\n🔵Олег, Семён');
            const ofAlias = and(eq(lineupEntry.aliasId, aliasId('гонзо')), eq(lineupEntry.sessionId, sessionId));
            const [entry] = yield* db.update(lineupEntry).set({ personId: account, resolvedBy: 'vote' }).where(ofAlias).returning();
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
            expect(yield* playerHistory(communityId, account)).toMatchObject({ games: 0, signedUp: 1 });
        })
    );
});
