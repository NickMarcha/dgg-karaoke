CREATE TABLE "leaderboard_notes" (
	"record_id" uuid PRIMARY KEY NOT NULL,
	"notes" "bytea" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leaderboard_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"song_id" text NOT NULL,
	"artist" text NOT NULL,
	"title" text NOT NULL,
	"song_last_update" text,
	"score" integer NOT NULL,
	"tolerance" smallint NOT NULL,
	"mode" text NOT NULL,
	"track_index" smallint NOT NULL,
	"input_lag" integer NOT NULL,
	"notes_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leaderboard_notes" ADD CONSTRAINT "leaderboard_notes_record_id_leaderboard_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."leaderboard_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_records" ADD CONSTRAINT "leaderboard_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "leaderboard_records_best_unique" ON "leaderboard_records" USING btree ("user_id","song_id","tolerance");--> statement-breakpoint
CREATE INDEX "leaderboard_records_song_index" ON "leaderboard_records" USING btree ("song_id","tolerance","score");--> statement-breakpoint
CREATE INDEX "leaderboard_records_global_index" ON "leaderboard_records" USING btree ("created_at","score");