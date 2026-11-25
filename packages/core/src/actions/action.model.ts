import * as Schema from 'effect/Schema';

const LocalDate = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u));
const LocalTime = Schema.String.check(Schema.isPattern(/^\d{2}:\d{2}$/u));
const FieldCount = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 9 }));
const CancelReason = Schema.Literals(['weather', 'low_turnout', 'venue', 'holiday', 'organizer', 'other']);

const TeamPlayer = Schema.Struct({ personId: Schema.String, displayName: Schema.String, strength: Schema.Finite, isGk: Schema.Boolean });
const Team = Schema.Struct({ ordinal: Schema.Int, players: Schema.Array(TeamPlayer), strength: Schema.Finite });

const NoticeTarget = Schema.Struct({ chatId: Schema.String, topicId: Schema.NullOr(Schema.Int) });

const NoticePreview = Schema.Struct({ html: Schema.String, targets: Schema.Array(NoticeTarget) });

const CreateSessionAction = Schema.TaggedStruct('create_session', {
    localDate: LocalDate,
    localTime: LocalTime,
    venueId: Schema.NullOr(Schema.String),
    capacityMax: Schema.NullOr(Schema.Int),
    fieldsPlanned: Schema.optional(Schema.NullOr(FieldCount)),
    title: Schema.NullOr(Schema.String),
    note: Schema.optional(Schema.NullOr(Schema.String)),
    announce: Schema.Boolean,
    chatId: Schema.optional(Schema.String),
    topicId: Schema.optional(Schema.NullOr(Schema.Int))
});

const UpdateSessionAction = Schema.TaggedStruct('update_session', {
    sessionId: Schema.String,
    localDate: Schema.optional(LocalDate),
    localTime: Schema.optional(LocalTime),
    venueId: Schema.optional(Schema.NullOr(Schema.String)),
    capacityMax: Schema.optional(Schema.NullOr(Schema.Int)),
    fieldsPlanned: Schema.optional(Schema.NullOr(FieldCount)),
    notify: Schema.Boolean,
    preview: Schema.optional(NoticePreview)
});

const CancelSessionAction = Schema.TaggedStruct('cancel_session', {
    sessionId: Schema.String,
    reason: CancelReason,
    notify: Schema.Boolean,
    preview: Schema.optional(NoticePreview)
});

const AnnounceSessionAction = Schema.TaggedStruct('announce_session', {
    sessionId: Schema.String,
    note: Schema.optional(Schema.NullOr(Schema.String)),
    chatId: Schema.optional(Schema.String),
    topicId: Schema.optional(Schema.NullOr(Schema.Int))
});

const DeleteSessionAction = Schema.TaggedStruct('delete_session', { sessionId: Schema.String });

const ForwardPollAction = Schema.TaggedStruct('forward_poll', {
    sessionId: Schema.String,
    chatId: Schema.String,
    topicId: Schema.optional(Schema.NullOr(Schema.Int)),
    resend: Schema.optional(Schema.Int)
});

const PublishTeamsAction = Schema.TaggedStruct('publish_teams', {
    sessionId: Schema.String,
    teams: Schema.Array(Team),
    preview: Schema.optional(NoticePreview)
});

const MergePeopleAction = Schema.TaggedStruct('merge_people', { fromPersonId: Schema.String, intoPersonId: Schema.String });

const LinkAliasAction = Schema.TaggedStruct('link_alias', { aliasId: Schema.String, personId: Schema.String });

const UnlinkAliasAction = Schema.TaggedStruct('unlink_alias', { aliasId: Schema.String });

const RenamePersonAction = Schema.TaggedStruct('rename_person', { personId: Schema.String, displayName: Schema.String });

const GrantAdminAction = Schema.TaggedStruct('grant_admin', { personId: Schema.String });

const SetRatingAction = Schema.TaggedStruct('set_rating', {
    personId: Schema.String,
    level: Schema.Finite.check(Schema.isBetween({ minimum: 1, maximum: 10 }))
});

const CreatePersonAction = Schema.TaggedStruct('create_person', { displayName: Schema.NonEmptyString });

const venueDetails = {
    shortName: Schema.optional(Schema.NonEmptyString),
    station: Schema.optional(Schema.NonEmptyString),
    address: Schema.optional(Schema.String),
    district: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 23 }))),
    indoor: Schema.optional(Schema.Boolean)
};

const CreateVenueAction = Schema.TaggedStruct('create_venue', {
    name: Schema.NonEmptyString,
    sessionId: Schema.optional(Schema.NullOr(Schema.String)),
    ...venueDetails
});

const UpdateVenueAction = Schema.TaggedStruct('update_venue', {
    venueId: Schema.String,
    name: Schema.optional(Schema.NonEmptyString),
    alias: Schema.optional(Schema.NonEmptyString),
    active: Schema.optional(Schema.Boolean),
    ...venueDetails
});

export const ActionSchema = Schema.Union([
    CreateSessionAction,
    UpdateSessionAction,
    CancelSessionAction,
    AnnounceSessionAction,
    ForwardPollAction,
    DeleteSessionAction,
    PublishTeamsAction,
    MergePeopleAction,
    LinkAliasAction,
    UnlinkAliasAction,
    RenamePersonAction,
    GrantAdminAction,
    SetRatingAction,
    CreatePersonAction,
    CreateVenueAction,
    UpdateVenueAction
]);

export type Action = typeof ActionSchema.Type;
