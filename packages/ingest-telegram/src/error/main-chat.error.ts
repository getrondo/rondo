import * as Schema from 'effect/Schema';

export class MainChatError extends Schema.TaggedError<MainChatError, { readonly brand: unique symbol }>()('MainChatError', {
    exportDir: Schema.String
}) {
    override get message(): string {
        return `the chat with the export ${this.exportDir} in otherChats is the main chat or has its folder`;
    }
}
