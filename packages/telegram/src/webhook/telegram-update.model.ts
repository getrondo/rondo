import * as Schema from 'effect/Schema';

const TelegramUserSchema = Schema.Struct({
    id: Schema.Int,
    is_bot: Schema.Boolean,
    first_name: Schema.String,
    last_name: Schema.optionalKey(Schema.String),
    username: Schema.optionalKey(Schema.String),
    language_code: Schema.optionalKey(Schema.String)
});

const ChatSchema = Schema.Struct({
    id: Schema.Int,
    type: Schema.String,
    title: Schema.optionalKey(Schema.String)
});

const LocationSchema = Schema.Struct({ latitude: Schema.Finite, longitude: Schema.Finite });

const MessageSchema = Schema.Struct({
    message_id: Schema.Int,
    date: Schema.Int,
    chat: ChatSchema,
    from: Schema.optionalKey(TelegramUserSchema),
    text: Schema.optionalKey(Schema.String),
    caption: Schema.optionalKey(Schema.String),
    message_thread_id: Schema.optionalKey(Schema.Int),
    is_topic_message: Schema.optionalKey(Schema.Boolean),
    migrate_to_chat_id: Schema.optionalKey(Schema.Int),
    new_chat_members: Schema.optionalKey(Schema.Array(TelegramUserSchema)),
    left_chat_member: Schema.optionalKey(TelegramUserSchema),
    location: Schema.optionalKey(LocationSchema),
    venue: Schema.optionalKey(Schema.Struct({ title: Schema.String, address: Schema.String, location: LocationSchema })),
    poll: Schema.optionalKey(
        Schema.Struct({
            id: Schema.String,
            question: Schema.String,
            options: Schema.Array(Schema.Struct({ text: Schema.String }))
        })
    ),
    forward_origin: Schema.optionalKey(Schema.Struct({ sender_user: Schema.optionalKey(TelegramUserSchema) }))
});

const PollAnswerSchema = Schema.Struct({
    poll_id: Schema.String,
    user: Schema.optionalKey(TelegramUserSchema),
    option_ids: Schema.Array(Schema.Int)
});

const ChatMemberSchema = Schema.Struct({
    status: Schema.String,
    user: TelegramUserSchema,
    is_member: Schema.optionalKey(Schema.Boolean)
});

const ChatMemberUpdatedSchema = Schema.Struct({ chat: ChatSchema, new_chat_member: ChatMemberSchema });

const CallbackQuerySchema = Schema.Struct({
    id: Schema.String,
    from: TelegramUserSchema,
    data: Schema.optionalKey(Schema.String),
    message: Schema.optionalKey(Schema.Struct({ message_id: Schema.Int, chat: ChatSchema }))
});

export const TelegramUpdateSchema = Schema.Union([
    Schema.Struct({ update_id: Schema.Int, message: MessageSchema }),
    Schema.Struct({ update_id: Schema.Int, poll_answer: PollAnswerSchema }),
    Schema.Struct({ update_id: Schema.Int, chat_member: ChatMemberUpdatedSchema }),
    Schema.Struct({ update_id: Schema.Int, callback_query: CallbackQuerySchema })
]);

export type TelegramUpdate = typeof TelegramUpdateSchema.Type;
export type User = typeof TelegramUserSchema.Type;
export type Message = typeof MessageSchema.Type;
export type PollAnswer = typeof PollAnswerSchema.Type;
export type ChatMember = typeof ChatMemberSchema.Type;
export type ChatMemberUpdated = typeof ChatMemberUpdatedSchema.Type;
export type CallbackQuery = typeof CallbackQuerySchema.Type;
