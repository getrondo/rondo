import { expect, layer } from '@effect/vitest';
import { isDefined } from '@rnw-community/shared';
import { syncMember } from '@rondo/core/identity/telegram-user';
import { joinGame } from '@rondo/core/signups/roster.service';
import { recordResult } from '@rondo/core/teams/team-result';
import { setTier } from '@rondo/core/teams/team.service';
import { person, telegramAccount } from '@rondo/db/schema/identity.schema';
import { community } from '@rondo/db/schema/org.schema';
import { messageRef } from '@rondo/db/schema/platform.schema';
import { lineupEntry, team, teamMember } from '@rondo/db/schema/play.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder, refusal } from '@rondo/telegram/testing/recording-telegram.layer';
import { and, eq, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Predicate from 'effect/Predicate';

import { conversation, deliver } from './support/conversation';
import { grantOrganizer } from './support/season';
import { teamsGame } from './support/teams-game';
import { buttonData, draftTeams, openEditor, openOverview, labelsOf, playerData } from './support/teams-screen';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();
const sentTo = (chatId: number) =>
    recorder.calls.filter(call => call.payload.chat_id === chatId && (call.method === 'sendMessage' || call.method === 'editMessageText'));

const editAndSwap = (admin: ReturnType<typeof conversation>, sessionId: string) =>
    Effect.gen(function* () {
        const { teams } = yield* draftTeams(sessionId);
        yield* admin.press(buttonData(admin.screen(), 'Змінити склади'));
        yield* admin.press(playerData(admin.screen(), teams[0]?.[1] ?? ''));
        yield* admin.press(playerData(admin.screen(), teams[1]?.[1] ?? ''));
        yield* admin.press(buttonData(admin.screen(), 'Готово'));
    });

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('posting the teams', it => {
    it.effect('posts to the group after a preview, then edits the same message with the diff shown first, and never posts twice', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { sessionId, communityId, people } = yield* teamsGame('teams-post-group', {
                groupChatId: -3201,
                adminId: 321,
                players: 10
            });
            yield* setTier({ communityId, personId: people[0] ?? '', tier: 'strong', actorPersonId: null });
            const admin = conversation(recorder, adminNumbered(321));
            yield* openOverview(admin);
            const overview = admin.screen();
            yield* admin.press(buttonData(overview, '✅ Надіслати в «Games»'));
            const posted = sentTo(-3201);
            const done = admin.screen();
            yield* editAndSwap(admin, sessionId);
            const diff = admin.screen();
            yield* admin.press(buttonData(diff, '✅ Оновити в «Games»'));
            const edited = sentTo(-3201);
            yield* editAndSwap(admin, sessionId);
            recorder.failures.set('editMessageText', refusal('editMessageText', 'Bad Request: message to edit not found'));
            yield* admin.press(buttonData(admin.screen(), '✅ Оновити в «Games»'));
            recorder.failures.delete('editMessageText');
            const refused = admin.screen();
            const members = yield* db.select().from(teamMember).where(eq(teamMember.sessionId, sessionId));

            expect(overview.text.split('\n')).toContain('Поки нічого не надіслано.');
            expect(overview.text).toMatch(/^<b>Склади: Пт 27\.11 19:00 · North Arena<\/b>\n\n🔴 <b>Червоні · 5<\/b>\n/u);
            expect(posted).toHaveLength(1);
            expect(String(posted[0]?.payload.text)).toMatch(
                /^<b>Склади: Пт 27\.11 19:00 · North Arena<\/b>\n\n🔴 <b>Червоні · 5<\/b>\n<a href="tg:\/\/user\?id=\d+">/u
            );
            expect(String(posted[0]?.payload.text)).not.toMatch(/[💪🌱Σ]|сильн|новач|рівн/u);
            expect(done.text).toContain('✅ Склади в «Games».');
            expect(done.text).not.toContain('📨');
            expect(diff.text).toContain('Що змінилося:');
            expect(diff.text).toMatch(/ → 🔵 Сині/u);
            expect(edited.map(call => call.method)).toEqual(['sendMessage', 'editMessageText']);
            expect(edited[1]?.payload.message_id).toBe(
                Predicate.hasProperty(posted[0]?.result, 'message_id') ? posted[0].result.message_id : 0
            );
            expect(refused.text).toContain('⚠️ Склади в «Games» видалили. Натисни ✅ — надішлю нові.');
            expect(refused.text).not.toContain('Bad Request');
            expect(sentTo(-3201).filter(call => call.method === 'sendMessage')).toHaveLength(1);
            expect(members).toHaveLength(10);
        })
    );

    it.effect(
        'sends one clean message to forward when the audience is the admin, sends nothing again without changes and a marked new one after a change',
        () =>
            Effect.gen(function* () {
                const db = yield* Db;
                const { sessionId, communityId } = yield* teamsGame('teams-post-private', {
                    groupChatId: -3202,
                    adminId: 322,
                    players: 10,
                    privateAudience: true
                });
                yield* grantOrganizer(communityId, 323);
                const admin = conversation(recorder, adminNumbered(322, 'ru'));
                const second = conversation(recorder, adminNumbered(323));
                yield* openOverview(admin);
                const confirm = buttonData(admin.screen(), '✅ Отправить мне');
                yield* admin.press(confirm);
                const done = admin.screen();
                yield* admin.press(confirm);
                const unchanged = admin.screen();
                const clean = sentTo(322).filter(
                    call => call.method === 'sendMessage' && String(call.payload.text).startsWith('<b>Склади')
                );
                const newest = sentTo(322).findLast(call => call.method === 'sendMessage');
                const quiet = sentTo(322).filter(call => call.method === 'sendMessage').length;
                yield* openOverview(second);
                yield* editAndSwap(second, sessionId);
                const secondPreview = second.screen();
                yield* second.press(buttonData(secondPreview, '✅ Надіслати оновлені'));
                const update = sentTo(323)
                    .filter(call => call.method === 'sendMessage')
                    .slice(-1);
                yield* deliver({
                    message: {
                        message_id: 9001,
                        date: Math.floor(Date.parse('2026-11-27T16:00:00Z') / 1000),
                        chat: { id: -3202, type: 'supergroup', title: 'Games' },
                        from: { id: 323, is_bot: false, first_name: 'Admin 323' },
                        forward_origin: { type: 'user', date: 0, sender_user: { id: 777, is_bot: true, first_name: 'Rondo' } },
                        text: String(update[0]?.payload.text)
                            .split(/<[^<>]*>/u)
                            .join('')
                    }
                });
                yield* deliver({
                    message: {
                        message_id: 9002,
                        date: Math.floor(Date.parse('2026-11-27T16:01:00Z') / 1000),
                        chat: { id: -3202, type: 'supergroup', title: 'Games' },
                        from: { id: 323, is_bot: false, first_name: 'Admin 323' },
                        forward_origin: { type: 'user', date: 0, sender_user: { id: 778, is_bot: true, first_name: 'Other bot' } },
                        text: 'Склади: Пт 27.11 19:00\n\n🔴 Червоні · 4\nAndriy\nBohdan\nVasyl\nHryhoriy\n\n🔵 Сині · 4\nDmytro\nYevhen\nZakhar\nIvan'
                    }
                });
                const teams = yield* db.select().from(team).where(eq(team.sessionId, sessionId));
                const entries = yield* db.select().from(lineupEntry).where(eq(lineupEntry.sessionId, sessionId));
                const seen = yield* db
                    .select()
                    .from(messageRef)
                    .where(and(eq(messageRef.chatId, -3202n), eq(messageRef.messageId, 9001)));
                const other = yield* db
                    .select()
                    .from(messageRef)
                    .where(and(eq(messageRef.chatId, -3202n), eq(messageRef.messageId, 9002)));

                expect(clean).toHaveLength(1);
                expect(newest).toBe(clean[0]);
                expect(newest?.payload.reply_markup).toBeUndefined();
                expect(done.text).toContain('👇 Составы ниже: нажми и удерживай → Переслать → группа.');
                expect(done.text).not.toContain('Оновлені склади');
                expect(done.text).not.toContain('📨 Составы уже у тебя.');
                expect(unchanged.text).toContain('📨 Составы уже у тебя.');
                expect(
                    labelsOf(unchanged)
                        .flat()
                        .filter(label => label.startsWith('✅'))
                ).toEqual([]);
                expect(sentTo(322).filter(call => call.method === 'sendMessage')).toHaveLength(quiet);
                expect(secondPreview.text).toContain('Що змінилося:');
                expect(String(update[0]?.payload.text)).toMatch(/^Оновлені склади\n<b>Склади:/u);
                expect(sentTo(-3202)).toEqual([]);
                expect(teams.every(entry => isDefined(entry.colorId))).toBe(true);
                expect(entries).toEqual([]);
                expect(seen.map(ref => [ref.purpose, ref.entityId])).toEqual([['lineup', sessionId]]);
                expect(other).toEqual([]);
            })
    );

    it.effect('shows @handles instead of names when the community asks for it and keeps guests plain', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* teamsGame('teams-post-handles', { groupChatId: -3203, adminId: 324, players: 8 });
            yield* db
                .update(community)
                .set({ settings: sql`${community.settings} || ${JSON.stringify({ teams: { showHandles: true } })}::jsonb` })
                .where(eq(community.id, communityId));
            yield* db.update(telegramAccount).set({ username: 'andriy_k' }).where(eq(telegramAccount.tgUserId, 32_400n));
            const admin = conversation(recorder, adminNumbered(324));
            yield* openEditor(admin);
            yield* admin.type('Andriy +1');
            yield* admin.press(buttonData(admin.screen(), 'Готово'));
            yield* admin.press(buttonData(admin.screen(), '✅ Надіслати в «Games»'));
            const post = String(sentTo(-3203).at(-1)?.payload.text);

            expect(post).toContain('\n@andriy_k +1\n');
            expect(post).not.toContain('tg://user?id=32400"');
            expect(post).toContain('<a href="tg://user?id=32401">Bohdan</a>');
        })
    );

    it.effect('follows a group that became a supergroup and updates the line-up there', () =>
        Effect.gen(function* () {
            const { sessionId } = yield* teamsGame('teams-post-migrated', { groupChatId: -3205, adminId: 325, players: 8 });
            const admin = conversation(recorder, adminNumbered(325));
            yield* openOverview(admin);
            yield* admin.press(buttonData(admin.screen(), '✅ Надіслати в «Games»'));
            const posted = sentTo(-3205).at(-1);
            yield* deliver({
                message: {
                    message_id: 9100,
                    date: 1_795_680_000,
                    chat: { id: -3205, type: 'group', title: 'Games' },
                    from: { id: 325, is_bot: false, first_name: 'Admin 325' },
                    migrate_to_chat_id: -1_000_003_205
                }
            });
            yield* editAndSwap(admin, sessionId);
            yield* admin.press(buttonData(admin.screen(), '✅ Оновити в «Games»'));
            const edited = sentTo(-1_000_003_205);

            expect(edited.map(call => [call.method, call.payload.message_id])).toEqual([
                ['editMessageText', Predicate.hasProperty(posted?.result, 'message_id') ? posted.result.message_id : 0]
            ]);
        })
    );

    it.effect('names a group and me together, refreshes a changed preview and resends an unknown delivery only from its own button', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { sessionId } = yield* teamsGame('teams-post-mixed', { groupChatId: -3206, adminId: 326, players: 8 });
            yield* db
                .insert(messageRef)
                .values({ chatId: 326n, messageId: 2, purpose: 'poll', entityType: 'session', entityId: sessionId });
            const admin = conversation(recorder, adminNumbered(326));
            yield* openOverview(admin);
            const overview = admin.screen();
            yield* db.update(person).set({ displayName: 'Andriy K' }).where(eq(person.displayName, 'Andriy'));
            yield* admin.press(buttonData(overview, '✅ Надіслати'));
            const changed = admin.screen();
            const quiet = sentTo(-3206).length;

            yield* teamsGame('teams-post-unknown', { groupChatId: -3207, adminId: 327, players: 8 });
            const other = conversation(recorder, adminNumbered(327));
            yield* openOverview(other);
            recorder.failures.set('sendMessage', new Error('socket hang up'));
            yield* other.press(buttonData(other.screen(), '✅ Надіслати в «Games»'));
            recorder.failures.delete('sendMessage');
            const unknown = other.screen();
            const retry = buttonData(unknown, '✅ Немає, надіслати в «Games»');
            yield* other.press(retry);
            const done = other.screen();
            yield* other.press(retry);
            const delivered = sentTo(-3207).filter(call => call.method === 'sendMessage' && isDefined(call.result));

            expect(overview.text).toContain('Надішлю в «Games» і мені.');
            expect(labelsOf(overview)[0]).toEqual(['✅ Надіслати']);
            expect(changed.text).toContain('🔄 Поки ти дивився, склади змінилися.');
            expect(changed.text).toContain('Andriy K');
            expect(quiet).toBe(0);
            expect(unknown.text.split('⚠️ Не знаю, чи дійшли склади в «Games». Зазирни туди.')).toHaveLength(2);
            expect(unknown.text).not.toContain('Нічого не змінилося');
            expect(labelsOf(unknown).flat()).not.toContain('✅ Надіслати в «Games»');
            expect(done.text).toContain('✅ Склади в «Games».');
            expect(labelsOf(done).flat()).not.toContain('✅ Немає, надіслати в «Games»');
            expect(delivered).toHaveLength(1);
        })
    );

    it.effect('posts its own line-up next to an organizer post and a forwarded copy and edits only its own message', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { sessionId } = yield* teamsGame('teams-post-own', { groupChatId: -3208, adminId: 328, players: 8 });
            yield* deliver({
                message: {
                    message_id: 9301,
                    date: Math.floor(Date.parse('2026-11-27T16:00:00Z') / 1000),
                    chat: { id: -3208, type: 'supergroup', title: 'Games' },
                    from: { id: 328, is_bot: false, first_name: 'Admin 328' },
                    text: 'Склади: Пт 27.11 19:00\n\n🔴 Andriy, Bohdan, Vasyl, Hryhoriy\n\n🔵 Dmytro, Yevhen, Zakhar, Ivan'
                }
            });
            const organizer = yield* db
                .select()
                .from(messageRef)
                .where(and(eq(messageRef.chatId, -3208n), eq(messageRef.messageId, 9301)));
            const admin = conversation(recorder, adminNumbered(328));
            yield* openOverview(admin);
            yield* admin.press(buttonData(admin.screen(), '✅ Надіслати в «Games»'));
            const posted = sentTo(-3208).at(-1);
            yield* editAndSwap(admin, sessionId);
            yield* admin.press(buttonData(admin.screen(), '✅ Оновити в «Games»'));

            expect(organizer.map(ref => ref.purpose)).toEqual(['lineup']);
            expect(sentTo(-3208).map(call => [call.method, call.payload.message_id ?? null])).toEqual([
                ['sendMessage', null],
                ['editMessageText', Predicate.hasProperty(posted?.result, 'message_id') ? posted.result.message_id : 0]
            ]);
        })
    );

    it.effect('never says nothing was sent while it does not know whether the line-up arrived', () =>
        Effect.gen(function* () {
            yield* teamsGame('teams-post-unknown-quiet', { groupChatId: -3210, adminId: 330, players: 8 });
            const admin = conversation(recorder, adminNumbered(330));
            yield* openOverview(admin);
            recorder.failures.set('sendMessage', new Error('socket hang up'));
            yield* admin.press(buttonData(admin.screen(), '✅ Надіслати в «Games»'));
            recorder.failures.delete('sendMessage');

            expect(admin.screen().text).toContain('⚠️ Не знаю, чи дійшли склади в «Games».');
            expect(admin.screen().text).not.toContain('Поки нічого не надіслано.');
        })
    );

    it.effect(
        'posts nothing when someone joined while the line-up was on screen, places them and names them, also from an old screen',
        () =>
            Effect.gen(function* () {
                const { sessionId, communityId } = yield* teamsGame('teams-post-joiner', { groupChatId: -3212, adminId: 312, players: 8 });
                const admin = conversation(recorder, adminNumbered(312));
                yield* openOverview(admin);
                const old = admin.screen();
                const newcomer = yield* syncMember(communityId, { id: 3_120_001n, firstName: 'Newcomer' }, 'active');
                yield* joinGame({ communityId, sessionId, actorPersonId: null }, [newcomer]);
                yield* admin.press(buttonData(old, '✅ Надіслати в «Games»'));
                const refreshed = admin.screen();
                yield* admin.press(buttonData(old, '✅ Надіслати в «Games»'));
                const quiet = sentTo(-3212).length;
                yield* admin.press(buttonData(admin.screen(), '✅ Надіслати в «Games»'));
                const { teams } = yield* draftTeams(sessionId);

                expect(quiet).toBe(0);
                expect(refreshed.text).toContain('Newcomer');
                expect(refreshed.text).toContain('🔄');
                expect(teams.flat()).toContain('Newcomer');
                expect(String(sentTo(-3212)[0]?.payload.text)).toContain('Newcomer');
            })
    );

    it.effect('sends the line-up to the admin with the forward hint when no group can get it', () =>
        Effect.gen(function* () {
            yield* teamsGame('teams-post-nowhere', { groupChatId: null, adminId: 313, players: 8 });
            const admin = conversation(recorder, adminNumbered(313));
            yield* openOverview(admin);
            const overview = admin.screen();
            yield* admin.press(buttonData(overview, '✅ Надіслати мені'));

            expect(labelsOf(overview)[0]).toEqual(['✅ Надіслати мені']);
            expect(
                sentTo(313).filter(call => call.method === 'sendMessage' && String(call.payload.text).startsWith('<b>Склади'))
            ).toHaveLength(1);
            expect(admin.screen().text).toContain('👇 Склади нижче');
        })
    );

    it.effect('warns in the preview that a squad changed after the result clears it', () =>
        Effect.gen(function* () {
            const { sessionId, communityId } = yield* teamsGame('teams-post-result', { groupChatId: -3209, adminId: 329, players: 8 });
            const admin = conversation(recorder, adminNumbered(329));
            yield* openOverview(admin);
            yield* admin.press(buttonData(admin.screen(), '✅ Надіслати в «Games»'));
            yield* recordResult({ communityId, sessionId, winner: 1, actorPersonId: null, now: new Date('2026-11-27T20:00:00Z') });
            yield* editAndSwap(admin, sessionId);

            expect(admin.screen().text).toContain('⚠️ Склади змінилися після результату: надішлеш — результат вечора скинеться.');
        })
    );
});
