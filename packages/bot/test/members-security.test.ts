import { expect, layer } from '@effect/vitest';
import { describeAction } from '@rondo/core/actions/describe-action';
import { proposeAction } from '@rondo/core/actions/pending-action.service';
import { createSession } from '@rondo/core/sessions/session.service';
import { person, telegramAccount } from '@rondo/db/schema/identity.schema';
import { membership } from '@rondo/db/schema/org.schema';
import { session, signup } from '@rondo/db/schema/scheduling.schema';
import { venue } from '@rondo/db/schema/venue.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import { and, eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { toShortId } from '../src/utils/to-short-id.util';

import { conversation, deliver } from './support/conversation';
import { advanceNow } from './support/fixed-clock';
import { seedSeason } from './support/season';
import { adminNumbered, menuTestLayer } from './support/test-layer';

import type { Action } from '@rondo/core/actions/action.model';

const recorder = makeRecorder();
const member = { id: 9901, is_bot: false as const, first_name: 'Member', language_code: 'ru' };
const groupMessage = (
    chatId: number,
    from: { readonly id: number; readonly first_name: string; readonly username?: string },
    extra: object
) =>
    deliver({
        message: {
            message_id: 1,
            date: 0,
            chat: { id: chatId, type: 'supergroup', title: 'Games' },
            from: { is_bot: false, ...from },
            ...extra
        }
    });
