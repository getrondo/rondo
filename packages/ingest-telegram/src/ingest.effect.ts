import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { isDefined } from '@rnw-community/shared';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Schema from 'effect/Schema';

import { CommunityConfigSchema, type CommunityConfig } from './config/community-config';
import { assemblePlan } from './extract/assemble-plan';
import { extractAll } from './extract/extract-all';
import { instantToLocalDate } from './extract/zoned-time';
import { loadPlan } from './load/load-plan';
import { parseHtmlPage } from './parse/parse-html-export';

import type { TelegramMessage } from './model/telegram-message.model';

const pageOrder = (name: string): number => Number(/messages(\d*)\.html$/u.exec(name)?.[1] || 1);

const readExport = Effect.fn('IngestTelegram.readExport')(function* (exportDir: string, config: CommunityConfig) {
    const fs = yield* FileSystem.FileSystem;
    const pages = (yield* fs.readDirectory(exportDir))
        .filter(name => /^messages\d*\.html$/u.test(name))
        .toSorted((a, b) => pageOrder(a) - pageOrder(b));
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

const readConfig = Effect.fn('IngestTelegram.readConfig')(function* (configPath: string) {
    const fs = yield* FileSystem.FileSystem;
    const raw = yield* fs.readFileString(configPath);

    return yield* Schema.decodeEffect(Schema.fromJsonString(CommunityConfigSchema))(raw);
});

export const ingest = Effect.fn('IngestTelegram.ingest')(function* (exportDir: string, configPath: string) {
    const config = yield* readConfig(configPath);
    const { messages, fileSha256 } = yield* readExport(exportDir, config);
    const now = yield* DateTime.nowAsDate;
    const lastSent = messages.findLast(message => isDefined(message.sentAt))?.sentAt ?? now;
    const plan = assemblePlan(extractAll(messages, config), instantToLocalDate(lastSent, config.timeZone));
    const stats = yield* loadPlan(config, plan, fileSha256);

    yield* Effect.logInfo('Telegram export ingested', stats);

    return stats;
});
