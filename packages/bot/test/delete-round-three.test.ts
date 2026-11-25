import { expect, layer } from '@effect/vitest';
import { createSession } from '@rondo/core/sessions/session.service';
import { lineupEntry } from '@rondo/db/schema/play.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder, refusal } from '@rondo/telegram/testing/recording-telegram.layer';
import * as Effect from 'effect/Effect';

import { conversation, deliver, labelsOf, lastPollId, walkManual } from './support/conversation';
import { gamesOn, seedSeason } from './support/season';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const voters = { total: 0 };
const base = makeRecorder();
const recorder = makeRecorder((method, payload) =>
    method === 'stopPoll' ? { id: 'stopped', total_voter_count: voters.total, is_closed: true } : base.reply(method, payload)
);
const vote = (pollId: string, id: number) =>
    deliver({
        poll_answer: {
            poll_id: pollId,
            user: { id, is_bot: false, first_name: `Admin ${id}` },
            option_ids: [0],
            option_persistent_ids: []
        }
    });

const postedGame = (slug: string, adminId: number, groupChatId: number) =>
    Effect.gen(function* () {
        const { communityId } = yield* seedSeason(slug, { groupChatId, adminId });
        const admin = conversation(recorder, adminNumbered(adminId));
        yield* admin.type('/newgame');
        yield* admin.tap('✅ Надіслати');
        yield* vote(lastPollId(recorder, groupChatId), adminId);
        const [game] = yield* gamesOn(communityId, '2026-11-27');

        return { admin, sessionId: game?.id ?? '', communityId };
    });

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('deleting a game after the council', it => {
    it.effect('keeps the game when the poll cannot be closed or holds votes the bot has not seen', () =>
        Effect.gen(function* () {
            const refused = yield* postedGame('r3-delete-refused', 2201, -22_001);
            yield* refused.admin.type('/games');
            yield* refused.admin.tap('Пт 27.11 19:00');
            yield* refused.admin.tap('🗑 Видалити');
            recorder.failures.set('stopPoll', refusal('stopPoll', "Bad Request: message can't be edited"));
            yield* refused.admin.tap('🗑 Видалити назавжди');
            recorder.failures.delete('stopPoll');
            const notClosed = refused.admin.screen().text;
            const keptRefused = yield* gamesOn(refused.communityId, '2026-11-27');
            const unseen = yield* postedGame('r3-delete-unseen', 2202, -22_002);
            yield* unseen.admin.type('/games');
            yield* unseen.admin.tap('Пт 27.11 19:00');
            yield* unseen.admin.tap('🗑 Видалити');
            voters.total = 2;
            yield* unseen.admin.tap('🗑 Видалити назавжди');
            voters.total = 0;
            const extra = unseen.admin.screen().text;
            const afterRefusal = labelsOf(unseen.admin.screen());
            const keptUnseen = yield* gamesOn(unseen.communityId, '2026-11-27');

            expect(notClosed).toContain('⚠️ Не вдалося закрити опитування, гру не видалено.');
            expect(keptRefused).toHaveLength(1);
            expect(extra).toContain('⚠️ В опитуванні є голоси, яких бот не бачив. Гру не видалено, опитування закрито.');
            expect(keptUnseen).toHaveLength(1);
            expect(afterRefusal.some(label => label.startsWith('🗑'))).toBe(false);
        })
    );

    it.effect('offers no delete for a game without the bot poll or with a line-up of other players', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const lined = yield* postedGame('r3-delete-lineup', 2203, -22_003);
            yield* db.insert(lineupEntry).values({
                sessionId: lined.sessionId,
                messageId: 5,
                teamOrdinal: 1,
                position: 1,
                resolvedBy: 'manual',
                personId: null,
                raw: 'Somebody'
            });
            yield* lined.admin.type('/games');
            yield* lined.admin.tap('Пт 27.11 19:00');
            const withLineup = lined.admin.screen();
            yield* seedSeason('r3-delete-saved', { groupChatId: -22_004, adminId: 2204 });
            const saver = conversation(recorder, adminNumbered(2204));
            yield* saver.type('/newgame');
            yield* walkManual(saver, ['🛠 З нуля', 'Сб 28.11', 'Park Field', '18:30', '👥 18', '💾 Зберегти без опитування']);
            const saved = saver.screen();

            expect(labelsOf(withLineup).some(label => label.startsWith('🗑'))).toBe(false);
            expect(labelsOf(saved).some(label => label.startsWith('🗑'))).toBe(false);
        })
    );

    it.effect('offers no delete for a game the menu did not create, even after the bot posted its poll', () =>
        Effect.gen(function* () {
            const { communityId, north } = yield* seedSeason('r4-delete-provenance', { groupChatId: -22_005, adminId: 2205 });
            yield* createSession({
                communityId,
                timezone: 'Europe/Vienna',
                localDate: '2026-11-28',
                localTime: '18:00',
                venueId: north,
                capacityMax: 14,
                title: null,
                actorPersonId: null
            });
            const admin = conversation(recorder, adminNumbered(2205));
            yield* admin.type('/games');
            yield* admin.tap('Сб 28.11 18:00');
            yield* admin.tap('📣 Надіслати в «Games»');
            yield* admin.tap('✅ Надіслати в «Games»');
            const card = admin.screen();

            expect(lastPollId(recorder, -22_005)).not.toBe('');
            expect(labelsOf(card).some(label => label.startsWith('🗑'))).toBe(false);
        })
    );

    it.effect('keeps the game and offers cancel when the poll was already closed and its voters cannot be counted', () =>
        Effect.gen(function* () {
            const closed = yield* postedGame('r5-delete-closed', 2206, -22_006);
            yield* closed.admin.type('/games');
            yield* closed.admin.tap('Пт 27.11 19:00');
            yield* closed.admin.tap('🗑 Видалити гру');
            recorder.failures.set('stopPoll', refusal('stopPoll', 'Bad Request: poll has already been closed'));
            yield* closed.admin.tap('🗑 Видалити назавжди');
            recorder.failures.delete('stopPoll');
            const kept = yield* gamesOn(closed.communityId, '2026-11-27');
            const screen = closed.admin.screen();

            expect(kept).toHaveLength(1);
            expect(screen.text.split('\n')[0]).toBe(
                '⚠️ Опитування вже закрите, голоси не перевірити. Гру не видалено, її можна скасувати.'
            );
            expect(labelsOf(screen)).toContain('✖️ Скасувати гру');
            expect(labelsOf(screen).some(label => label.startsWith('🗑'))).toBe(false);
        })
    );
});
