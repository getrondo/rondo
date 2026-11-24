import * as Schema from 'effect/Schema';

export const SnapshotUserSchema = Schema.Struct({
    id: Schema.Int,
    first: Schema.NullOr(Schema.String),
    last: Schema.NullOr(Schema.String),
    username: Schema.NullOr(Schema.String),
    bot: Schema.Boolean,
    deleted: Schema.Boolean,
    member: Schema.Boolean
});

export const SnapshotMessageSchema = Schema.Struct({
    id: Schema.Int,
    poll: Schema.optional(
        Schema.Struct({ id: Schema.String, answers: Schema.Array(Schema.Struct({ option: Schema.String, text: Schema.String })) })
    )
});

export const SnapshotVotesSchema = Schema.Struct({
    message: Schema.Int,
    votes: Schema.Array(
        Schema.Struct({
            peer: Schema.Struct({ user: Schema.Int }),
            options: Schema.Array(Schema.String),
            date: Schema.DateFromString
        })
    )
});

export type SnapshotUser = typeof SnapshotUserSchema.Type;

export type VoteChoice = 'yes' | 'no' | 'other';

export interface SnapshotVote {
    readonly pollId: string;
    readonly userId: number;
    readonly choice: VoteChoice;
    readonly votedAt: Date;
}

export interface TelegramSnapshot {
    readonly users: ReadonlyMap<number, SnapshotUser>;
    readonly pollIdByMessage: ReadonlyMap<number, string>;
    readonly votes: readonly SnapshotVote[];
}
