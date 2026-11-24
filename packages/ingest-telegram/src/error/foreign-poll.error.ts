import * as Schema from 'effect/Schema';

export class ForeignPollError extends Schema.TaggedError<ForeignPollError, { readonly brand: unique symbol }>()('ForeignPollError', {
    pollIds: Schema.Array(Schema.String)
}) {
    override get message(): string {
        return `these polls belong to another community: ${this.pollIds.join(', ')}`;
    }
}
