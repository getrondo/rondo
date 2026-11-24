import * as Schema from 'effect/Schema';

export class TooManyRemovedGamesError extends Schema.TaggedError<TooManyRemovedGamesError, { readonly brand: unique symbol }>()(
    'TooManyRemovedGamesError',
    {
        dates: Schema.Array(Schema.String),
        imported: Schema.Int
    }
) {
    override get message(): string {
        return `the import would remove too many games or squads: ${this.dates.join(', ')}`;
    }
}
