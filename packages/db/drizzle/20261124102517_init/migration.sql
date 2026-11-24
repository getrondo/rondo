CREATE SCHEMA "community";
--> statement-breakpoint
CREATE SCHEMA "feedback_private";
--> statement-breakpoint
CREATE SCHEMA "feedback";
--> statement-breakpoint
CREATE SCHEMA "finance";
--> statement-breakpoint
CREATE SCHEMA "identity";
--> statement-breakpoint
CREATE SCHEMA "league";
--> statement-breakpoint
CREATE SCHEMA "org";
--> statement-breakpoint
CREATE SCHEMA "audit";
--> statement-breakpoint
CREATE SCHEMA "comms";
--> statement-breakpoint
CREATE SCHEMA "ingest";
--> statement-breakpoint
CREATE SCHEMA "play";
--> statement-breakpoint
CREATE SCHEMA "play_private";
--> statement-breakpoint
CREATE SCHEMA "scheduling";
--> statement-breakpoint
CREATE SCHEMA "venue";
--> statement-breakpoint
CREATE TYPE "community"."ad_status" AS ENUM('pending', 'approved', 'rejected', 'posted');--> statement-breakpoint
CREATE TYPE "community"."equipment_kind" AS ENUM('bib_set', 'ball', 'pump', 'goal', 'other');--> statement-breakpoint
CREATE TYPE "community"."event_kind" AS ENUM('bbq', 'watch_party', 'trip', 'ceremony', 'other');--> statement-breakpoint
CREATE TYPE "community"."lost_item_status" AS ENUM('found', 'claimed', 'discarded');--> statement-breakpoint
CREATE TYPE "feedback"."incident_kind" AS ENUM('conduct', 'injury', 'safety', 'venue', 'other');--> statement-breakpoint
CREATE TYPE "feedback"."incident_status" AS ENUM('open', 'reviewing', 'closed');--> statement-breakpoint
CREATE TYPE "finance"."account_kind" AS ENUM('player_receivable', 'cash_box', 'organizer_bank', 'venue_payable', 'income', 'expense', 'prize_fund');--> statement-breakpoint
CREATE TYPE "finance"."payment_method" AS ENUM('cash', 'sepa', 'other');--> statement-breakpoint
CREATE TYPE "finance"."price_applies_to" AS ENUM('field', 'gk', 'guest', 'hall_of_fame');--> statement-breakpoint
CREATE TYPE "finance"."price_scope" AS ENUM('community', 'activity', 'series', 'venue', 'session');--> statement-breakpoint
CREATE TYPE "finance"."txn_kind" AS ENUM('session_fee', 'late_cancel_fee', 'no_show_fee', 'payment', 'venue_cost', 'event_split', 'prize', 'adjustment');--> statement-breakpoint
CREATE TYPE "identity"."alias_kind" AS ENUM('nickname', 'first_name', 'full_name', 'placeholder', 'self');--> statement-breakpoint
CREATE TYPE "identity"."alias_resolution" AS ENUM('unresolved', 'suggested', 'confirmed', 'guest', 'ignored');--> statement-breakpoint
CREATE TYPE "identity"."consent_purpose" AS ENUM('processing', 'birthday', 'stats_public', 'dm_notifications');--> statement-breakpoint
CREATE TYPE "identity"."locale" AS ENUM('uk', 'ru', 'en', 'de');--> statement-breakpoint
CREATE TYPE "identity"."record_source" AS ENUM('bot', 'import', 'manual');--> statement-breakpoint
CREATE TYPE "league"."availability" AS ENUM('available', 'maybe', 'unavailable');--> statement-breakpoint
CREATE TYPE "league"."award_kind" AS ENUM('mvp', 'top_scorer', 'best_gk', 'iron_man', 'best_newcomer', 'hall_of_fame', 'other');--> statement-breakpoint
CREATE TYPE "league"."competition_kind" AS ENUM('league', 'cup', 'tournament', 'friendly');--> statement-breakpoint
CREATE TYPE "league"."fixture_event_kind" AS ENUM('goal', 'assist', 'yellow', 'red', 'motm');--> statement-breakpoint
CREATE TYPE "league"."fixture_status" AS ENUM('scheduled', 'played', 'postponed', 'forfeit', 'cancelled');--> statement-breakpoint
CREATE TYPE "org"."chat_kind" AS ENUM('group', 'supergroup', 'channel', 'private');--> statement-breakpoint
CREATE TYPE "org"."chat_purpose" AS ENUM('main', 'activity', 'squad', 'staff');--> statement-breakpoint
CREATE TYPE "org"."foot" AS ENUM('left', 'right', 'both');--> statement-breakpoint
CREATE TYPE "org"."membership_status" AS ENUM('active', 'left', 'removed');--> statement-breakpoint
CREATE TYPE "org"."notify_level" AS ENUM('all', 'reminders', 'none');--> statement-breakpoint
CREATE TYPE "org"."position" AS ENUM('gk', 'def', 'mid', 'fwd', 'any');--> statement-breakpoint
CREATE TYPE "org"."role" AS ENUM('owner', 'organizer', 'helper', 'scorekeeper', 'manager');--> statement-breakpoint
CREATE TYPE "org"."scope_type" AS ENUM('community', 'activity', 'squad', 'session');--> statement-breakpoint
CREATE TYPE "org"."sport" AS ENUM('football', 'futsal', 'basketball', 'volleyball', 'beach_volleyball', 'table_tennis', 'boxing', 'other');--> statement-breakpoint
CREATE TYPE "audit"."actor_kind" AS ENUM('user', 'bot', 'system');--> statement-breakpoint
CREATE TYPE "comms"."channel" AS ENUM('dm', 'group');--> statement-breakpoint
CREATE TYPE "ingest"."ingest_source" AS ENUM('telegram_html', 'telegram_json');--> statement-breakpoint
CREATE TYPE "comms"."message_purpose" AS ENUM('game_card', 'lineup', 'announcement', 'reminder', 'poll');--> statement-breakpoint
CREATE TYPE "ingest"."source_ref_kind" AS ENUM('poll', 'lineup', 'cancel', 'result', 'price', 'service', 'message');--> statement-breakpoint
CREATE TYPE "play"."assigned_by" AS ENUM('organizer', 'balancer', 'captain_pick', 'import');--> statement-breakpoint
CREATE TYPE "play"."match_event_kind" AS ENUM('goal', 'own_goal', 'assist', 'yellow', 'timeout_2min', 'red', 'injury');--> statement-breakpoint
CREATE TYPE "play"."match_stage" AS ENUM('rotation', 'round_robin', 'group', 'quarter_final', 'semi_final', 'final', 'friendly');--> statement-breakpoint
CREATE TYPE "play_private"."rating_model" AS ENUM('openskill_pl', 'organizer_seed');--> statement-breakpoint
CREATE TYPE "scheduling"."attendance_outcome" AS ENUM('attended', 'no_show', 'late', 'left_early', 'excused');--> statement-breakpoint
CREATE TYPE "scheduling"."cancel_reason" AS ENUM('weather', 'low_turnout', 'venue', 'holiday', 'organizer', 'other');--> statement-breakpoint
CREATE TYPE "scheduling"."checkpoint_kind" AS ENUM('second_field', 'weather', 'min_players', 'lineup');--> statement-breakpoint
CREATE TYPE "scheduling"."checkpoint_state" AS ENUM('pending', 'proposed', 'decided');--> statement-breakpoint
CREATE TYPE "scheduling"."duty_kind" AS ENUM('key', 'bibs', 'balls', 'collector', 'scorekeeper', 'first_aid');--> statement-breakpoint
CREATE TYPE "scheduling"."holiday_kind" AS ENUM('public', 'school');--> statement-breakpoint
CREATE TYPE "scheduling"."session_kind" AS ENUM('casual', 'training', 'tournament', 'event');--> statement-breakpoint
CREATE TYPE "scheduling"."session_status" AS ENUM('draft', 'open', 'full', 'locked', 'played', 'cancelled', 'moved');--> statement-breakpoint
CREATE TYPE "scheduling"."signup_priority" AS ENUM('normal', 'held', 'reserve_bonus');--> statement-breakpoint
CREATE TYPE "scheduling"."signup_role" AS ENUM('field', 'gk');--> statement-breakpoint
CREATE TYPE "scheduling"."signup_status" AS ENUM('in', 'maybe', 'out', 'waitlisted', 'offered');--> statement-breakpoint
CREATE TYPE "venue"."booking_status" AS ENUM('held', 'confirmed', 'released');--> statement-breakpoint
CREATE TYPE "venue"."surface" AS ENUM('artificial_turf', 'grass', 'parquet', 'sand', 'hall_turf', 'asphalt', 'other');--> statement-breakpoint
CREATE TYPE "venue"."venue_kind" AS ENUM('training', 'league', 'tournament', 'social');--> statement-breakpoint
CREATE TYPE "venue"."venue_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE "community"."ad" (
	"id" uuid PRIMARY KEY,
	"community_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"status" "community"."ad_status" DEFAULT 'pending'::"community"."ad_status" NOT NULL,
	"fee_txn_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community"."equipment" (
	"id" uuid PRIMARY KEY,
	"community_id" uuid NOT NULL,
	"kind" "community"."equipment_kind" NOT NULL,
	"label" text NOT NULL,
	"color_id" uuid,
	"quantity" smallint DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community"."equipment_custody" (
	"id" uuid PRIMARY KEY,
	"equipment_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"during" tstzrange NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community"."event" (
	"id" uuid PRIMARY KEY,
	"community_id" uuid NOT NULL,
	"kind" "community"."event_kind" NOT NULL,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"venue_id" uuid,
	"capacity" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community"."event_rsvp" (
	"event_id" uuid,
	"person_id" uuid,
	"guests" smallint DEFAULT 0 NOT NULL,
	"kids" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "event_rsvp_pkey" PRIMARY KEY("event_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "community"."lost_item" (
	"id" uuid PRIMARY KEY,
	"community_id" uuid NOT NULL,
	"session_id" uuid,
	"description" text NOT NULL,
	"photo_file_id" text,
	"status" "community"."lost_item_status" DEFAULT 'found'::"community"."lost_item_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community"."rule_ack" (
	"rule_doc_id" uuid,
	"person_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rule_ack_pkey" PRIMARY KEY("rule_doc_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "community"."rule_doc" (
	"id" uuid PRIMARY KEY,
	"community_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"version" integer NOT NULL,
	"body_md" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback"."feedback" (
	"session_id" uuid,
	"person_id" uuid,
	"overall" smallint,
	"teams_fair" smallint,
	"venue_score" smallint,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_pkey" PRIMARY KEY("session_id","person_id"),
	CONSTRAINT "feedback_scores_ck" CHECK (coalesce("overall", 3) between 1 and 5 and coalesce("teams_fair", 3) between 1 and 5 and coalesce("venue_score", 3) between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "feedback_private"."incident" (
	"id" uuid PRIMARY KEY,
	"session_id" uuid,
	"reporter_id" uuid NOT NULL,
	"subject_person_id" uuid,
	"kind" "feedback"."incident_kind" NOT NULL,
	"body" text NOT NULL,
	"status" "feedback"."incident_status" DEFAULT 'open'::"feedback"."incident_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback"."mvp_vote" (
	"session_id" uuid,
	"voter_id" uuid,
	"nominee_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mvp_vote_pkey" PRIMARY KEY("session_id","voter_id"),
	CONSTRAINT "mvp_vote_self_ck" CHECK ("voter_id" <> "nominee_id")
);
--> statement-breakpoint
CREATE TABLE "feedback_private"."peer_rating" (
	"session_id" uuid,
	"rater_id" uuid,
	"ratee_id" uuid,
	"activity_id" uuid NOT NULL,
	"level" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "peer_rating_pkey" PRIMARY KEY("session_id","rater_id","ratee_id"),
	CONSTRAINT "peer_rating_level_ck" CHECK ("level" between 1 and 5),
	CONSTRAINT "peer_rating_self_ck" CHECK ("rater_id" <> "ratee_id")
);
--> statement-breakpoint
CREATE TABLE "finance"."account" (
	"id" uuid PRIMARY KEY,
	"community_id" uuid NOT NULL,
	"kind" "finance"."account_kind" NOT NULL,
	"person_id" uuid,
	"name" text NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance"."ledger_entry" (
	"id" uuid PRIMARY KEY,
	"txn_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	CONSTRAINT "ledger_entry_nonzero_ck" CHECK ("amount_cents" <> 0)
);
--> statement-breakpoint
CREATE TABLE "finance"."ledger_txn" (
	"id" uuid PRIMARY KEY,
	"community_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"kind" "finance"."txn_kind" NOT NULL,
	"session_id" uuid,
	"event_id" uuid,
	"memo" text,
	"created_by" uuid,
	"approved_by" uuid,
	"reverses_txn_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance"."payment" (
	"txn_id" uuid PRIMARY KEY,
	"payer_person_id" uuid NOT NULL,
	"method" "finance"."payment_method" NOT NULL,
	"collected_by_person_id" uuid,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "finance"."price_rule" (
	"id" uuid PRIMARY KEY,
	"community_id" uuid NOT NULL,
	"scope" "finance"."price_scope" NOT NULL,
	"scope_id" uuid,
	"applies_to" "finance"."price_applies_to" DEFAULT 'field'::"finance"."price_applies_to" NOT NULL,
	"amount_cents" bigint NOT NULL,
	"headcount" int4range,
	"valid" daterange NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_rule_amount_ck" CHECK ("amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "identity"."consent" (
	"id" uuid PRIMARY KEY,
	"person_id" uuid NOT NULL,
	"purpose" "identity"."consent_purpose" NOT NULL,
	"policy_version" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "identity"."person" (
	"id" uuid PRIMARY KEY,
	"display_name" text NOT NULL,
	"locale" "identity"."locale" DEFAULT 'uk'::"identity"."locale" NOT NULL,
	"birth_date" date,
	"source" "identity"."record_source" DEFAULT 'bot'::"identity"."record_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"anonymized_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "identity"."person_alias" (
	"id" uuid PRIMARY KEY,
	"community_id" uuid NOT NULL,
	"person_id" uuid,
	"alias" text NOT NULL,
	"alias_norm" text NOT NULL,
	"kind" "identity"."alias_kind" DEFAULT 'nickname'::"identity"."alias_kind" NOT NULL,
	"occurrences" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"resolution" "identity"."alias_resolution" DEFAULT 'unresolved'::"identity"."alias_resolution" NOT NULL,
	"confidence" numeric(3,2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."telegram_account" (
	"tg_user_id" bigint PRIMARY KEY,
	"person_id" uuid,
	"username" text,
	"first_name" text NOT NULL,
	"last_name" text,
	"language_code" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."telegram_author" (
	"id" uuid PRIMARY KEY,
	"community_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"tg_user_id" bigint,
	"person_id" uuid,
	"message_count" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "league"."award" (
	"id" uuid PRIMARY KEY,
	"community_id" uuid NOT NULL,
	"season" text,
	"kind" "league"."award_kind" NOT NULL,
	"person_id" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "league"."competition" (
	"id" uuid PRIMARY KEY,
	"community_id" uuid NOT NULL,
	"organizer" text,
	"name" text NOT NULL,
	"season" text,
	"kind" "league"."competition_kind" NOT NULL,
	"level" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "league"."fixture" (
	"id" uuid PRIMARY KEY,
	"competition_id" uuid,
	"squad_id" uuid,
	"opponent_id" uuid NOT NULL,
	"venue_id" uuid,
	"kickoff_at" timestamp with time zone,
	"played_on" text,
	"home" boolean,
	"stage" text,
	"goals_for" smallint,
	"goals_against" smallint,
	"penalties_for" smallint,
	"penalties_against" smallint,
	"status" "league"."fixture_status" DEFAULT 'scheduled'::"league"."fixture_status" NOT NULL,
	"source" "identity"."record_source" DEFAULT 'bot'::"identity"."record_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "league"."fixture_availability" (
	"fixture_id" uuid,
	"person_id" uuid,
	"status" "league"."availability" NOT NULL,
	"called_up" boolean DEFAULT false NOT NULL,
	CONSTRAINT "fixture_availability_pkey" PRIMARY KEY("fixture_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "league"."fixture_event" (
	"id" uuid PRIMARY KEY,
	"fixture_id" uuid NOT NULL,
	"kind" "league"."fixture_event_kind" NOT NULL,
	"person_id" uuid,
	"minute" smallint
);
--> statement-breakpoint
CREATE TABLE "league"."opponent" (
	"id" uuid PRIMARY KEY,
	"community_id" uuid NOT NULL,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "league"."squad" (
	"id" uuid PRIMARY KEY,
	"community_id" uuid NOT NULL,
	"activity_id" uuid,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "league"."squad_member" (
	"squad_id" uuid,
	"person_id" uuid,
	"shirt_number" smallint,
	"valid" daterange DEFAULT '(,)' NOT NULL,
	CONSTRAINT "squad_member_pkey" PRIMARY KEY("squad_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "org"."activity" (
	"id" uuid PRIMARY KEY,
	"community_id" uuid NOT NULL,
	"sport" "org"."sport" NOT NULL,
	"name" text NOT NULL,
	"defaults" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org"."activity_follow" (
	"person_id" uuid,
	"activity_id" uuid,
	"notify" "org"."notify_level" DEFAULT 'all'::"org"."notify_level" NOT NULL,
	CONSTRAINT "activity_follow_pkey" PRIMARY KEY("person_id","activity_id")
);
--> statement-breakpoint
CREATE TABLE "org"."community" (
	"id" uuid PRIMARY KEY,
	"slug" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'Europe/Vienna' NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"default_locale" "identity"."locale" DEFAULT 'uk'::"identity"."locale" NOT NULL,
	"settings" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org"."membership" (
	"community_id" uuid,
	"person_id" uuid,
	"status" "org"."membership_status" DEFAULT 'active'::"org"."membership_status" NOT NULL,
	"joined_at" timestamp with time zone,
	"left_at" timestamp with time zone,
	"invited_by_person_id" uuid,
	"sponsor_person_id" uuid,
	CONSTRAINT "membership_pkey" PRIMARY KEY("community_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "org"."player_profile" (
	"person_id" uuid,
	"activity_id" uuid,
	"positions" "org"."position"[] DEFAULT '{}'::"org"."position"[] NOT NULL,
	"preferred_foot" "org"."foot",
	"self_level" smallint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_profile_pkey" PRIMARY KEY("person_id","activity_id")
);
--> statement-breakpoint
CREATE TABLE "org"."role_grant" (
	"id" uuid PRIMARY KEY,
	"community_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" "org"."role" NOT NULL,
	"scope_type" "org"."scope_type" DEFAULT 'community'::"org"."scope_type" NOT NULL,
	"scope_id" uuid,
	"valid" tstzrange DEFAULT '(,)' NOT NULL,
	"granted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org"."telegram_chat" (
	"chat_id" bigint PRIMARY KEY,
	"community_id" uuid NOT NULL,
	"activity_id" uuid,
	"kind" "org"."chat_kind" NOT NULL,
	"purpose" "org"."chat_purpose" DEFAULT 'main'::"org"."chat_purpose" NOT NULL,
	"title" text NOT NULL,
	"bot_rights" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit"."log" (
	"id" uuid PRIMARY KEY,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_person_id" uuid,
	"actor_kind" "audit"."actor_kind" NOT NULL,
	"community_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"diff" jsonb
);
--> statement-breakpoint
CREATE TABLE "ingest"."extraction" (
	"id" uuid PRIMARY KEY,
	"source_ref_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"confidence" numeric(3,2)
);
--> statement-breakpoint
CREATE TABLE "ingest"."run" (
	"id" uuid PRIMARY KEY,
	"community_id" uuid NOT NULL,
	"source" "ingest"."ingest_source" NOT NULL,
	"file_sha256" text NOT NULL,
	"parser_version" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"stats" jsonb DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comms"."message_ref" (
	"chat_id" bigint,
	"message_id" bigint,
	"purpose" "comms"."message_purpose" NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_ref_pkey" PRIMARY KEY("chat_id","message_id")
);
--> statement-breakpoint
CREATE TABLE "comms"."notification_pref" (
	"person_id" uuid,
	"channel" "comms"."channel",
	"kind" text,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "notification_pref_pkey" PRIMARY KEY("person_id","channel","kind")
);
--> statement-breakpoint
CREATE TABLE "comms"."outbox" (
	"id" uuid PRIMARY KEY,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest"."source_ref" (
	"id" uuid PRIMARY KEY,
	"run_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"message_id" bigint NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"kind" "ingest"."source_ref_kind" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "play"."format_rule" (
	"id" uuid PRIMARY KEY,
	"community_id" uuid NOT NULL,
	"name" text NOT NULL,
	"rules" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "play"."match" (
	"id" uuid PRIMARY KEY,
	"session_id" uuid NOT NULL,
	"field_id" uuid,
	"seq" integer NOT NULL,
	"stage" "play"."match_stage" DEFAULT 'rotation'::"play"."match_stage" NOT NULL,
	"team_a_id" uuid NOT NULL,
	"team_b_id" uuid NOT NULL,
	"score_a" smallint,
	"score_b" smallint,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	CONSTRAINT "match_distinct_teams_ck" CHECK ("team_a_id" <> "team_b_id")
);
--> statement-breakpoint
CREATE TABLE "play"."match_event" (
	"id" uuid PRIMARY KEY,
	"match_id" uuid NOT NULL,
	"kind" "play"."match_event_kind" NOT NULL,
	"person_id" uuid,
	"team_id" uuid NOT NULL,
	"at" timestamp with time zone,
	"confirmed_by" uuid
);
--> statement-breakpoint
CREATE TABLE "play_private"."rating" (
	"person_id" uuid,
	"activity_id" uuid,
	"model" "play_private"."rating_model",
	"mu" double precision NOT NULL,
	"sigma" double precision NOT NULL,
	"games" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rating_pkey" PRIMARY KEY("person_id","activity_id","model")
);
--> statement-breakpoint
CREATE TABLE "play_private"."rating_event" (
	"id" uuid PRIMARY KEY,
	"person_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"model" "play_private"."rating_model" NOT NULL,
	"match_id" uuid,
	"mu_before" double precision NOT NULL,
	"mu_after" double precision NOT NULL,
	"sigma_before" double precision NOT NULL,
	"sigma_after" double precision NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "play"."team" (
	"id" uuid PRIMARY KEY,
	"session_id" uuid NOT NULL,
	"color_id" uuid,
	"ordinal" smallint NOT NULL,
	"label" text,
	"predicted_strength" double precision,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "play"."team_color" (
	"id" uuid PRIMARY KEY,
	"community_id" uuid NOT NULL,
	"name" text NOT NULL,
	"emoji" text,
	"hex" text
);
--> statement-breakpoint
CREATE TABLE "play"."team_member" (
	"team_id" uuid,
	"session_id" uuid NOT NULL,
	"person_id" uuid,
	"is_gk" boolean DEFAULT false NOT NULL,
	"is_captain" boolean DEFAULT false NOT NULL,
	"is_newcomer" boolean DEFAULT false NOT NULL,
	"assigned_by" "play"."assigned_by" DEFAULT 'organizer'::"play"."assigned_by" NOT NULL,
	CONSTRAINT "team_member_pkey" PRIMARY KEY("team_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "scheduling"."attendance" (
	"session_id" uuid,
	"person_id" uuid,
	"outcome" "scheduling"."attendance_outcome" NOT NULL,
	"late_minutes" smallint,
	"recorded_by" uuid,
	"source" "identity"."record_source" DEFAULT 'bot'::"identity"."record_source" NOT NULL,
	CONSTRAINT "attendance_pkey" PRIMARY KEY("session_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "scheduling"."checkpoint" (
	"id" uuid PRIMARY KEY,
	"session_id" uuid NOT NULL,
	"kind" "scheduling"."checkpoint_kind" NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"state" "scheduling"."checkpoint_state" DEFAULT 'pending'::"scheduling"."checkpoint_state" NOT NULL,
	"recommendation" jsonb,
	"decision" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "scheduling"."duty" (
	"session_id" uuid,
	"person_id" uuid,
	"kind" "scheduling"."duty_kind",
	CONSTRAINT "duty_pkey" PRIMARY KEY("session_id","kind","person_id")
);
--> statement-breakpoint
CREATE TABLE "scheduling"."holiday" (
	"date" date,
	"region" text,
	"kind" "scheduling"."holiday_kind",
	"name" text NOT NULL,
	CONSTRAINT "holiday_pkey" PRIMARY KEY("date","region","kind")
);
--> statement-breakpoint
CREATE TABLE "scheduling"."logistics" (
	"session_id" uuid PRIMARY KEY,
	"changing_room" text,
	"meeting_note" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduling"."series" (
	"id" uuid PRIMARY KEY,
	"community_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"venue_id" uuid,
	"name" text NOT NULL,
	"rrule" text NOT NULL,
	"local_start" time NOT NULL,
	"duration" interval NOT NULL,
	"capacity_min" smallint,
	"capacity_max" smallint,
	"gk_slots" smallint DEFAULT 0 NOT NULL,
	"publish_offset" interval,
	"cancel_cutoff_offset" interval,
	"active" daterange NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduling"."session" (
	"id" uuid PRIMARY KEY,
	"community_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"series_id" uuid,
	"venue_id" uuid,
	"kind" "scheduling"."session_kind" DEFAULT 'casual'::"scheduling"."session_kind" NOT NULL,
	"local_date" date NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"status" "scheduling"."session_status" DEFAULT 'draft'::"scheduling"."session_status" NOT NULL,
	"capacity_min" smallint,
	"capacity_max" smallint,
	"gk_slots" smallint DEFAULT 0 NOT NULL,
	"fields_planned" smallint,
	"format" text,
	"signup_opens_at" timestamp with time zone,
	"cancel_cutoff_at" timestamp with time zone,
	"cancel_reason" "scheduling"."cancel_reason",
	"moved_to_session_id" uuid,
	"title" text,
	"source" "identity"."record_source" DEFAULT 'bot'::"identity"."record_source" NOT NULL,
	"confidence" numeric(3,2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_moved_ck" CHECK (("moved_to_session_id" is null) or ("status" = 'moved')),
	CONSTRAINT "session_capacity_ck" CHECK ("capacity_min" is null or "capacity_max" is null or "capacity_min" <= "capacity_max"),
	CONSTRAINT "session_time_ck" CHECK ("ends_at" is null or "ends_at" > "starts_at")
);
--> statement-breakpoint
CREATE TABLE "scheduling"."session_change" (
	"id" uuid PRIMARY KEY,
	"session_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_person_id" uuid,
	"diff" jsonb NOT NULL,
	"notified" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduling"."session_field" (
	"session_id" uuid,
	"field_id" uuid,
	"booking_id" uuid,
	CONSTRAINT "session_field_pkey" PRIMARY KEY("session_id","field_id")
);
--> statement-breakpoint
CREATE TABLE "scheduling"."signup" (
	"id" uuid PRIMARY KEY,
	"session_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" "scheduling"."signup_role" DEFAULT 'field'::"scheduling"."signup_role" NOT NULL,
	"status" "scheduling"."signup_status" NOT NULL,
	"guest_of_person_id" uuid,
	"priority" "scheduling"."signup_priority" DEFAULT 'normal'::"scheduling"."signup_priority" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduling"."signup_event" (
	"id" uuid PRIMARY KEY,
	"signup_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"from_status" "scheduling"."signup_status",
	"to_status" "scheduling"."signup_status" NOT NULL,
	"actor_person_id" uuid,
	"late" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduling"."weather_snapshot" (
	"id" uuid PRIMARY KEY,
	"session_id" uuid NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider" text NOT NULL,
	"for_time" timestamp with time zone NOT NULL,
	"temp_c" double precision,
	"precip_mm" double precision,
	"precip_prob" smallint,
	"wind_kmh" double precision,
	"thunder_prob" smallint,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "venue"."booking" (
	"id" uuid PRIMARY KEY,
	"field_id" uuid NOT NULL,
	"during" tstzrange NOT NULL,
	"status" "venue"."booking_status" DEFAULT 'held'::"venue"."booking_status" NOT NULL,
	"cost_cents" integer,
	"cancel_deadline" timestamp with time zone,
	"booked_by_person_id" uuid,
	"external_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venue"."field" (
	"id" uuid PRIMARY KEY,
	"venue_id" uuid NOT NULL,
	"label" text NOT NULL,
	"surface" "venue"."surface",
	"format_max" smallint,
	"length_m" integer,
	"width_m" integer,
	"indoor" boolean,
	"lit" boolean
);
--> statement-breakpoint
CREATE TABLE "venue"."venue" (
	"id" uuid PRIMARY KEY,
	"community_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "venue"."venue_kind" DEFAULT 'training'::"venue"."venue_kind" NOT NULL,
	"address" text,
	"district" smallint,
	"lat" double precision,
	"lng" double precision,
	"transit" text,
	"indoor" boolean,
	"parking" text,
	"rules" text,
	"cancellation_policy" jsonb DEFAULT '{}' NOT NULL,
	"hard_end_local" time,
	"status" "venue"."venue_status" DEFAULT 'active'::"venue"."venue_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venue_lat_ck" CHECK ("lat" is null or "lat" between -90 and 90),
	CONSTRAINT "venue_lng_ck" CHECK ("lng" is null or "lng" between -180 and 180),
	CONSTRAINT "venue_district_ck" CHECK ("district" is null or "district" between 1 and 23)
);
--> statement-breakpoint
CREATE TABLE "venue"."venue_alias" (
	"venue_id" uuid,
	"alias_norm" text,
	CONSTRAINT "venue_alias_pkey" PRIMARY KEY("venue_id","alias_norm")
);
--> statement-breakpoint
CREATE TABLE "venue"."venue_closure" (
	"id" uuid PRIMARY KEY,
	"venue_id" uuid NOT NULL,
	"during" tstzrange NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE INDEX "event_community_idx" ON "community"."event" ("community_id","starts_at");--> statement-breakpoint
CREATE INDEX "incident_status_idx" ON "feedback_private"."incident" ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "account_person_kind_uq" ON "finance"."account" ("community_id","kind","person_id");--> statement-breakpoint
CREATE INDEX "ledger_entry_account_idx" ON "finance"."ledger_entry" ("account_id");--> statement-breakpoint
CREATE INDEX "ledger_entry_txn_idx" ON "finance"."ledger_entry" ("txn_id");--> statement-breakpoint
CREATE INDEX "ledger_txn_session_idx" ON "finance"."ledger_txn" ("session_id");--> statement-breakpoint
CREATE INDEX "ledger_txn_occurred_idx" ON "finance"."ledger_txn" ("community_id","occurred_at");--> statement-breakpoint
CREATE INDEX "consent_person_idx" ON "identity"."consent" ("person_id","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "person_alias_norm_uq" ON "identity"."person_alias" ("community_id","alias_norm");--> statement-breakpoint
CREATE INDEX "person_alias_person_idx" ON "identity"."person_alias" ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_account_person_uq" ON "identity"."telegram_account" ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_author_name_uq" ON "identity"."telegram_author" ("community_id","display_name");--> statement-breakpoint
CREATE UNIQUE INDEX "competition_name_season_uq" ON "league"."competition" ("community_id","name","season");--> statement-breakpoint
CREATE INDEX "fixture_squad_idx" ON "league"."fixture" ("squad_id","kickoff_at");--> statement-breakpoint
CREATE INDEX "fixture_event_fixture_idx" ON "league"."fixture_event" ("fixture_id");--> statement-breakpoint
CREATE UNIQUE INDEX "opponent_name_uq" ON "league"."opponent" ("community_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "squad_name_uq" ON "league"."squad" ("community_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_name_uq" ON "org"."activity" ("community_id","name");--> statement-breakpoint
CREATE INDEX "role_grant_person_idx" ON "org"."role_grant" ("community_id","person_id");--> statement-breakpoint
CREATE INDEX "telegram_chat_community_idx" ON "org"."telegram_chat" ("community_id");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit"."log" ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit"."log" ("at");--> statement-breakpoint
CREATE INDEX "extraction_entity_idx" ON "ingest"."extraction" ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "message_ref_entity_idx" ON "comms"."message_ref" ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "comms"."outbox" ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "source_ref_message_kind_uq" ON "ingest"."source_ref" ("community_id","message_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "match_session_seq_uq" ON "play"."match" ("session_id","seq");--> statement-breakpoint
CREATE INDEX "match_event_match_idx" ON "play"."match_event" ("match_id");--> statement-breakpoint
CREATE INDEX "rating_event_person_idx" ON "play_private"."rating_event" ("person_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "team_session_ordinal_uq" ON "play"."team" ("session_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "team_color_name_uq" ON "play"."team_color" ("community_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "team_member_session_person_uq" ON "play"."team_member" ("session_id","person_id");--> statement-breakpoint
CREATE INDEX "attendance_person_idx" ON "scheduling"."attendance" ("person_id");--> statement-breakpoint
CREATE INDEX "checkpoint_due_idx" ON "scheduling"."checkpoint" ("state","due_at");--> statement-breakpoint
CREATE INDEX "session_community_date_idx" ON "scheduling"."session" ("community_id","local_date");--> statement-breakpoint
CREATE INDEX "session_venue_idx" ON "scheduling"."session" ("venue_id");--> statement-breakpoint
CREATE INDEX "session_change_session_idx" ON "scheduling"."session_change" ("session_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "signup_session_person_uq" ON "scheduling"."signup" ("session_id","person_id");--> statement-breakpoint
CREATE INDEX "signup_event_signup_idx" ON "scheduling"."signup_event" ("signup_id","at");--> statement-breakpoint
CREATE INDEX "weather_session_idx" ON "scheduling"."weather_snapshot" ("session_id","fetched_at");--> statement-breakpoint
CREATE INDEX "booking_field_idx" ON "venue"."booking" ("field_id");--> statement-breakpoint
CREATE INDEX "field_venue_idx" ON "venue"."field" ("venue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "venue_community_name_uq" ON "venue"."venue" ("community_id","name");--> statement-breakpoint
ALTER TABLE "community"."ad" ADD CONSTRAINT "ad_community_id_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "org"."community"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "community"."ad" ADD CONSTRAINT "ad_author_id_person_id_fkey" FOREIGN KEY ("author_id") REFERENCES "identity"."person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "community"."equipment" ADD CONSTRAINT "equipment_community_id_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "org"."community"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "community"."equipment" ADD CONSTRAINT "equipment_color_id_team_color_id_fkey" FOREIGN KEY ("color_id") REFERENCES "play"."team_color"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "community"."equipment_custody" ADD CONSTRAINT "equipment_custody_equipment_id_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "community"."equipment"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "community"."equipment_custody" ADD CONSTRAINT "equipment_custody_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "identity"."person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "community"."event" ADD CONSTRAINT "event_community_id_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "org"."community"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "community"."event" ADD CONSTRAINT "event_venue_id_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venue"."venue"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "community"."event_rsvp" ADD CONSTRAINT "event_rsvp_event_id_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "community"."event"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "community"."event_rsvp" ADD CONSTRAINT "event_rsvp_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "identity"."person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "community"."lost_item" ADD CONSTRAINT "lost_item_community_id_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "org"."community"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "community"."lost_item" ADD CONSTRAINT "lost_item_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "scheduling"."session"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "community"."rule_ack" ADD CONSTRAINT "rule_ack_rule_doc_id_rule_doc_id_fkey" FOREIGN KEY ("rule_doc_id") REFERENCES "community"."rule_doc"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "community"."rule_ack" ADD CONSTRAINT "rule_ack_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "identity"."person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "community"."rule_doc" ADD CONSTRAINT "rule_doc_community_id_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "org"."community"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "feedback"."feedback" ADD CONSTRAINT "feedback_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "scheduling"."session"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "feedback"."feedback" ADD CONSTRAINT "feedback_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "identity"."person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "feedback_private"."incident" ADD CONSTRAINT "incident_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "scheduling"."session"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "feedback_private"."incident" ADD CONSTRAINT "incident_reporter_id_person_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "identity"."person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "feedback_private"."incident" ADD CONSTRAINT "incident_subject_person_id_person_id_fkey" FOREIGN KEY ("subject_person_id") REFERENCES "identity"."person"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "feedback"."mvp_vote" ADD CONSTRAINT "mvp_vote_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "scheduling"."session"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "feedback"."mvp_vote" ADD CONSTRAINT "mvp_vote_voter_id_person_id_fkey" FOREIGN KEY ("voter_id") REFERENCES "identity"."person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "feedback"."mvp_vote" ADD CONSTRAINT "mvp_vote_nominee_id_person_id_fkey" FOREIGN KEY ("nominee_id") REFERENCES "identity"."person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "feedback_private"."peer_rating" ADD CONSTRAINT "peer_rating_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "scheduling"."session"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "feedback_private"."peer_rating" ADD CONSTRAINT "peer_rating_rater_id_person_id_fkey" FOREIGN KEY ("rater_id") REFERENCES "identity"."person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "feedback_private"."peer_rating" ADD CONSTRAINT "peer_rating_ratee_id_person_id_fkey" FOREIGN KEY ("ratee_id") REFERENCES "identity"."person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "feedback_private"."peer_rating" ADD CONSTRAINT "peer_rating_activity_id_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "org"."activity"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "finance"."account" ADD CONSTRAINT "account_community_id_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "org"."community"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "finance"."account" ADD CONSTRAINT "account_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "identity"."person"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "finance"."ledger_entry" ADD CONSTRAINT "ledger_entry_txn_id_ledger_txn_id_fkey" FOREIGN KEY ("txn_id") REFERENCES "finance"."ledger_txn"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "finance"."ledger_entry" ADD CONSTRAINT "ledger_entry_account_id_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "finance"."account"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "finance"."ledger_txn" ADD CONSTRAINT "ledger_txn_community_id_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "org"."community"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "finance"."ledger_txn" ADD CONSTRAINT "ledger_txn_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "scheduling"."session"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "finance"."ledger_txn" ADD CONSTRAINT "ledger_txn_created_by_person_id_fkey" FOREIGN KEY ("created_by") REFERENCES "identity"."person"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "finance"."ledger_txn" ADD CONSTRAINT "ledger_txn_approved_by_person_id_fkey" FOREIGN KEY ("approved_by") REFERENCES "identity"."person"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "finance"."payment" ADD CONSTRAINT "payment_txn_id_ledger_txn_id_fkey" FOREIGN KEY ("txn_id") REFERENCES "finance"."ledger_txn"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "finance"."payment" ADD CONSTRAINT "payment_payer_person_id_person_id_fkey" FOREIGN KEY ("payer_person_id") REFERENCES "identity"."person"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "finance"."payment" ADD CONSTRAINT "payment_collected_by_person_id_person_id_fkey" FOREIGN KEY ("collected_by_person_id") REFERENCES "identity"."person"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "finance"."payment" ADD CONSTRAINT "payment_confirmed_by_person_id_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "identity"."person"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "finance"."price_rule" ADD CONSTRAINT "price_rule_community_id_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "org"."community"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "identity"."consent" ADD CONSTRAINT "consent_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "identity"."person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "identity"."person_alias" ADD CONSTRAINT "person_alias_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "identity"."person"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "identity"."telegram_account" ADD CONSTRAINT "telegram_account_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "identity"."person"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "identity"."telegram_author" ADD CONSTRAINT "telegram_author_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "identity"."person"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "league"."award" ADD CONSTRAINT "award_community_id_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "org"."community"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "league"."award" ADD CONSTRAINT "award_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "identity"."person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "league"."competition" ADD CONSTRAINT "competition_community_id_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "org"."community"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "league"."fixture" ADD CONSTRAINT "fixture_competition_id_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "league"."competition"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "league"."fixture" ADD CONSTRAINT "fixture_squad_id_squad_id_fkey" FOREIGN KEY ("squad_id") REFERENCES "league"."squad"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "league"."fixture" ADD CONSTRAINT "fixture_opponent_id_opponent_id_fkey" FOREIGN KEY ("opponent_id") REFERENCES "league"."opponent"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "league"."fixture" ADD CONSTRAINT "fixture_venue_id_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venue"."venue"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "league"."fixture_availability" ADD CONSTRAINT "fixture_availability_fixture_id_fixture_id_fkey" FOREIGN KEY ("fixture_id") REFERENCES "league"."fixture"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "league"."fixture_availability" ADD CONSTRAINT "fixture_availability_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "identity"."person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "league"."fixture_event" ADD CONSTRAINT "fixture_event_fixture_id_fixture_id_fkey" FOREIGN KEY ("fixture_id") REFERENCES "league"."fixture"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "league"."fixture_event" ADD CONSTRAINT "fixture_event_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "identity"."person"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "league"."opponent" ADD CONSTRAINT "opponent_community_id_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "org"."community"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "league"."squad" ADD CONSTRAINT "squad_community_id_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "org"."community"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "league"."squad" ADD CONSTRAINT "squad_activity_id_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "org"."activity"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "league"."squad_member" ADD CONSTRAINT "squad_member_squad_id_squad_id_fkey" FOREIGN KEY ("squad_id") REFERENCES "league"."squad"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "league"."squad_member" ADD CONSTRAINT "squad_member_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "identity"."person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "org"."activity" ADD CONSTRAINT "activity_community_id_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "org"."community"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "org"."activity_follow" ADD CONSTRAINT "activity_follow_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "identity"."person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "org"."activity_follow" ADD CONSTRAINT "activity_follow_activity_id_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "org"."activity"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "org"."membership" ADD CONSTRAINT "membership_community_id_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "org"."community"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "org"."membership" ADD CONSTRAINT "membership_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "identity"."person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "org"."membership" ADD CONSTRAINT "membership_invited_by_person_id_person_id_fkey" FOREIGN KEY ("invited_by_person_id") REFERENCES "identity"."person"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "org"."membership" ADD CONSTRAINT "membership_sponsor_person_id_person_id_fkey" FOREIGN KEY ("sponsor_person_id") REFERENCES "identity"."person"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "org"."player_profile" ADD CONSTRAINT "player_profile_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "identity"."person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "org"."player_profile" ADD CONSTRAINT "player_profile_activity_id_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "org"."activity"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "org"."role_grant" ADD CONSTRAINT "role_grant_community_id_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "org"."community"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "org"."role_grant" ADD CONSTRAINT "role_grant_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "identity"."person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "org"."role_grant" ADD CONSTRAINT "role_grant_granted_by_person_id_fkey" FOREIGN KEY ("granted_by") REFERENCES "identity"."person"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "org"."telegram_chat" ADD CONSTRAINT "telegram_chat_community_id_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "org"."community"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "org"."telegram_chat" ADD CONSTRAINT "telegram_chat_activity_id_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "org"."activity"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "audit"."log" ADD CONSTRAINT "log_actor_person_id_person_id_fkey" FOREIGN KEY ("actor_person_id") REFERENCES "identity"."person"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "ingest"."extraction" ADD CONSTRAINT "extraction_source_ref_id_source_ref_id_fkey" FOREIGN KEY ("source_ref_id") REFERENCES "ingest"."source_ref"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ingest"."run" ADD CONSTRAINT "run_community_id_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "org"."community"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "comms"."notification_pref" ADD CONSTRAINT "notification_pref_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "identity"."person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ingest"."source_ref" ADD CONSTRAINT "source_ref_run_id_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ingest"."run"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ingest"."source_ref" ADD CONSTRAINT "source_ref_community_id_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "org"."community"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "play"."format_rule" ADD CONSTRAINT "format_rule_community_id_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "org"."community"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "play"."match" ADD CONSTRAINT "match_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "scheduling"."session"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "play"."match" ADD CONSTRAINT "match_field_id_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "venue"."field"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "play"."match" ADD CONSTRAINT "match_team_a_id_team_id_fkey" FOREIGN KEY ("team_a_id") REFERENCES "play"."team"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "play"."match" ADD CONSTRAINT "match_team_b_id_team_id_fkey" FOREIGN KEY ("team_b_id") REFERENCES "play"."team"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "play"."match_event" ADD CONSTRAINT "match_event_match_id_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "play"."match"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "play"."match_event" ADD CONSTRAINT "match_event_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "identity"."person"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "play"."match_event" ADD CONSTRAINT "match_event_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "play"."team"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "play"."match_event" ADD CONSTRAINT "match_event_confirmed_by_person_id_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "identity"."person"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "play_private"."rating" ADD CONSTRAINT "rating_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "identity"."person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "play_private"."rating" ADD CONSTRAINT "rating_activity_id_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "org"."activity"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "play_private"."rating_event" ADD CONSTRAINT "rating_event_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "identity"."person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "play_private"."rating_event" ADD CONSTRAINT "rating_event_activity_id_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "org"."activity"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "play_private"."rating_event" ADD CONSTRAINT "rating_event_match_id_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "play"."match"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "play"."team" ADD CONSTRAINT "team_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "scheduling"."session"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "play"."team" ADD CONSTRAINT "team_color_id_team_color_id_fkey" FOREIGN KEY ("color_id") REFERENCES "play"."team_color"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "play"."team_color" ADD CONSTRAINT "team_color_community_id_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "org"."community"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "play"."team_member" ADD CONSTRAINT "team_member_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "play"."team"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "play"."team_member" ADD CONSTRAINT "team_member_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "scheduling"."session"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "play"."team_member" ADD CONSTRAINT "team_member_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "identity"."person"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "scheduling"."attendance" ADD CONSTRAINT "attendance_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "scheduling"."session"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "scheduling"."attendance" ADD CONSTRAINT "attendance_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "identity"."person"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "scheduling"."attendance" ADD CONSTRAINT "attendance_recorded_by_person_id_fkey" FOREIGN KEY ("recorded_by") REFERENCES "identity"."person"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "scheduling"."checkpoint" ADD CONSTRAINT "checkpoint_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "scheduling"."session"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "scheduling"."checkpoint" ADD CONSTRAINT "checkpoint_decided_by_person_id_fkey" FOREIGN KEY ("decided_by") REFERENCES "identity"."person"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "scheduling"."duty" ADD CONSTRAINT "duty_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "scheduling"."session"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "scheduling"."duty" ADD CONSTRAINT "duty_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "identity"."person"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "scheduling"."logistics" ADD CONSTRAINT "logistics_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "scheduling"."session"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "scheduling"."logistics" ADD CONSTRAINT "logistics_updated_by_person_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "identity"."person"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "scheduling"."series" ADD CONSTRAINT "series_community_id_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "org"."community"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "scheduling"."series" ADD CONSTRAINT "series_activity_id_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "org"."activity"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "scheduling"."series" ADD CONSTRAINT "series_venue_id_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venue"."venue"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "scheduling"."session" ADD CONSTRAINT "session_community_id_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "org"."community"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "scheduling"."session" ADD CONSTRAINT "session_activity_id_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "org"."activity"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "scheduling"."session" ADD CONSTRAINT "session_series_id_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "scheduling"."series"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "scheduling"."session" ADD CONSTRAINT "session_venue_id_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venue"."venue"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "scheduling"."session_change" ADD CONSTRAINT "session_change_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "scheduling"."session"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "scheduling"."session_change" ADD CONSTRAINT "session_change_actor_person_id_person_id_fkey" FOREIGN KEY ("actor_person_id") REFERENCES "identity"."person"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "scheduling"."session_field" ADD CONSTRAINT "session_field_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "scheduling"."session"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "scheduling"."session_field" ADD CONSTRAINT "session_field_field_id_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "venue"."field"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "scheduling"."session_field" ADD CONSTRAINT "session_field_booking_id_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "venue"."booking"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "scheduling"."signup" ADD CONSTRAINT "signup_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "scheduling"."session"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "scheduling"."signup" ADD CONSTRAINT "signup_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "identity"."person"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "scheduling"."signup" ADD CONSTRAINT "signup_guest_of_person_id_person_id_fkey" FOREIGN KEY ("guest_of_person_id") REFERENCES "identity"."person"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "scheduling"."signup_event" ADD CONSTRAINT "signup_event_signup_id_signup_id_fkey" FOREIGN KEY ("signup_id") REFERENCES "scheduling"."signup"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "scheduling"."signup_event" ADD CONSTRAINT "signup_event_actor_person_id_person_id_fkey" FOREIGN KEY ("actor_person_id") REFERENCES "identity"."person"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "scheduling"."weather_snapshot" ADD CONSTRAINT "weather_snapshot_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "scheduling"."session"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "venue"."booking" ADD CONSTRAINT "booking_field_id_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "venue"."field"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "venue"."booking" ADD CONSTRAINT "booking_booked_by_person_id_person_id_fkey" FOREIGN KEY ("booked_by_person_id") REFERENCES "identity"."person"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "venue"."field" ADD CONSTRAINT "field_venue_id_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venue"."venue"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "venue"."venue" ADD CONSTRAINT "venue_community_id_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "org"."community"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "venue"."venue_alias" ADD CONSTRAINT "venue_alias_venue_id_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venue"."venue"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "venue"."venue_closure" ADD CONSTRAINT "venue_closure_venue_id_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venue"."venue"("id") ON DELETE CASCADE;