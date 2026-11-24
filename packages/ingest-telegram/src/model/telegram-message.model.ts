import * as Schema from 'effect/Schema';

const PollSchema = Schema.Struct({
    question: Schema.String,
    answers: Schema.Array(Schema.String),
    voters: Schema.optional(Schema.Array(Schema.Int))
});

const MediaKindSchema = Schema.Literals(['photo', 'video', 'voice', 'sticker', 'gif', 'file']);

const TelegramMessageSchema = Schema.Struct({
    id: Schema.Int,
    kind: Schema.Literals(['message', 'service']),
    sentAt: Schema.optional(Schema.Date),
    author: Schema.optional(Schema.String),
    authorId: Schema.optional(Schema.Int),
    mentions: Schema.optional(
        Schema.Array(Schema.Struct({ offset: Schema.Int, text: Schema.String, userId: Schema.optional(Schema.Int) }))
    ),
    location: Schema.optional(Schema.Struct({ lat: Schema.Finite, lng: Schema.Finite })),
    replyTo: Schema.optional(Schema.Int),
    forwardedFrom: Schema.optional(Schema.String),
    text: Schema.optional(Schema.String),
    poll: Schema.optional(PollSchema),
    media: Schema.Array(MediaKindSchema)
});

export type TelegramMessage = typeof TelegramMessageSchema.Type;
