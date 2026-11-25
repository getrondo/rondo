import { expect, layer } from '@effect/vitest';
import { isDefined } from '@rnw-community/shared';
import { linkedChatsOf } from '@rondo/core/community/community.repository';
import { openDraft } from '@rondo/core/teams/team-draft.service';
import { linkGroup } from '@rondo/core/testing/link-group';
import { community, membership, telegramChat } from '@rondo/db/schema/org.schema';
import { processedUpdate } from '@rondo/db/schema/platform.schema';
import { teamDraft } from '@rondo/db/schema/play.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder, refusal } from '@rondo/telegram/testing/recording-telegram.layer';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { handleUpdate } from '../src/handle-update';

import { conversation, deliver, labelsOf, pollsTo } from './support/conversation';
import { botIs, chatRow, groupOf, knownChat, seedGroups } from './support/groups';
import { grantOrganizer, seedSeason } from './support/season';
import { teamsGame } from './support/teams-game';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();
const sentTo = (chatId: number) => recorder.calls.filter(call => call.payload.chat_id === chatId);
const full = { can_pin_messages: true };

const write = (chatId: number, from: number, text: string, topic?: number) =>
    deliver({
        message: {
            message_id: 1,
            date: 1_795_680_000,
            chat: groupOf(chatId),
            from: { id: from, is_bot: false, first_name: `Admin ${from}` },
            text,
            ...(isDefined(topic) ? { message_thread_id: topic, is_topic_message: true } : {})
        }
    });

