import * as Schema from 'effect/Schema';

export class LiveCommunityError extends Schema.TaggedError<LiveCommunityError, { readonly brand: unique symbol }>()('LiveCommunityError', {
    since: Schema.String,
    dates: Schema.Array(Schema.String)
}) {
    override get message(): string {
        const late = this.dates.length;

        return late > 0
            ? `the bot records games itself since ${this.since}, export only older messages, refused: ${this.dates.join(', ')}`
            : `the bot records games itself since ${this.since}, set RONDO_ACKNOWLEDGE_LIVE=true to import older games again`;
    }
}
