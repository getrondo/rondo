import * as Schema from 'effect/Schema';

const PollSchema = Schema.Struct({
    question: Schema.String,
    answers: Schema.Array(Schema.String)
});

const LocationSchema = Schema.Struct({
    lat: Schema.Finite,
    lng: Schema.Finite
});

const MediaKindSchema = Schema.Literals(['photo', 'video', 'voice', 'sticker', 'gif', 'file']);

const TelegramMessageSchema = Schema.Struct({
    id: Schema.Int,
    kind: Schema.Literals(['message', 'service']),
    sentAt: Schema.optional(Schema.Date),
    author: Schema.optional(Schema.String),
    replyTo: Schema.optional(Schema.Int),
    forwardedFrom: Schema.optional(Schema.String),
    text: Schema.optional(Schema.String),
    poll: Schema.optional(PollSchema),
    location: Schema.optional(LocationSchema),
    media: Schema.Array(MediaKindSchema)
});

export type TelegramMessage = typeof TelegramMessageSchema.Type;
