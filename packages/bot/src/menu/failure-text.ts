import { isDefined } from '@rnw-community/shared';

import { menuText, type MenuKey } from './menu-text';

import type { ActionFailure } from '@rondo/core/error/action-failed.error';
import type { Locale } from '@rondo/core/i18n/locale';

export interface FailureTarget {
    readonly where: string;
    readonly isPrivate: boolean;
}

export interface FailureText {
    readonly text: string;
    readonly uncertain: boolean;
}

const keys: Readonly<Record<ActionFailure['code'], MenuKey>> = {
    answer_too_long: 'reasonAnswerLong',
    approver_merge: 'reasonApproverMerge',
    approver_unreachable: 'reasonApproverUnreachable',
    chat_not_linked: 'reasonChatNotLinked',
    entry_not_found: 'reasonEntryNotFound',
    entry_not_linked: 'reasonEntryNotLinked',
    forward_uncertain: 'uncertainForward',
    game_exists: 'gameExists',
    game_not_started: 'reasonGameNotStarted',
    game_over: 'reasonOver',
    group_off: 'reasonGroupOff',
    host_not_playing: 'reasonHostNotPlaying',
    lineup_changed: 'reasonChanged',
    message_gone: 'reasonMessageGone',
    name_empty: 'reasonNameEmpty',
    nickname_not_found: 'reasonNicknameNotFound',
    nickname_periods: 'reasonNicknamePeriods',
    nickname_rejected: 'reasonNicknameRejected',
    nickname_shared: 'reasonNicknameShared',
    no_approver: 'reasonNoApprover',
    no_group: 'reasonNoGroup',
    no_open_poll: 'reasonNoOpenPoll',
    no_such_time: 'reasonNoSuchTime',
    no_teams: 'reasonNoTeams',
    not_admin: 'reasonNotAdmin',
    not_approved: 'reasonNotApproved',
    not_deletable: 'reasonNotDeletable',
    notice_missed: 'reasonNoticeMissed',
    other_period: 'reasonOtherPeriod',
    person_not_found: 'reasonPersonNotFound',
    place_gone: 'placeGone',
    poll_already_in_chat: 'reasonPollAlreadyInChat',
    poll_empty: 'reasonEmptyQuestion',
    poll_left_open: 'reasonPollLeftOpen',
    poll_not_closed: 'reasonPollOpen',
    poll_open: 'reasonOpenPoll',
    poll_template_invalid: 'reasonTemplate',
    poll_too_long: 'reasonTooLong',
    poll_unsaved_closed: 'reasonPollUnsavedClosed',
    poll_unsaved_open: 'reasonPollUnsavedOpen',
    preview_changed: 'reasonChanged',
    publish_busy: 'reasonPublishBusy',
    records_conflict: 'reasonRecordsConflict',
    result_recorded: 'reasonResultRecorded',
    result_uncertain: 'uncertain',
    same_lineup: 'reasonSameLineup',
    session_not_found: 'reasonSessionNotFound',
    squad_changed: 'reasonChanged',
    team_not_found: 'reasonTeamNotFound',
    teams_unsaved: 'reasonTeamsUnsaved',
    telegram_refused: 'reasonRefused',
    time_passed: 'reasonPast',
    unexpected: 'reasonOther',
    venue_exists: 'reasonVenueExists',
    venue_not_found: 'placeGone',
    venue_unused: 'placeGone',
    votes_uncounted: 'reasonUncounted',
    votes_unseen: 'reasonUnseenVotes'
};

const privateKeys: Partial<typeof keys> = { result_uncertain: 'uncertainMe', telegram_refused: 'reasonRefusedPrivate' };

const plainKeys: Partial<typeof keys> = {
    forward_uncertain: 'uncertainPlain',
    lineup_changed: 'reasonChangedPlain',
    preview_changed: 'reasonChangedPlain',
    result_uncertain: 'uncertainPlain',
    telegram_refused: 'reasonRefusedPlain'
};

export const failureText = (locale: Locale, failure: ActionFailure, target?: FailureTarget): FailureText => {
    const targetKeys = target?.isPrivate === true ? privateKeys : keys;
    const special = isDefined(target) ? targetKeys : plainKeys;
    const text = menuText(locale, special[failure.code] ?? keys[failure.code], { ...failure, where: target?.where ?? '' });
    const uncertain = failure.code === 'result_uncertain' || failure.code === 'forward_uncertain';

    return { text: uncertain ? text : menuText(locale, 'failed', { reason: text }), uncertain };
};
