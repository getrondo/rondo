import { expect, layer } from '@effect/vitest';
import { isDefined } from '@rnw-community/shared';
import { setTier } from '@rondo/core/teams/team.service';
import { person, telegramAccount } from '@rondo/db/schema/identity.schema';
import { community } from '@rondo/db/schema/org.schema';
import { messageRef } from '@rondo/db/schema/platform.schema';
import { lineupEntry, team, teamMember } from '@rondo/db/schema/play.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder, refusal } from '@rondo/telegram/testing/recording-telegram.layer';
import { and, eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Predicate from 'effect/Predicate';

import { conversation, deliver } from './support/conversation';
import { grantOrganizer } from './support/season';
import { teamsGame } from './support/teams-game';
import { buttonData, draftTeams, openEditor, labelsOf, playerData } from './support/teams-screen';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();
const sentTo = (chatId: number) =>
    recorder.calls.filter(call => call.payload.chat_id === chatId && (call.method === 'sendMessage' || call.method === 'editMessageText'));

const swapFirstTwo = (admin: ReturnType<typeof conversation>, sessionId: string) =>
    Effect.gen(function* () {
        const { teams } = yield* draftTeams(sessionId);
        yield* admin.press(playerData(admin.screen(), teams[0]?.[1] ?? ''));
        yield* admin.press(playerData(admin.screen(), teams[1]?.[1] ?? ''));
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
            yield* openEditor(admin);
            const editor = admin.screen();
            yield* admin.press(buttonData(editor, '✅ Надіслати в «Games»'));
            const preview = admin.screen();
            yield* admin.press(buttonData(preview, '✅ Надіслати в «Games»'));
            const posted = sentTo(-3201);
            const done = admin.screen();
            yield* swapFirstTwo(admin, sessionId);
            yield* admin.press(buttonData(admin.screen(), '✅ Оновити в «Games»'));
            const diff = admin.screen();
            yield* admin.press(buttonData(diff, '✅ Оновити в «Games»'));
            const edited = sentTo(-3201);
            yield* swapFirstTwo(admin, sessionId);
            recorder.failures.set('editMessageText', refusal('editMessageText', 'Bad Request: message to edit not found'));
            yield* admin.press(buttonData(admin.screen(), '✅ Оновити в «Games»'));
            yield* admin.press(buttonData(admin.screen(), '✅ Оновити в «Games»'));
            recorder.failures.delete('editMessageText');
            const refused = admin.screen();
            const members = yield* db.select().from(teamMember).where(eq(teamMember.sessionId, sessionId));

            expect(editor.text.split('\n')).toContain('Поки нічого не надіслано.');
            expect(preview.text).toContain('Так буде в «Games»:');
            expect(posted).toHaveLength(1);
            expect(String(posted[0]?.payload.text)).toMatch(
                /^<b>Склади: Пт 27\.11 19:00 · North Arena<\/b>\n\n🔴 <a href="tg:\/\/user\?id=\d+">/u
            );
            expect(String(posted[0]?.payload.text)).not.toMatch(/[💪🌱Σ]|сильн|новач|рівн/u);
            expect(done.text).toContain('✅ Склади в «Games».');
            expect(diff.text).toContain('Що змінилося:');
            expect(diff.text).toMatch(/: 🔴 → 🔵/u);
            expect(edited.map(call => call.method)).toEqual(['sendMessage', 'editMessageText']);
            expect(edited[1]?.payload.message_id).toBe(
                Predicate.hasProperty(posted[0]?.result, 'message_id') ? posted[0].result.message_id : 0
            );
            expect(refused.text).toContain('⚠️ Не надіслано в «Games»: Bad Request: message to edit not found');
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
                yield* openEditor(admin);
                yield* admin.press(buttonData(admin.screen(), '✅ Отправить мне'));
                const confirm = buttonData(admin.screen(), '✅ Отправить мне');
                yield* admin.press(confirm);
                const done = admin.screen();
                yield* admin.press(confirm);
                const clean = sentTo(322).filter(
                    call => call.method === 'sendMessage' && String(call.payload.text).startsWith('<b>Склади')
                );
                const first = sentTo(322)
                    .filter(call => call.method === 'sendMessage')
                    .slice(-2);
                const unchanged = admin.screen();
                const quiet = sentTo(322).filter(call => call.method === 'sendMessage').length;
                yield* openEditor(second);
                yield* swapFirstTwo(second, sessionId);
                yield* second.press(buttonData(second.screen(), '✅ Надіслати оновлені'));
                const secondPreview = second.screen();
                yield* second.press(buttonData(second.screen(), '✅ Надіслати оновлені'));
                const update = sentTo(323)
                    .filter(call => call.method === 'sendMessage')
                    .slice(-2);
                yield* deliver({
                    message: {
                        message_id: 9001,
                        date: Math.floor(Date.parse('2026-11-27T16:00:00Z') / 1000),
                        chat: { id: -3202, type: 'supergroup', title: 'Games' },
                        from: { id: 323, is_bot: false, first_name: 'Admin 323' },
                        text: String(update[0]?.payload.text)
                            .replace(/^Оновлені склади\n/u, '')
                            .replaceAll(/<[^<>]*>/gu, '')
                    }
                });
                const teams = yield* db.select().from(team).where(eq(team.sessionId, sessionId));
                const entries = yield* db.select().from(lineupEntry).where(eq(lineupEntry.sessionId, sessionId));
                const seen = yield* db
                    .select()
                    .from(messageRef)
                    .where(and(eq(messageRef.chatId, -3202n), eq(messageRef.messageId, 9001)));

                expect(clean).toHaveLength(1);
                expect(first[0]?.payload.reply_markup).toBeUndefined();
                expect(String(first[0]?.payload.text)).toMatch(/^<b>Склади: Пт 27\.11 19:00/u);
                expect(String(first[1]?.payload.text)).toContain('☝️ Составы выше: нажми и удерживай → Переслать → группа.');
                expect(done.text).toContain('📨 Составы уже у тебя.');
                expect(unchanged.text).toContain('📨 Составы уже у тебя.');
                expect(
                    labelsOf(unchanged)
                        .flat()
                        .filter(label => label.startsWith('✅'))
                ).toEqual([]);
                expect(sentTo(322).filter(call => call.method === 'sendMessage')).toHaveLength(quiet);
                expect(secondPreview.text).toContain('Що змінилося:');
                expect(String(update[0]?.payload.text)).toMatch(/^Оновлені склади\n<b>Склади:/u);
                expect(String(update[1]?.payload.text)).toContain('Що змінилося:');
                expect(sentTo(-3202)).toEqual([]);
                expect(teams.every(entry => isDefined(entry.colorId))).toBe(true);
                expect(entries).toEqual([]);
                expect(seen.map(ref => [ref.purpose, ref.entityId])).toEqual([['lineup', sessionId]]);
            })
    );

    it.effect('shows @handles instead of names when the community asks for it and keeps guests plain', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* teamsGame('teams-post-handles', { groupChatId: -3203, adminId: 324, players: 8 });
            const [row] = yield* db.select({ settings: community.settings }).from(community).where(eq(community.id, communityId));
            yield* db
                .update(community)
                .set({ settings: { ...(row?.settings as object), teams: { showHandles: true } } })
                .where(eq(community.id, communityId));
            yield* db.update(telegramAccount).set({ username: 'andriy_k' }).where(eq(telegramAccount.tgUserId, 32_400n));
            const admin = conversation(recorder, adminNumbered(324));
            yield* openEditor(admin);
            yield* admin.type('Andriy +1');
            yield* admin.press(buttonData(admin.screen(), '✅ Надіслати в «Games»'));
            yield* admin.press(buttonData(admin.screen(), '✅ Надіслати в «Games»'));
            const post = String(sentTo(-3203).at(-1)?.payload.text);

            expect(post).toContain('🔴 @andriy_k +1');
            expect(post).not.toContain('tg://user?id=32400"');
            expect(post).toContain('<a href="tg://user?id=32401">Bohdan</a>');
        })
    );

    it.effect('follows a group that became a supergroup and updates the line-up there', () =>
        Effect.gen(function* () {
            const { sessionId } = yield* teamsGame('teams-post-migrated', { groupChatId: -3205, adminId: 325, players: 8 });
            const admin = conversation(recorder, adminNumbered(325));
            yield* openEditor(admin);
            yield* admin.press(buttonData(admin.screen(), '✅ Надіслати в «Games»'));
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
            yield* swapFirstTwo(admin, sessionId);
            yield* admin.press(buttonData(admin.screen(), '✅ Оновити в «Games»'));
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
            yield* openEditor(admin);
            const editor = admin.screen();
            yield* admin.press(buttonData(editor, '✅ Надіслати в «Games» і мені'));
            const preview = admin.screen();
            yield* db.update(person).set({ displayName: 'Andriy K' }).where(eq(person.displayName, 'Andriy'));
            yield* admin.press(buttonData(preview, '✅ Надіслати в «Games» і мені'));
            const changed = admin.screen();
            const quiet = sentTo(-3206).length;

            yield* teamsGame('teams-post-unknown', { groupChatId: -3207, adminId: 327, players: 8 });
            const other = conversation(recorder, adminNumbered(327));
            yield* openEditor(other);
            yield* other.press(buttonData(other.screen(), '✅ Надіслати в «Games»'));
            recorder.failures.set('sendMessage', new Error('socket hang up'));
            yield* other.press(buttonData(other.screen(), '✅ Надіслати в «Games»'));
            recorder.failures.delete('sendMessage');
            const unknown = other.screen();
            const retry = buttonData(unknown, '✅ Немає, надіслати в «Games»');
            yield* other.press(retry);
            const confirm = other.screen();
            yield* other.press(buttonData(confirm, '✅ Немає, надіслати в «Games»'));
            const done = other.screen();
            yield* other.press(retry);
            const delivered = sentTo(-3207).filter(call => call.method === 'sendMessage' && isDefined(call.result));

            expect(preview.text).toContain('Так буде в «Games» і в тебе:');
            expect(changed.text).toContain('🔄 Дані змінилися, нічого не надіслано. Ось як буде тепер:');
            expect(changed.text).toContain('Andriy K');
            expect(quiet).toBe(0);
            expect(unknown.text).toContain('⚠️ Не знаю, чи дійшли склади в «Games». Зазирни туди.');
            expect(labelsOf(unknown).flat()).not.toContain('✅ Надіслати в «Games»');
            expect(confirm.text).toContain('Так буде в «Games»:');
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
            yield* openEditor(admin);
            yield* admin.press(buttonData(admin.screen(), '✅ Надіслати в «Games»'));
            yield* admin.press(buttonData(admin.screen(), '✅ Надіслати в «Games»'));
            const posted = sentTo(-3208).at(-1);
            yield* swapFirstTwo(admin, sessionId);
            yield* admin.press(buttonData(admin.screen(), '✅ Оновити в «Games»'));
            yield* admin.press(buttonData(admin.screen(), '✅ Оновити в «Games»'));

            expect(organizer.map(ref => ref.purpose)).toEqual(['lineup']);
            expect(sentTo(-3208).map(call => [call.method, call.payload.message_id ?? null])).toEqual([
                ['sendMessage', null],
                ['editMessageText', Predicate.hasProperty(posted?.result, 'message_id') ? posted.result.message_id : 0]
            ]);
        })
    );
});
