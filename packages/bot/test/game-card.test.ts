import { expect, layer } from '@effect/vitest';
import { syncMember } from '@rondo/core/identity/telegram-user';
import { setSeedRating } from '@rondo/core/teams/team.service';
import { session, signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import { and, eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { conversation } from './support/conversation';
import { seedSeason } from './support/season';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();
const groupPosts = (chatId: number) => recorder.calls.filter(call => call.method.startsWith('send') && call.payload.chat_id === chatId);

const fridayGame = Effect.fn('test.fridayGame')(function* (communityId: string) {
    const db = yield* Db;
    const [game] = yield* db
        .select()
        .from(session)
        .where(and(eq(session.communityId, communityId), eq(session.localDate, '2026-11-27')));

    return game;
});

const signUp = Effect.fn('test.signUp')(function* (communityId: string, sessionId: string, count: number) {
    const db = yield* Db;

    for (let index = 0; index < count; index += 1) {
        const personId = yield* syncMember(communityId, { id: BigInt(9000 + index), firstName: `Player ${index}` }, 'active');
        yield* db.insert(signup).values({ sessionId, personId, role: 'field', status: 'in' });
        yield* setSeedRating({ personId, communityId, level: 3 + index, actorPersonId: null });
    }
});

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('game card', it => {
    it.effect('changes time with a notice, place quietly and the size, each after one confirmation', () =>
        Effect.gen(function* () {
            const { communityId, park } = yield* seedSeason('card-change', { groupChatId: -2001, adminId: 201 });
            const admin = conversation(recorder, adminNumbered(201));
            yield* admin.type('/newgame');
            yield* admin.tap('✅ Опублікувати');
            const card = admin.screen();
            const before = groupPosts(-2001).length;
            yield* admin.tap('🕖 Час');
            yield* admin.type('20:15');
            const confirmTime = admin.screen();
            yield* admin.tap('✅ Змінити й повідомити');
            yield* admin.tap('📍 Місце');
            yield* admin.tap('Park Field');
            yield* admin.tap('🔕 Змінити тихо');
            yield* admin.tap('👥 Місця');
            yield* admin.tap('20');
            yield* admin.tap('🔕 Змінити тихо');
            const game = yield* fridayGame(communityId);
            const posts = groupPosts(-2001).slice(before);

            expect(card.buttons.map(row => row.map(button => button.text))).toEqual([
                ['🕖 Час', '📍 Місце', '👥 Місця'],
                ['✖️ Скасувати гру'],
                ['⬅️ Назад', '🏠 Меню']
            ]);
            expect(confirmTime.text).toContain('Так буде в групі');
            expect(confirmTime.text).toContain('➡️ <b>Пт 27.11 20:15 · North Arena</b>');
            expect(posts).toHaveLength(1);
            expect(String(posts[0]?.payload.text)).toContain('📍 <b>North Arena</b>');
            expect(game).toMatchObject({ venueId: park, capacityMax: 20 });
            expect(admin.screen().text).toContain('Пт 27.11 20:15 · Park Field');
            expect(admin.unanswered()).toEqual([]);
        })
    );

    it.effect('posts the poll of a game without one, cancels with a notice and publishes teams without levels', () =>
        Effect.gen(function* () {
            const { communityId } = yield* seedSeason('card-actions', { groupChatId: -2002, adminId: 202 });
            const admin = conversation(recorder, adminNumbered(202, 'ru'));
            yield* admin.type('/newgame');
            yield* admin.tap('🛠 Вручную');
            yield* admin.tap('Пт 27.11');
            yield* admin.tap('North Arena');
            yield* admin.tap('19:00');
            yield* admin.tap('👥 22');
            yield* admin.tap('💾 Без опроса');
            const game = yield* fridayGame(communityId);
            yield* signUp(communityId, game?.id ?? '', 4);
            yield* admin.type('/games');
            yield* admin.tap('Пт 27.11 19:00');
            yield* admin.tap('📣 Опрос');
            const pollConfirm = admin.screen().text;
            yield* admin.tap('✅ Опубликовать');
            yield* admin.tap('👕 Составы');
            yield* admin.tap('2 команды');
            const teams = admin.screen().text;
            yield* admin.tap('✅ Опубликовать');
            const lineup = groupPosts(-2002).at(-1);
            yield* admin.tap('✖️ Отменить игру');
            yield* admin.tap('погода');
            yield* admin.tap('✅ Отменить и сообщить');
            const cancelled = groupPosts(-2002).at(-1);
            const after = yield* fridayGame(communityId);

            expect(pollConfirm).toContain('Так будет в группе');
            expect(pollConfirm).toContain('▫️ ✅ Граю');
            expect(groupPosts(-2002).some(call => call.method === 'sendPoll')).toBe(true);
            expect(teams).toContain(String(lineup?.payload.text).split('\n')[2]);
            expect(String(lineup?.payload.text)).not.toContain('Σ');
            expect(String(cancelled?.payload.text)).toContain('Скасовано');
            expect(after?.status).toBe('cancelled');
        })
    );
});
