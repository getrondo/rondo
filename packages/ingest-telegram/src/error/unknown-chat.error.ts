import * as Schema from 'effect/Schema';

export class UnknownChatError extends Schema.TaggedError<UnknownChatError, { readonly brand: unique symbol }>()('UnknownChatError', {
    chatIds: Schema.Array(Schema.Int)
}) {
    override get message(): string {
        return `posts of these chats are stored, but the config does not list them in otherChats: ${this.chatIds.join(', ')}`;
    }
}
