import * as Schema from 'effect/Schema';

const LocalDate = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u));
const LocalTime = Schema.String.check(Schema.isPattern(/^\d{2}:\d{2}$/u));
const CancelReason = Schema.Literals(['weather', 'low_turnout', 'venue', 'holiday', 'organizer', 'other']);

const TeamPlayer = Schema.Struct({ personId: Schema.String, displayName: Schema.String, strength: Schema.Finite, isGk: Schema.Boolean });
const Team = Schema.Struct({ ordinal: Schema.Int, players: Schema.Array(TeamPlayer), strength: Schema.Finite });

const CreateSessionAction = Schema.TaggedStruct('create_session', {
    localDate: LocalDate,
    localTime: LocalTime,
    venueId: Schema.NullOr(Schema.String),
    capacityMax: Schema.NullOr(Schema.Int),
    title: Schema.NullOr(Schema.String),
    announce: Schema.Boolean
});

const UpdateSessionAction = Schema.TaggedStruct('update_session', {
    sessionId: Schema.String,
    localDate: Schema.optional(LocalDate),
    localTime: Schema.optional(LocalTime),
    venueId: Schema.optional(Schema.NullOr(Schema.String)),
    capacityMax: Schema.optional(Schema.NullOr(Schema.Int)),
    notify: Schema.Boolean
});

const CancelSessionAction = Schema.TaggedStruct('cancel_session', {
    sessionId: Schema.String,
    reason: CancelReason,
    notify: Schema.Boolean
});

const AnnounceSessionAction = Schema.TaggedStruct('announce_session', { sessionId: Schema.String });

const PublishTeamsAction = Schema.TaggedStruct('publish_teams', { sessionId: Schema.String, teams: Schema.Array(Team) });

const MergePeopleAction = Schema.TaggedStruct('merge_people', { fromPersonId: Schema.String, intoPersonId: Schema.String });

const RenamePersonAction = Schema.TaggedStruct('rename_person', { personId: Schema.String, displayName: Schema.String });

const GrantAdminAction = Schema.TaggedStruct('grant_admin', { personId: Schema.String });

const SetRatingAction = Schema.TaggedStruct('set_rating', {
    personId: Schema.String,
    level: Schema.Finite.check(Schema.isBetween({ minimum: 1, maximum: 10 }))
});

const CreatePersonAction = Schema.TaggedStruct('create_person', { displayName: Schema.NonEmptyString });

const venueDetails = {
    address: Schema.optional(Schema.NullOr(Schema.String)),
    district: Schema.optional(Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 23 })))),
    indoor: Schema.optional(Schema.NullOr(Schema.Boolean))
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
    PublishTeamsAction,
    MergePeopleAction,
    RenamePersonAction,
    GrantAdminAction,
    SetRatingAction,
    CreatePersonAction,
    CreateVenueAction,
    UpdateVenueAction
]);

export type Action = typeof ActionSchema.Type;
