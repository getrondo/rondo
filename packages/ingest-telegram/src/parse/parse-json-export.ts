import { isDefined, isNotEmptyString, isString } from '@rnw-community/shared';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

import type { TelegramMessage } from '../model/telegram-message.model';

const TextPartSchema = Schema.Struct({ type: Schema.String, text: Schema.String, user_id: Schema.optional(Schema.Int) });
const TextSchema = Schema.Union([Schema.String, Schema.Array(Schema.Union([Schema.String, TextPartSchema]))]);

const ExportMessageSchema = Schema.Struct({
    id: Schema.Int,
    type: Schema.Literals(['message', 'service']),
    date_unixtime: Schema.String,
    from: Schema.optional(Schema.NullOr(Schema.String)),
    from_id: Schema.optional(Schema.NullOr(Schema.String)),
    forwarded_from: Schema.optional(Schema.NullOr(Schema.String)),
    forwarded_from_id: Schema.optional(Schema.NullOr(Schema.String)),
    reply_to_message_id: Schema.optional(Schema.Int),
    text: Schema.optional(TextSchema),
    poll: Schema.optional(
        Schema.Struct({ question: TextSchema, answers: Schema.Array(Schema.Struct({ text: TextSchema, voters: Schema.Int })) })
    ),
    location_information: Schema.optional(Schema.Struct({ latitude: Schema.Finite, longitude: Schema.Finite }))
});

const ChatSchema = Schema.Struct({ id: Schema.optional(Schema.Int) });
const ExportSchema = Schema.Struct({ messages: Schema.Array(ExportMessageSchema) });

const plainText = (value: typeof TextSchema.Type): string =>
    isString(value) ? value : value.map(part => (isString(part) ? part : part.text)).join('');

const mentionsOf = (value: typeof TextSchema.Type): NonNullable<TelegramMessage['mentions']> => {
    if (isString(value)) {
        return [];
    }

    let offset = 0;

    return value.flatMap(part => {
        const text = isString(part) ? part : part.text;
        const start = offset;
        offset += text.length;

        if (isString(part) || !['mention', 'mention_name'].includes(part.type)) {
            return [];
        }

        return [{ offset: start, text, ...(isDefined(part.user_id) ? { userId: part.user_id } : {}) }];
    });
};

const userIdOf = (fromId: string | null | undefined): Option.Option<number> =>
    Option.fromNullishOr(/^user(\d+)$/u.exec(fromId ?? '')?.[1]).pipe(Option.map(Number));

const toMessage = (raw: typeof ExportMessageSchema.Type): TelegramMessage => {
    const authorId = Option.getOrNull(userIdOf(raw.from_id));
    const forwardedFromId = Option.getOrNull(userIdOf(raw.forwarded_from_id));

    return {
        id: raw.id,
        kind: raw.type,
        sentAt: DateTime.toDate(DateTime.makeUnsafe(Number(raw.date_unixtime) * 1000)),
        text: plainText(raw.text ?? ''),
        mentions: mentionsOf(raw.text ?? ''),
        media: [],
        ...(isNotEmptyString(raw.from) ? { author: raw.from } : {}),
        ...(isDefined(authorId) ? { authorId } : {}),
        ...(isNotEmptyString(raw.forwarded_from) ? { forwardedFrom: raw.forwarded_from } : {}),
        ...(isDefined(forwardedFromId) ? { forwardedFromId } : {}),
        ...(isDefined(raw.reply_to_message_id) ? { replyTo: raw.reply_to_message_id } : {}),
        ...(isDefined(raw.poll)
            ? {
                  poll: {
                      question: plainText(raw.poll.question),
                      answers: raw.poll.answers.map(answer => plainText(answer.text)),
                      voters: raw.poll.answers.map(answer => answer.voters)
                  }
              }
            : {}),
        ...(isDefined(raw.location_information)
            ? { location: { lat: raw.location_information.latitude, lng: raw.location_information.longitude } }
            : {})
    };
};

export const parseJsonExport = Effect.fn('IngestTelegram.parseJsonExport')(function* (json: string) {
    const decoded = yield* Schema.decodeEffect(Schema.fromJsonString(ExportSchema))(json);

    return decoded.messages.map(raw => toMessage(raw));
});

export const parseChatId = Effect.fn('IngestTelegram.parseChatId')(function* (json: string) {
    const { id } = yield* Schema.decodeEffect(Schema.fromJsonString(ChatSchema))(json);

    return Option.fromNullishOr(id);
});
