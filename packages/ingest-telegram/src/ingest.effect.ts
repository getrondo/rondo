import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { isDefined, isNotEmptyArray, isNotEmptyString } from '@rnw-community/shared';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

import { CommunityConfigSchema, type CommunityConfig } from './config/community-config';
import { ExportPagesNotFoundError } from './error/export-pages-not-found.error';
import { MissingChatExportError } from './error/missing-chat-export.error';
import { assemblePlan } from './extract/assemble-plan';
import { extractAll } from './extract/extract-all';
import { numberPosts, planOtherChats, type ChatContent } from './extract/plan-other-chats';
import { instantToLocalDate } from './extract/zoned-time';
import { assertKnownChats } from './load/assert-known-chats';
import { withoutBotPosts } from './load/live-messages';
import { loadPlan } from './load/load-plan';
import { withCommunityLock } from './load/with-community-lock';
import { parseHtmlPage } from './parse/parse-html-export';
import { parseJsonExport } from './parse/parse-json-export';
import { parseSnapshot } from './parse/parse-snapshot';
import { parseTelethonExport } from './parse/parse-telethon-export';

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

const readerOf = Effect.fn('IngestTelegram.readerOf')(function* (exportDir: string) {
    const fs = yield* FileSystem.FileSystem;
    const names = (yield* fs.readDirectory(exportDir)).toSorted();

    return {
        readAll: (pattern: RegExp) =>
            Effect.all(names.filter(name => pattern.test(name)).map(name => fs.readFileString(join(exportDir, name))))
    };
});

const readSnapshot = Effect.fn('IngestTelegram.readSnapshot')(function* (exportDir: string) {
    const { readAll } = yield* readerOf(exportDir);
    const [messages] = yield* readAll(/^messages\.jsonl$/u);

    if (!isDefined(messages)) {
        return Option.none<TelegramSnapshot>();
    }

    const users = yield* readAll(/^users\d*\.json$/u);
    const votes = yield* readAll(/^votes\d*\.jsonl$/u);
    const snapshot = yield* parseSnapshot({ users, messages, votes });

    return Option.fromNullishOr(snapshot);
});

const readTelethonChat = Effect.fn('IngestTelegram.readTelethonChat')(function* (exportDir: string) {
    const { readAll } = yield* readerOf(exportDir);
    const [messages] = yield* readAll(/^messages\.jsonl$/u);

    if (!isNotEmptyString(messages?.trim())) {
        return yield* MissingChatExportError.make({ exportDir });
    }

    const parsed = yield* parseTelethonExport({
        messages,
        users: yield* readAll(/^users.*\.json$/u),
        votes: yield* readAll(/^votes\d*\.jsonl$/u)
    });

    return { messages: parsed.messages, snapshot: Option.fromNullishOr(parsed.snapshot) } satisfies ChatContent;
});

export const readConfig = Effect.fn('IngestTelegram.readConfig')(function* (configPath: string) {
    const fs = yield* FileSystem.FileSystem;
    const raw = yield* fs.readFileString(configPath);

    return yield* Schema.decodeEffect(Schema.fromJsonString(CommunityConfigSchema))(raw);
});

interface ExportContent extends ChatContent {
    readonly config: CommunityConfig;
    readonly fileSha256: string;
    readonly allowRemoval?: boolean;
    readonly otherChats?: readonly ChatContent[];
}

const gamePosts = (config: CommunityConfig, snapshot: Option.Option<TelegramSnapshot>) =>
    Option.match(snapshot, {
        onNone: () => ({}),
        onSome: ({ topicByMessage, pollIdByMessage }) => ({
            pollIdByMessage,
            isGamePost: (messageId: number) => topicByMessage?.get(messageId) === config.gamesTopicId
        })
    });

export const importMessages = Effect.fn('IngestTelegram.importMessages')(function* ({
    config,
    messages,
    fileSha256,
    snapshot,
    allowRemoval,
    otherChats
}: ExportContent) {
    const now = yield* DateTime.nowAsDate;
    const lastSent = messages.findLast(message => isDefined(message.sentAt))?.sentAt ?? now;
    const asOf = instantToLocalDate(lastSent, config.timeZone);

    return yield* withCommunityLock(
        { slug: config.slug },
        Effect.gen(function* () {
            yield* assertKnownChats(config);
            const numbered = [{ messages, snapshot }, ...(otherChats ?? []).map((content, index) => numberPosts(index + 1, content))];
            const [mainChat, ...others] = yield* withoutBotPosts(config, numbered);
            const main = assemblePlan(extractAll(mainChat?.messages ?? [], config, gamePosts(config, snapshot)), asOf);
            const all = planOtherChats({ config, main, snapshot, others, asOf });
            const stats = yield* loadPlan(config, all.plan, {
                fileSha256,
                snapshot: Option.getOrUndefined(all.snapshot),
                allowRemoval
            });

            return { ...stats, review: all.review };
        })
    );
});

interface IngestInput {
    readonly exportDir: string;
    readonly configPath: string;
    readonly allowRemoval: boolean;
    readonly reviewFile?: Option.Option<string>;
}

export const ingest = Effect.fn('IngestTelegram.ingest')(function* ({
    exportDir,
    configPath,
    allowRemoval,
    reviewFile = Option.none()
}: IngestInput) {
    const fs = yield* FileSystem.FileSystem;
    const config = yield* readConfig(configPath);
    const { messages, fileSha256 } = yield* readMessages(exportDir, config);
    const snapshot = yield* readSnapshot(exportDir);
    const otherChats = yield* Effect.all((config.otherChats ?? []).map(chat => readTelethonChat(join(exportDir, chat.exportDir))));
    const { review, ...stats } = yield* importMessages({ config, messages, fileSha256, snapshot, allowRemoval, otherChats });

    yield* Effect.logInfo('Telegram export ingested', { ...stats, review: review.length });

    if (Option.isSome(reviewFile)) {
        const lines = review.map(({ chatId, messageId, localDate }) => `${chatId ?? 'main'}|${messageId}|${localDate}\n`);
        yield* fs.writeFileString(reviewFile.value, lines.join(''), { mode: 0o600 });
        yield* fs.chmod(reviewFile.value, 0o600);
    }

    return stats;
});
