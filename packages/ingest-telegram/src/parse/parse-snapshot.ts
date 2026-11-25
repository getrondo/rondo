import { isDefined, isNotEmptyString } from '@rnw-community/shared';
import { answerChoice } from '@rondo/core/extract/poll-answers';
import {
    SnapshotMessageSchema,
    SnapshotUserSchema,
    SnapshotVotesSchema,
    type SnapshotUser,
    type SnapshotVote,
    type TelegramSnapshot,
    type VoteChoice
} from '@rondo/core/model/telegram-snapshot.model';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';

interface SnapshotFiles {
    readonly users: readonly string[];
    readonly messages: string;
    readonly votes: readonly string[];
}

type Answers = NonNullable<(typeof SnapshotMessageSchema.Type)['poll']>['answers'];

export const voteChoice = (answers: Answers, options: readonly string[]): VoteChoice => {
    const choices = new Set(
        options.map(option =>
            answerChoice(
                answers.map(answer => answer.text),
                answers.findIndex(answer => answer.option === option)
            )
        )
    );

    if (choices.has('yes')) {
        return 'yes';
    }

    return choices.has('other') ? 'other' : 'no';
};

export const linesOf = (file: string): string[] => file.split('\n').filter(line => isNotEmptyString(line.trim()));

const quotePollId = (line: string): string => line.replace(/"poll"\s*:\s*\{\s*"id"\s*:\s*(\d+)/u, '"poll":{"id":"$1"');

export const mergeUsers = (users: readonly SnapshotUser[]): Map<number, SnapshotUser> => {
    const merged = new Map<number, SnapshotUser>();

    for (const user of users) {
        const known = merged.get(user.id);
        merged.set(
            user.id,
            isDefined(known)
                ? {
                      ...known,
                      first: known.first ?? user.first,
                      last: known.last ?? user.last,
                      username: known.username ?? user.username,
                      deleted: known.deleted || user.deleted,
                      member: known.member || user.member
                  }
                : user
        );
    }

    return merged;
};

export const decodeUsers = Schema.decodeEffect(Schema.fromJsonString(Schema.Array(SnapshotUserSchema)));
const decodeMessage = Schema.decodeEffect(Schema.fromJsonString(SnapshotMessageSchema));
const decodeVotes = Schema.decodeEffect(Schema.fromJsonString(SnapshotVotesSchema));

export const parseSnapshot = Effect.fn('IngestTelegram.parseSnapshot')(function* (files: SnapshotFiles) {
    const users = yield* Effect.all(files.users.map(file => decodeUsers(file)));
    const messages = yield* Effect.all(linesOf(files.messages).map(line => decodeMessage(quotePollId(line))));
    const ballots = yield* Effect.all(files.votes.flatMap(file => linesOf(file)).map(line => decodeVotes(line)));
    const pollByMessage = new Map(messages.flatMap(({ id, poll }) => (isDefined(poll) ? [[id, poll] as const] : [])));
    const votes = new Map<string, SnapshotVote>();

    for (const { message, votes: cast } of ballots) {
        const poll = pollByMessage.get(message);

        if (isDefined(poll)) {
            for (const { peer, options, date } of cast) {
                votes.set(`${poll.id}|${peer.user}`, {
                    pollId: poll.id,
                    userId: peer.user,
                    choice: voteChoice(poll.answers, options),
                    votedAt: date
                });
            }
        }
    }

    return {
        users: mergeUsers(users.flat()),
        pollIdByMessage: new Map([...pollByMessage].map(([messageId, poll]) => [messageId, poll.id])),
        topicByMessage: new Map(messages.flatMap(({ id, topic }) => (isDefined(topic) ? [[id, topic] as const] : []))),
        votes: [...votes.values()]
    } satisfies TelegramSnapshot;
});
