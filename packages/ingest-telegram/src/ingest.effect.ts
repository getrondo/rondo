import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { Db } from '@rondo/db/service/db.service';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

import { CommunityConfigSchema, type CommunityConfig } from './config/community-config';
import { ExportPagesNotFoundError } from './error/export-pages-not-found.error';
import { assemblePlan } from './extract/assemble-plan';
import { extractAll } from './extract/extract-all';
import { instantToLocalDate } from './extract/zoned-time';
import { withoutLiveMessages } from './load/live-messages';
import { loadPlan } from './load/load-plan';
import { lockCommunity } from './load/lock-community';
import { parseHtmlPage } from './parse/parse-html-export';
import { parseJsonExport } from './parse/parse-json-export';
import { parseSnapshot } from './parse/parse-snapshot';

import type { TelegramMessage } from './model/telegram-message.model';
import type { TelegramSnapshot } from './model/telegram-snapshot.model';

const pageOrder = (name: string): number => Number(/messages(\d*)\.html$/u.exec(name)?.[1] || 1);

const readExport = Effect.fn('IngestTelegram.readExport')(function* (exportDir: string, config: CommunityConfig) {
    const fs = yield* FileSystem.FileSystem;
    const pages = (yield* fs.readDirectory(exportDir))
        .filter(name => /^messages\d*\.html$/u.test(name))
        .toSorted((a, b) => pageOrder(a) - pageOrder(b));

    if (!isNotEmptyArray(pages)) {
        return yield* ExportPagesNotFoundError.make({ exportDir });
    }

    const hash = createHash('sha256');
    const messages: TelegramMessage[] = [];
    let author: string | undefined;

    for (const page of pages) {
        const html = yield* fs.readFileString(join(exportDir, page));
        hash.update(html);
        const parsed = parseHtmlPage(html, author, config.timeZone);
        messages.push(...parsed.messages);
        author = parsed.lastAuthor;
    }

    return { messages, fileSha256: hash.digest('hex') };
});

const readMessages = Effect.fn('IngestTelegram.readMessages')(function* (exportDir: string, config: CommunityConfig) {
    const fs = yield* FileSystem.FileSystem;
    const jsonPath = join(exportDir, 'result.json');

    if (!(yield* fs.exists(jsonPath))) {
        return yield* readExport(exportDir, config);
    }

    const json = yield* fs.readFileString(jsonPath);

    return { messages: yield* parseJsonExport(json), fileSha256: createHash('sha256').update(json).digest('hex') };
});

const readSnapshot = Effect.fn('IngestTelegram.readSnapshot')(function* (exportDir: string) {
    const fs = yield* FileSystem.FileSystem;
    const names = (yield* fs.readDirectory(exportDir)).toSorted();
    const readAll = (pattern: RegExp) =>
        Effect.all(names.filter(name => pattern.test(name)).map(name => fs.readFileString(join(exportDir, name))));
    const [messages] = yield* readAll(/^messages\.jsonl$/u);

    if (!isDefined(messages)) {
        return Option.none<TelegramSnapshot>();
    }

    const users = yield* readAll(/^users\d*\.json$/u);
    const votes = yield* readAll(/^votes\d*\.jsonl$/u);
    const snapshot = yield* parseSnapshot({ users, messages, votes });

    return Option.fromNullishOr(snapshot);
});

const readConfig = Effect.fn('IngestTelegram.readConfig')(function* (configPath: string) {
    const fs = yield* FileSystem.FileSystem;
    const raw = yield* fs.readFileString(configPath);

    return yield* Schema.decodeEffect(Schema.fromJsonString(CommunityConfigSchema))(raw);
});

export const ingest = Effect.fn('IngestTelegram.ingest')(function* (exportDir: string, configPath: string) {
    const db = yield* Db;
    const config = yield* readConfig(configPath);
    const { messages, fileSha256 } = yield* readMessages(exportDir, config);
    const snapshot = yield* readSnapshot(exportDir);
    const now = yield* DateTime.nowAsDate;
    const lastSent = messages.findLast(message => isDefined(message.sentAt))?.sentAt ?? now;
    const stats = yield* db.transaction(() =>
        Effect.gen(function* () {
            yield* lockCommunity(config.slug);
            const unhandled = yield* withoutLiveMessages(config.slug, messages);
            const plan = assemblePlan(extractAll(unhandled, config), instantToLocalDate(lastSent, config.timeZone));

            return yield* loadPlan(config, plan, fileSha256, Option.getOrUndefined(snapshot));
        })
    );

    yield* Effect.logInfo('Telegram export ingested', stats);

    return stats;
});
