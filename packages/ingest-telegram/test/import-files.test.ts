import * as NodeServices from '@effect/platform-node/NodeServices';
import { expect, layer } from '@effect/vitest';
import { isDefined } from '@rnw-community/shared';
import { community } from '@rondo/db/schema/org.schema';
import { sourceRef } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { testDbLayer } from '@rondo/db/testing/test-db.layer';
import { and, eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Layer from 'effect/Layer';
import * as Logger from 'effect/Logger';
import * as Option from 'effect/Option';

import { ingest } from '../src/ingest.effect';

import { testConfig } from './fixture';

const chatId = -1009;

const pollLine = (id: number, date: string, pollId: string, question: string): string =>
    JSON.stringify({
        _: 'Message',
        id,
        date,
        from_id: { user_id: 41 },
        media: { poll: { id: pollId, question: { text: question }, answers: [{ text: { text: '+' }, option: 'MA==' }] } }
    });
const desktopPoll = (id: number, date: string, question: string) => ({
    id,
    type: 'message',
    date: date.slice(0, 19),
    date_unixtime: String(Date.parse(date) / 1000),
    from: 'Org',
    from_id: 'user41',
    poll: { question, answers: ['+', '-'].map(text => ({ text, voters: 0 })) }
});

const makeExport = Effect.fn('test.makeExport')(function* (slug: string, second?: string) {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped();
    const write = (name: string, content: string) => fs.writeFileString(`${root}/${name}`, content);
    yield* fs.makeDirectory(`${root}/second`);
    yield* write(
        'config.json',
        JSON.stringify({ ...testConfig, slug, otherChats: [{ chatId, exportDir: 'second', matchPatterns: ['cup'] }] })
    );
    const question = 'Сегодня, 19.00 North';
    yield* write('result.json', JSON.stringify({ messages: [desktopPoll(1, '2025-05-07T08:00:00Z', question)] }));
    yield* write('users.json', '[]');
    yield* write('messages.jsonl', JSON.stringify({ id: 1, poll: { id: 'main-poll', answers: [{ text: '+', option: '30' }] } }));
    yield* write('votes.jsonl', '');
    yield* write('second/users.json', '[]');

    if (isDefined(second)) {
        yield* write('second/messages.jsonl', second);
    }

    return {
        root,
        run: ingest({ exportDir: root, configPath: `${root}/config.json`, allowRemoval: true, reviewFile: Option.some(`${root}/review`) })
    };
});

layer(Layer.mergeAll(NodeServices.layer, testDbLayer), { timeout: 60_000 })('import from files', it => {
    it.effect('stops before it writes when a configured chat has no messages', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const missing = yield* makeExport('no-second-export');
            const empty = yield* makeExport('no-second-export', '\n');
            const errors = [yield* Effect.flip(missing.run), yield* Effect.flip(empty.run)];
            const stored = yield* db.select().from(community).where(eq(community.slug, 'no-second-export'));

            expect(errors.map(error => error._tag)).toEqual(['MissingChatExportError', 'MissingChatExportError']);
            expect(stored).toEqual([]);
        })
    );

    it.effect('names posts to review in a private file only and dates a forward by its own post', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const fs = yield* FileSystem.FileSystem;
            const logged: string[] = [];
            const logger = Logger.make(({ message }) => logged.push(JSON.stringify(message)));
            const { root, run } = yield* makeExport(
                'review-file',
                [
                    pollLine(7, '2025-05-07T09:00:00Z', 'main-poll', 'Сегодня, 19.00 North'),
                    pollLine(8, '2025-05-10T08:00:00Z', 'weekend-poll', 'Сегодня, 19.00 North')
                ].join('\n')
            );
            yield* fs.writeFileString(`${root}/review`, 'old');
            yield* run.pipe(Effect.provide(Logger.layer([logger])));
            const { mode } = yield* fs.stat(`${root}/review`);
            const [home] = yield* db.select().from(community).where(eq(community.slug, 'review-file'));
            const refs = yield* db
                .select({ sentAt: sourceRef.sentAt })
                .from(sourceRef)
                .where(and(eq(sourceRef.communityId, home?.id ?? ''), eq(sourceRef.chatId, chatId)));

            expect(yield* fs.readFileString(`${root}/review`)).toBe(`${chatId}|8|2025-05-10\n`);
            expect(mode % 0o1000).toBe(0o600);
            expect(logged.join('')).toContain('"review":1');
            expect(logged.join('')).not.toContain(String(chatId));
            expect(refs).toEqual([{ sentAt: new Date('2025-05-07T09:00:00Z') }]);
        })
    );
});