const season = Effect.fn('test.groupSeason')(function* (slug: string, adminId: number, chats: Parameters<typeof seedGroups>[2]) {
    const seeded = yield* seedSeason(slug, { groupChatId: null, adminId });
    yield* seedGroups({ communityId: seeded.communityId, slug }, adminId, chats);

    return { ...seeded, admin: conversation(recorder, adminNumbered(adminId)) };
});

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('the bot is added to a group', it => {
    it.effect('asks the approver privately, links a known group on yes and keeps writing only to the approver', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const chatId = -41_001;
            const { communityId, admin } = yield* season('groups-yes', 4101, [knownChat(chatId)]);
            yield* botIs(chatId, 'left', 'administrator', full);
            const asked = admin.screen();
            const before = yield* chatRow(chatId);
            yield* admin.tap('✅ Так, підключити');
            const linked = admin.screen();
            const row = yield* chatRow(chatId);
            const [live] = yield* db.select({ since: community.liveSince }).from(community).where(eq(community.id, communityId));
            yield* admin.type('/newgame');
            yield* admin.tap('✅ Надіслати опитування мені');

            expect(asked.text).toContain('👋 Мене додали в «Games». Це основна група ігор. Я там нічого не пишу.');
            expect(labelsOf(asked)).toEqual(['✅ Так, підключити', '🧵 Обрати тему', '✖️ Ні']);
            expect(before).toBeUndefined();
            expect(linked.text).toContain('✅ «Games» підключено. У групу нічого не надіслано.');
            expect(linked.text).toContain('Режим: тільки мені.');
            expect(row).toMatchObject({ purpose: 'main', isPosting: false, isMentioning: false, topicId: null });
            expect(live?.since).toBeInstanceOf(Date);
            expect(pollsTo(recorder, 4101)).toHaveLength(1);
            expect(sentTo(chatId)).toEqual([]);
        })
    );

    it.effect('links nothing on no and offers to leave', () =>
        Effect.gen(function* () {
            const chatId = -41_011;
            const { admin } = yield* season('groups-no', 4111, [knownChat(chatId)]);
            yield* botIs(chatId, 'left', 'member');
            const asked = admin.screen();
            yield* admin.tap('✖️ Ні');
            const declined = admin.screen();
            yield* admin.tap('🚪 Вийти з групи');

            expect(asked.text).toContain('⚠️ У «Games» мені бракує права: закріплювати повідомлення.');
            expect(declined.text).toContain('Гаразд, «Games» не підключено.');
            expect(yield* chatRow(chatId)).toBeUndefined();
            expect(sentTo(chatId).map(call => call.method)).toEqual(['leaveChat']);
            expect(admin.screen().text).toBe('🚪 Вийшов із групи.');
        })
    );

    it.effect('takes the topic from the next message of the approver and of nobody else', () =>
        Effect.gen(function* () {
            const chatId = -41_021;
            const { communityId, admin } = yield* season('groups-topic', 4121, [knownChat(chatId)]);
            yield* grantOrganizer(communityId, 4122);
            yield* botIs(chatId, 'left', 'administrator', full);
            yield* admin.tap('🧵 Обрати тему');
            const prompt = admin.screen().text;
            yield* write(chatId, 4122, 'тут', 3);
            const early = yield* chatRow(chatId);
            yield* write(chatId, 4121, 'тут', 8);
            const bound = yield* chatRow(chatId);
            yield* write(chatId, 4121, 'і тут', 9);

            expect(prompt).toContain('🧵 Напиши будь-що в потрібній темі групи «Games»');
            expect(early).toBeUndefined();
            expect(bound).toMatchObject({ topicId: 8, isPosting: false });
            expect((yield* chatRow(chatId))?.topicId).toBe(8);
            expect(admin.screen().text).toContain('✅ «Games» підключено разом із темою.');
            expect(sentTo(chatId)).toEqual([]);
        })
    );

    it.effect('tells the approver and the owner once about an unknown group, stores nothing it hears there and leaves with one tap', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const chatId = -41_031;
            const { admin } = yield* season('groups-unknown', 4131, []);
            const owner = conversation(recorder, adminNumbered(42));
            const ownerBefore = owner.seen().length;
            yield* botIs(chatId, 'left', 'member');
            yield* botIs(chatId, 'left', 'member');
            const told = admin.screen();
            const ownerTold = owner.seen().slice(ownerBefore);
            const rows = (yield* db.select().from(processedUpdate)).length;
            const people = (yield* db.select().from(membership)).length;
            yield* write(chatId, 4131, 'Понеділок, 4 травня, 19.00 Park');
            yield* write(chatId, 4131, '/link groups-unknown');
            yield* handleUpdate({
                update_id: 790_001,
                chat_member: {
                    chat: groupOf(chatId),
                    new_chat_member: { status: 'member', user: { id: 77_001, is_bot: false, first_name: 'X' } }
                }
            });

            expect(told.text).toBe('❓ Мене додали в незнайому групу «Games». Я там нічого не пишу й не читаю.');
            expect(ownerTold.map(message => message.text)).toEqual([told.text]);
            expect((yield* db.select().from(processedUpdate)).length).toBe(rows);
            expect((yield* db.select().from(membership)).length).toBe(people);
            expect(yield* chatRow(chatId)).toBeUndefined();
            expect(sentTo(chatId)).toEqual([]);
            yield* admin.tap('🚪 Вийти з групи');
            expect(sentTo(chatId).map(call => call.method)).toEqual(['leaveChat']);
        })
    );

    it.effect('reports lost rights and a removal, and falls back to the private chat', () =>
        Effect.gen(function* () {
            const chatId = -41_041;
            const { admin } = yield* season('groups-removed', 4141, [knownChat(chatId)]);
            yield* botIs(chatId, 'left', 'administrator', full);
            yield* admin.tap('✅ Так, підключити');
            yield* admin.tap('📣 Писати в групу після мого ✅');
            const on = yield* chatRow(chatId);
            yield* botIs(chatId, 'administrator', 'administrator', { can_pin_messages: false });
            const noPin = admin.screen().text;
            const stillOn = yield* chatRow(chatId);
            yield* botIs(chatId, 'administrator', 'member');
            const demoted = admin.screen().text;
            const off = yield* chatRow(chatId);
            yield* admin.tap('👥 Відкрити налаштування групи');
            yield* admin.tap('📣 Писати в групу після мого ✅');
            yield* botIs(chatId, 'member', 'kicked');
            const removed = admin.screen().text;
            yield* admin.type('/newgame');

            expect(on?.isPosting).toBe(true);
            expect(noPin).toContain('⚠️ У «Games» мені бракує права: закріплювати повідомлення.');
            expect(stillOn?.isPosting).toBe(true);
            expect(demoted).toContain('📴 У «Games» я більше не адміністратор. Тепер пишу тільки тобі.');
            expect(off?.isPosting).toBe(false);
            expect(removed).toBe('📴 Мене прибрали з «Games». Тепер пишу тільки тобі.');
            expect((yield* chatRow(chatId))?.isPosting).toBe(false);
            expect(labelsOf(admin.screen()).join(' ')).toContain('✅ Надіслати опитування мені');
            expect(sentTo(chatId)).toEqual([]);
        })
    );

    it.effect('lets only the approver open a group, lets every admin close it, and unlinks a wrong group with one tap', () =>
        Effect.gen(function* () {
            const [chatId, second] = [-41_051, -41_052];
            const { communityId, admin } = yield* season('groups-switch', 4151, [
                knownChat(chatId),
                knownChat(second, { title: 'Second', purpose: 'other', weekdays: ['wed'] })
            ]);
            yield* grantOrganizer(communityId, 4152);
            const other = conversation(recorder, adminNumbered(4152));
            yield* botIs(chatId, 'left', 'administrator', full);
            yield* admin.tap('✅ Так, підключити');
            yield* botIs(second, 'left', 'administrator', full);
            yield* admin.tap('✅ Так, підключити');
            yield* other.type('/menu');
            yield* other.tap('👥 Групи');
            yield* other.tap('Games');
            yield* other.tap('📣 Писати в групу після мого ✅');
            const refused = yield* chatRow(chatId);
            yield* admin.type('/menu');
            yield* admin.tap('👥 Групи');
            yield* admin.tap('Games');
            yield* admin.tap('📣 Писати в групу після мого ✅');
            const opened = yield* linkedChatsOf(communityId);
            yield* other.type('/menu');
            yield* other.tap('👥 Групи');
            yield* other.tap('Games');
            yield* other.tap('👤 Писати тільки мені');
            const closed = yield* chatRow(chatId);
            yield* admin.tap('✂️ Відключити групу');

            expect(refused?.isPosting).toBe(false);
            expect(opened.map(chat => [chat.title, chat.purpose, chat.isPosting])).toEqual([
                ['Games', 'main', true],
                ['Second', 'other', false]
            ]);
            expect(closed?.isPosting).toBe(false);
            expect(admin.screen().text).toContain('✂️ «Games» відключено.');
            expect(yield* chatRow(chatId)).toBeUndefined();
            expect((yield* chatRow(second))?.purpose).toBe('other');
            expect(sentTo(chatId)).toEqual([]);
        })
    );

    it.effect('tells the owner when the approver never opened the bot', () =>
        Effect.gen(function* () {
            const chatId = -41_061;
            yield* season('groups-unheard', 4161, [knownChat(chatId)]);
            recorder.failures.set('sendMessage', refusal('sendMessage', 'Forbidden: bot can not initiate conversation', 403));
            const before = recorder.calls.length;
            yield* botIs(chatId, 'left', 'administrator', full);
            recorder.failures.delete('sendMessage');
            const tried = recorder.calls.slice(before).filter(call => call.method === 'sendMessage');

            expect(tried.map(call => call.payload.chat_id)).toEqual([4161, 42]);
            expect(String(tried[1]?.payload.text)).toContain('⚠️ Організатор недоступний для бота. У групу нічого не надіслано.');
            expect(yield* chatRow(chatId)).toBeUndefined();
            expect(sentTo(chatId)).toEqual([]);
        })
    );

    it.effect('follows a known group that becomes a supergroup before it is linked', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* season('groups-migrate', 4171, [knownChat(-4171, { topicId: 6 })]);
            yield* deliver({
                message: {
                    message_id: 5,
                    date: 0,
                    chat: { id: -4171, type: 'group', title: 'Games' },
                    from: { id: 4171, is_bot: false, first_name: 'Admin 4171' },
                    migrate_to_chat_id: -41_071
                }
            });
            const admin = conversation(recorder, adminNumbered(4171));
            yield* botIs(-41_071, 'left', 'administrator', full);
            yield* admin.tap('✅ Так, підключити');
            const [row] = yield* db.select().from(telegramChat).where(eq(telegramChat.communityId, communityId));

            expect(row).toMatchObject({ chatId: -41_071n, purpose: 'main', topicId: 6 });
        })
    );

    it.effect('preselects the group whose usual day it is while no game was posted yet', () =>
        Effect.gen(function* () {
            const { communityId, admin } = yield* season('groups-days', 4181, [
                knownChat(-41_081, { weekdays: ['mon'] }),
                knownChat(-41_082, { title: 'Second', purpose: 'other', weekdays: ['fri'] })
            ]);
            yield* linkGroup(communityId, { chatId: -41_081, title: 'Games' });
            yield* linkGroup(communityId, { chatId: -41_082, title: 'Second', purpose: 'other' });
            yield* admin.type('/newgame');

            expect(labelsOf(admin.screen())).toContain('✅ Надіслати в «Second»');
        })
    );

    it.effect('tells the sender privately when a squad typed in the group is not stored', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const chatId = -41_091;
            const game = yield* teamsGame('groups-squad', { groupChatId: chatId, adminId: 4191, players: 8 });
            yield* openDraft(game.communityId, game.sessionId, null);
            yield* db
                .update(teamDraft)
                .set({ publishToken: '00000000-0000-7000-8000-000000000000', publishAt: new Date('2026-11-26T09:00:00Z') })
                .where(eq(teamDraft.sessionId, game.sessionId));
            yield* deliver({
                message: {
                    message_id: 61,
                    date: Math.floor(Date.parse('2026-11-27T12:00:00Z') / 1000),
                    chat: groupOf(chatId),
                    from: { id: 4191, is_bot: false, first_name: 'Admin 4191', language_code: 'uk' },
                    text: 'Склади на сьогодні, 19.00:\n🔴Andriy, Bohdan, Vasyl, Lev\n🔵Dmytro, Ivan, Oleh, Petro'
                }
            });
            const admin = conversation(recorder, adminNumbered(4191));

            expect(admin.screen().text).toContain('Склад із «Games» не збережено');
            expect(admin.screen().text).toContain('У групу нічого не надіслано.');
            expect(sentTo(chatId)).toEqual([]);
        })
    );
});
