CREATE TYPE "public"."run_flag_kind" AS ENUM('vouch', 'report');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('score', 'recorded', 'verified');--> statement-breakpoint
CREATE TABLE "leaderboard_recordings" (
	"record_id" uuid PRIMARY KEY NOT NULL,
	"audio" "bytea" NOT NULL,
	"type" text NOT NULL,
	"offset_ms" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_flags" (
	"record_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "run_flag_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_flags_record_id_user_id_pk" PRIMARY KEY("record_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "leaderboard_records" ADD COLUMN "status" "run_status" DEFAULT 'score' NOT NULL;--> statement-breakpoint
ALTER TABLE "leaderboard_recordings" ADD CONSTRAINT "leaderboard_recordings_record_id_leaderboard_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."leaderboard_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_flags" ADD CONSTRAINT "run_flags_record_id_leaderboard_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."leaderboard_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_flags" ADD CONSTRAINT "run_flags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;