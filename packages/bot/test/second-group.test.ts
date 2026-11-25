import { expect, layer } from '@effect/vitest';
import { isDefined } from '@rnw-community/shared';
import { linkGroup } from '@rondo/core/testing/link-group';
import { community } from '@rondo/db/schema/org.schema';
import { importedPoll, ingestRun, sourceRef } from '@rondo/db/schema/platform.schema';
import { lineupEntry } from '@rondo/db/schema/play.schema';
import { session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import { and, eq, gte, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { deliver, groupPoll } from './support/conversation';
import { seedSeason } from './support/season';
import { menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();
const moved = -1_000_029_002;

const post = (chatId: number, messageId: number, sentAt: string, content: { readonly question?: string; readonly text?: string }) =>
    deliver({
        message: {
            message_id: messageId,
            date: Date.parse(sentAt) / 1000,
            chat: { id: chatId, type: 'supergroup', title: 'Second' },
            from: { id: 2901, is_bot: false, first_name: 'Admin 2901' },
            ...(isDefined(content.text) ? { text: content.text } : {}),
            ...(isDefined(content.question) ? { poll: groupPoll(`organizer-${messageId}`, content.question, ['+', '-']) } : {})
        }
    });

const seedMatchChat = Effect.fn('test.seedMatchChat')(function* (slug: string, chatId: number) {
    const db = yield* Db;
    const { communityId } = yield* seedSeason(slug, { groupChatId: null, adminId: 2901 });
    yield* linkGroup(communityId, { chatId, title: 'Second', purpose: 'other' });
    const otherChats = [{ chatId, exportDir: 'second', matchPatterns: ['friendly'] }];
    yield* db
        .update(community)
        .set({ settings: sql`jsonb_set(${community.settings}, '{ingest,otherChats}', ${JSON.stringify(otherChats)}::jsonb)` })
        .where(eq(community.id, communityId));

    return communityId;
});

const newGames = Effect.fn('test.newGames')(function* (communityId: string) {
    const db = yield* Db;
    const games = yield* db
        .select({ date: session.localDate })
        .from(session)
        .where(and(eq(session.communityId, communityId), gte(session.localDate, '2027-01-01')));

    return games.map(({ date }) => date).toSorted();
});

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('a second group that also has matches', it => {
    it.effect('makes weekly games from organizer posts of a group with matches, never its matches and friendlies', () =>
        Effect.gen(function* () {
            const communityId = yield* seedMatchChat('second-live', -29_001);
            yield* post(-29_001, 1, '2027-01-08T08:00:00Z', { question: 'Завтра, 12.00 North' });
            yield* post(-29_001, 2, '2027-01-12T08:00:00Z', { question: 'Сегодня, 19.00 North, friendly' });
            yield* post(-29_001, 3, '2027-01-10T08:00:00Z', { text: 'Составы на сегодня, North:\n🟢Я, Иван\n🔵Олег, Семён' });
            const none = yield* newGames(communityId);
            yield* post(-29_001, 4, '2027-01-13T08:00:00Z', { question: 'Сегодня, 19.00 North' });
            const weekly = yield* newGames(communityId);

            expect(none).toEqual([]);
            expect(weekly).toEqual(['2027-01-13']);
        })
    );

    it.effect('moves imported posts and the match rules of a group that became a supergroup', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const communityId = yield* seedMatchChat('second-move', -29_002);
            const [game] = yield* db.select({ id: session.id }).from(session).where(eq(session.communityId, communityId)).limit(1);
            const sessionId = game?.id ?? '';
            const [run] = yield* db
                .insert(ingestRun)
                .values({ communityId, source: 'telegram_json', fileSha256: 'sha', parserVersion: '2' })
                .returning();
            const at = new Date('2026-11-01T08:00:00Z');
            const ofRun = { runId: run?.id ?? '', communityId, chatId: -29_002, sentAt: at };
            yield* db.insert(sourceRef).values([
                { ...ofRun, messageId: 1, kind: 'poll' },
                { ...ofRun, messageId: 2, kind: 'poll' },
                { ...ofRun, chatId: moved, messageId: 2, kind: 'poll' }
            ]);
            yield* db.insert(importedPoll).values({
                pollId: 'second-move',
                communityId,
                sessionId,
                chatId: -29_002,
                messageId: 1,
                postedAt: at,
                kind: 'participation',
                answers: 2
            });
            yield* db
                .insert(lineupEntry)
                .values({ sessionId, chatId: -29_002, messageId: 3, teamOrdinal: 9, position: 1, raw: 'Иван', resolvedBy: 'guest' });
            yield* deliver({
                message: {
                    message_id: 5,
                    date: 1_795_680_000,
                    chat: { id: -29_002, type: 'group', title: 'Second' },
                    from: { id: 2901, is_bot: false, first_name: 'Admin 2901' },
                    migrate_to_chat_id: moved
                }
            });
            yield* post(moved, 6, '2027-01-08T08:00:00Z', { question: 'Завтра, 12.00 North' });
            const refs = yield* db.select().from(sourceRef).where(eq(sourceRef.communityId, communityId));
            const [poll] = yield* db.select().from(importedPoll).where(eq(importedPoll.pollId, 'second-move'));
            const [entry] = yield* db
                .select()
                .from(lineupEntry)
                .where(and(eq(lineupEntry.sessionId, sessionId), eq(lineupEntry.teamOrdinal, 9)));

            expect(refs.map(ref => [ref.chatId, ref.messageId]).toSorted((left, right) => Number(left[1]) - Number(right[1]))).toEqual([
                [moved, 1],
                [moved, 2]
            ]);
            expect(poll?.chatId).toBe(moved);
            expect(entry?.chatId).toBe(moved);
            expect(yield* newGames(communityId)).toEqual([]);
        })
    );
});
