import * as Schema from 'effect/Schema';

export class MissingChatExportError extends Schema.TaggedError<MissingChatExportError, { readonly brand: unique symbol }>()(
    'MissingChatExportError',
    { exportDir: Schema.String }
) {
    override get message(): string {
        return `a configured chat has no messages.jsonl, or an empty one, in ${this.exportDir}`;
    }
}
