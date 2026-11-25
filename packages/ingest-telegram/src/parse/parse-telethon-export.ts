import { isDefined, isNotEmptyString } from '@rnw-community/shared';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';

import { decodeUsers, linesOf, mergeUsers, voteChoice } from './parse-snapshot';

import type { TelegramMessage } from '@rondo/core/model/telegram-message.model';
import type { SnapshotUser, SnapshotVote, TelegramSnapshot } from '@rondo/core/model/telegram-snapshot.model';

interface TelethonFiles {
    readonly users: readonly string[];
    readonly messages: string;
    readonly votes: readonly string[];
}

const TextSchema = Schema.Struct({ text: Schema.String });
const PollSchema = Schema.Struct({
    id: Schema.String,
    question: TextSchema,
    answers: Schema.Array(Schema.Struct({ text: TextSchema, option: Schema.String }))
});
const MessageSchema = Schema.Struct({
    _: Schema.String,
    id: Schema.Int,
    date: Schema.DateFromString,
    message: Schema.optional(Schema.NullOr(Schema.String)),
    from_id: Schema.optional(Schema.NullOr(Schema.Struct({ user_id: Schema.optional(Schema.Int) }))),
    fwd_from: Schema.optional(
        Schema.NullOr(Schema.Struct({ from_id: Schema.optional(Schema.NullOr(Schema.Struct({ user_id: Schema.optional(Schema.Int) }))) }))
    ),
    reply_to: Schema.optional(Schema.NullOr(Schema.Struct({ reply_to_msg_id: Schema.optional(Schema.NullOr(Schema.Int)) }))),
    entities: Schema.optional(
        Schema.NullOr(
            Schema.Array(Schema.Struct({ _: Schema.String, offset: Schema.Int, length: Schema.Int, user_id: Schema.optional(Schema.Int) }))
        )
    ),
    media: Schema.optional(Schema.NullOr(Schema.Struct({ poll: Schema.optional(PollSchema) })))
});
const VotesSchema = Schema.Struct({
    msg: Schema.Int,
    votes: Schema.Array(Schema.Struct({ peer: Schema.Int, options: Schema.Array(Schema.String), date: Schema.DateFromString }))
});

type Message = typeof MessageSchema.Type;

const decodeMessage = Schema.decodeEffect(Schema.fromJsonString(MessageSchema));
const decodeVotes = Schema.decodeEffect(Schema.fromJsonString(VotesSchema));

const mentionTypes = new Set(['MessageEntityMention', 'MessageEntityMentionName']);

const quotePollId = (line: string): string => line.replace(/("_"\s*:\s*"Poll"\s*,\s*"id"\s*:\s*)(\d+)/u, '$1"$2"');

const answersOf = (poll: typeof PollSchema.Type) =>
    poll.answers.map(({ text, option }) => ({ text: text.text, option: Buffer.from(option, 'base64').toString('hex') }));

const nameOf = (user: SnapshotUser | undefined): string => [user?.first, user?.last].filter(part => isNotEmptyString(part)).join(' ');

const toMessage = (
    raw: Message,
    users: ReadonlyMap<number, SnapshotUser>,
    votersOf: (messageId: number, option: string) => number
): TelegramMessage => {
    const text = raw.message ?? '';
    const authorId = raw.from_id?.user_id;
    const forwardedFromId = raw.fwd_from?.from_id?.user_id;
    const replyTo = raw.reply_to?.reply_to_msg_id;
    const author = nameOf(users.get(authorId ?? 0));
    const poll = raw.media?.poll;

    return {
        id: raw.id,
        kind: raw._ === 'Message' ? 'message' : 'service',
        sentAt: raw.date,
        text,
        mentions: (raw.entities ?? [])
            .filter(entity => mentionTypes.has(entity._))
            .map(({ offset, length, user_id: userId }) => {
                const mention = { offset, text: text.slice(offset, offset + length) };

                return isDefined(userId) ? Object.assign(mention, { userId }) : mention;
            }),
        media: [],
        ...(isNotEmptyString(author) ? { author } : {}),
        ...(isDefined(authorId) ? { authorId } : {}),
        ...(isDefined(raw.fwd_from) ? { forwardedFrom: 'forward' } : {}),
        ...(isDefined(forwardedFromId) ? { forwardedFromId } : {}),
        ...(isDefined(replyTo) ? { replyTo } : {}),
        ...(isDefined(poll)
            ? {
                  poll: {
                      question: poll.question.text,
                      answers: poll.answers.map(answer => answer.text.text),
                      voters: answersOf(poll).map(({ option }) => votersOf(raw.id, option))
                  }
              }
            : {})
    };
};

export const parseTelethonExport = Effect.fn('IngestTelegram.parseTelethonExport')(function* (files: TelethonFiles) {
    const users = mergeUsers((yield* Effect.all(files.users.map(file => decodeUsers(file)))).flat());
    const raw = yield* Effect.all(linesOf(files.messages).map(line => decodeMessage(quotePollId(line))));
    const ballots = yield* Effect.all(files.votes.flatMap(file => linesOf(file)).map(line => decodeVotes(line)));
    const castByMessage = new Map(ballots.map(({ msg, votes }) => [msg, votes]));
    const votersOf = (messageId: number, option: string): number =>
        (castByMessage.get(messageId) ?? []).filter(({ options }) => options.includes(option)).length;
    const polls = raw.flatMap(({ id, media }) => (isDefined(media?.poll) ? [{ messageId: id, poll: media.poll }] : []));
    const votes = new Map<string, SnapshotVote>();

    for (const { messageId, poll } of polls) {
        for (const { peer, options, date } of castByMessage.get(messageId) ?? []) {
            votes.set(`${poll.id}|${peer}`, {
                pollId: poll.id,
                userId: peer,
                choice: voteChoice(answersOf(poll), options),
                votedAt: date
            });
        }
    }

    return {
        messages: raw.map(message => toMessage(message, users, votersOf)),
        snapshot: {
            users,
            pollIdByMessage: new Map(polls.map(({ messageId, poll }) => [messageId, poll.id])),
            votes: [...votes.values()]
        } satisfies TelegramSnapshot
    };
});
