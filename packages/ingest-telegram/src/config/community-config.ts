import * as Schema from 'effect/Schema';

const VenueConfigSchema = Schema.Struct({
    key: Schema.String,
    name: Schema.String,
    kind: Schema.Literals(['training', 'league', 'tournament', 'social']),
    patterns: Schema.Array(Schema.String),
    district: Schema.optional(Schema.Int),
    lat: Schema.optional(Schema.Finite),
    lng: Schema.optional(Schema.Finite),
    indoor: Schema.optional(Schema.Boolean),
    transit: Schema.optional(Schema.String)
});

const TeamColorConfigSchema = Schema.Struct({
    emoji: Schema.String,
    name: Schema.String
});

const SquadConfigSchema = Schema.Struct({
    name: Schema.String,
    patterns: Schema.Array(Schema.String),
    contextPatterns: Schema.Array(Schema.String)
});

export const defaultGuestPatterns: readonly string[] = [
    '^(?:друг|подруга|friend)\\s+(?<host>.+)$',
    '^(?:новый|новенький|новий|новичок|гость|guest)(?:\\s+(?:человек|игрок|player))?$',
    '^\\+\\.?\\s*(?<count>\\d{1,2})\\s+(?:с|из|from)\\s'
];

export const CommunityConfigSchema = Schema.Struct({
    slug: Schema.String,
    name: Schema.String,
    timeZone: Schema.String,
    organizers: Schema.Array(Schema.String),
    selfAliases: Schema.Array(Schema.String),
    venues: Schema.Array(VenueConfigSchema),
    teamColors: Schema.Array(TeamColorConfigSchema),
    squads: Schema.Array(SquadConfigSchema),
    guestPatterns: Schema.optional(Schema.Array(Schema.String)),
    gamesTopicId: Schema.optional(Schema.Int)
});

export type CommunityConfig = typeof CommunityConfigSchema.Type;
