import { TelegramApiError } from '@rondo/telegram/error/telegram-api.error';
import * as Schema from 'effect/Schema';

const ActionFailureSchema = Schema.Union([
    Schema.Struct({
        code: Schema.Literals([
            'approver_merge',
            'approver_unreachable',
            'chat_not_linked',
            'entry_not_found',
            'entry_not_linked',
            'forward_uncertain',
            'game_not_started',
            'game_over',
            'group_off',
            'host_not_playing',
            'lineup_changed',
            'message_gone',
            'name_empty',
            'nickname_not_found',
            'nickname_periods',
            'nickname_rejected',
            'nickname_shared',
            'no_group',
            'no_open_poll',
            'no_such_time',
            'no_teams',
            'no_approver',
            'not_admin',
            'not_approved',
            'not_deletable',
            'other_period',
            'person_not_found',
            'place_gone',
            'poll_already_in_chat',
            'poll_empty',
            'poll_not_closed',
            'poll_left_open',
            'poll_open',
            'poll_template_invalid',
            'poll_unsaved_closed',
            'poll_unsaved_open',
            'preview_changed',
            'publish_busy',
            'records_conflict',
            'result_recorded',
            'result_uncertain',
            'same_lineup',
            'session_not_found',
            'squad_changed',
            'team_not_found',
            'teams_unsaved',
            'telegram_refused',
            'time_passed',
            'unexpected',
            'venue_exists',
            'venue_not_found',
            'venue_unused',
            'votes_uncounted',
            'votes_unseen'
        ])
    }),
    Schema.Struct({ code: Schema.Literal('answer_too_long'), limit: Schema.Int }),
    Schema.Struct({ code: Schema.Literal('game_exists'), sessionId: Schema.String }),
    Schema.Struct({ code: Schema.Literal('notice_missed'), chats: Schema.String, sent: Schema.String }),
    Schema.Struct({ code: Schema.Literal('poll_too_long'), count: Schema.Int, limit: Schema.Int })
]);

export type ActionFailure = typeof ActionFailureSchema.Type;

export class ActionFailedError extends Schema.TaggedError<ActionFailedError, { readonly brand: unique symbol }>()('ActionFailedError', {
    failure: ActionFailureSchema
}) {
    override get message(): string {
        return JSON.stringify(this.failure);
    }
}

export const failureOf = (error: unknown): ActionFailure => {
    if (Schema.is(TelegramApiError)(error)) {
        return error.isUncertain ? { code: 'result_uncertain' } : { code: 'telegram_refused' };
    }

    return Schema.is(ActionFailedError)(error) ? error.failure : { code: 'unexpected' };
};