const lastAnswer = () => recorder.calls.findLast(call => call.method === 'answerCallbackQuery')?.payload.text;

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('members and security', it => {
    it.effect('follows a member who writes, leaves, rejoins, renames and changes the username', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedSeason('members-life', { groupChatId: -8001, adminId: 1001 });
            const user = { id: 9801, first_name: 'Anna', username: 'anna_old' };
            yield* groupMessage(-8001, user, { text: 'hello' });
            const statusOf = Effect.fn('test.statusOf')(function* () {
                const [row] = yield* db
                    .select({ status: membership.status, name: person.displayName, username: telegramAccount.username })
                    .from(membership)
                    .innerJoin(telegramAccount, eq(telegramAccount.personId, membership.personId))
                    .innerJoin(person, eq(person.id, membership.personId))
                    .where(and(eq(membership.communityId, communityId), eq(telegramAccount.tgUserId, 9801n)));

                return row;
            });
            const wrote = yield* statusOf();
            yield* groupMessage(-8001, { id: 1001, first_name: 'Admin' }, { left_chat_member: { ...user, is_bot: false } });
            const left = yield* statusOf();
            yield* groupMessage(-8001, { id: 1001, first_name: 'Admin' }, { new_chat_members: [{ ...user, is_bot: false }] });
            const back = yield* statusOf();
            yield* groupMessage(-8001, { id: 9801, first_name: 'Anna B', username: 'anna_new' }, { text: 'renamed' });
            const renamed = yield* statusOf();

            expect(wrote).toEqual({ status: 'active', name: 'Anna', username: 'anna_old' });
            expect(left?.status).toBe('left');
            expect(back?.status).toBe('active');
            expect(renamed).toEqual({ status: 'active', name: 'Anna B', username: 'anna_new' });
        })
    );

    it.effect('rejects, expires and refuses a foreign confirmation button', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedSeason('assistant-buttons', { groupChatId: -8002, adminId: 1002 });
            const admin = conversation(recorder, adminNumbered(1002));
            const stranger = conversation(recorder, member);
            const propose = (localDate: string) =>
                Effect.gen(function* () {
                    const action: Action = {
                        _tag: 'create_session',
                        localDate,
                        localTime: '10:00',
                        venueId: null,
                        capacityMax: 10,
                        title: null,
                        announce: false
                    };
                    const summary = yield* describeAction(action, 'uk', communityId);

                    return yield* proposeAction({ communityId, tgUserId: 1002n, action, summary });
                });
            const rejected = yield* propose('2026-12-12');
            yield* admin.press(`act:${rejected}:n`);
            const foreign = yield* propose('2026-12-13');
            yield* stranger.press(`act:${foreign}:y`);
            const expiring = yield* propose('2026-12-14');
            yield* advanceNow(31 * 60_000);
            yield* admin.press(`act:${expiring}:y`);
            const expiredText = recorder.calls.findLast(call => call.method === 'editMessageText')?.payload.text;
            const games = yield* db.select().from(session).where(eq(session.communityId, communityId));

            expect(
                String(
                    recorder.calls.findLast(call => call.method === 'editMessageText' && String(call.payload.text).includes('Скасовано'))
                        ?.payload.text
                )
            ).toContain('нічого не змінено');
            expect(String(expiredText)).toContain('Час на підтвердження минув');
            expect(games.filter(game => ['2026-12-12', '2026-12-13', '2026-12-14'].includes(game.localDate))).toHaveLength(0);
        })
    );

    it.effect('answers members without the menu and refuses a game of another community in callback data', () =>
        Effect.gen(function* () {
            const { communityId: other } = yield* seedSeason('security-other', { groupChatId: -8004, adminId: 1004 });
            yield* seedSeason('security-own', { groupChatId: -8003, adminId: 1003 });
            const foreignGame = yield* createSession({
                communityId: other,
                timezone: 'Europe/Vienna',
                localDate: '2026-12-01',
                localTime: '19:00',
                venueId: null,
                capacityMax: 10,
                title: null,
                actorPersonId: null
            });
            const stranger = conversation(recorder, member);
            const admin = conversation(recorder, adminNumbered(1003));
            yield* stranger.type('/newgame');
            const refusedCommand = stranger.screen().text;
            yield* stranger.press('m:gl');
            const refusedTap = lastAnswer();
            yield* admin.type('/menu');
            yield* admin.press(`m:g:${toShortId(foreignGame)}`);
            const foreignCard = lastAnswer();
            yield* admin.press(`c:p:${toShortId(foreignGame)}`);
            const foreignAction = lastAnswer();

            expect(refusedCommand).toContain('Пока я работаю с администраторами');
            expect(String(refusedTap)).toContain('больше не администратор');
            expect(String(foreignCard)).toContain('Цієї гри вже немає');
            expect(String(foreignAction)).toContain('Цієї гри вже немає');
            expect(admin.screen().text).toContain('Rondo');
        })
    );

    it.effect('escapes names and places in every text posted to the group', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, north } = yield* seedSeason('security-html', { groupChatId: -8005, adminId: 1005 });
            yield* db
                .update(venue)
                .set({ name: 'R&D <Arena>', address: 'Gate "A" & <B>', lat: 48.1, lng: 16.1 })
                .where(eq(venue.id, north));
            const admin = conversation(recorder, adminNumbered(1005));
            yield* admin.type('/newgame');
            yield* admin.tap('👥 22');
            yield* admin.type('1');
            yield* admin.tap('✅ Опублікувати');
            const poll = recorder.calls.findLast(call => call.method === 'sendPoll' && call.payload.chat_id === -8005);
            const pollId = (poll?.result as { poll?: { id?: string } } | undefined)?.poll?.id ?? '';
            const vote = (id: number, name: string, optionIds: number[]) =>
                deliver({
                    poll_answer: {
                        poll_id: pollId,
                        user: { id, is_bot: false, first_name: name },
                        option_ids: optionIds,
                        option_persistent_ids: []
                    }
                });
            yield* vote(9951, '<b>Bob</b>', [0]);
            yield* vote(9952, 'Eve & Co', [0]);
            yield* vote(9953, 'Third', [0]);
            yield* vote(9954, 'Fourth', [0]);
            yield* vote(9951, '<b>Bob</b>', []);
            yield* vote(9951, '<b>Bob</b>', [0]);
            const [game] = yield* db
                .select()
                .from(session)
                .where(and(eq(session.communityId, communityId), eq(session.localDate, '2026-11-27')));
            yield* db
                .update(signup)
                .set({ status: 'in' })
                .where(eq(signup.sessionId, game?.id ?? ''));
            yield* admin.type('/games');
            yield* admin.tap('Пт 27.11 19:00');
            yield* admin.tap('🕖 Час');
            yield* admin.tap('19:30');
            yield* admin.tap('✅ Змінити й повідомити');
            yield* admin.tap('👕 Склади');
            yield* admin.tap('2 команди');
            yield* admin.tap('✅ Опублікувати');
            const posts = recorder.calls
                .filter(call => call.method === 'sendMessage' && call.payload.chat_id === -8005)
                .map(call => String(call.payload.text));
            const texts = [String(poll?.payload.description), ...posts];

            expect(texts.length).toBeGreaterThanOrEqual(4);
            expect(texts.every(text => !text.includes('<Arena>') && !text.includes('<b>Bob</b>') && !text.includes('Eve & Co'))).toBe(true);
            expect(texts.join('\n')).toContain('R&amp;D &lt;Arena&gt;');
            expect(texts.join('\n')).toContain('Eve &amp; Co');
        })
    );
});
