CREATE TABLE "daily_runs" (
	"day" date NOT NULL,
	"song_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"tolerance" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_runs_day_song_id_user_id_pk" PRIMARY KEY("day","song_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "daily_songs" (
	"day" date PRIMARY KEY NOT NULL,
	"song_id" text NOT NULL,
	"chosen_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_runs" ADD CONSTRAINT "daily_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_songs" ADD CONSTRAINT "daily_songs_chosen_by_users_id_fk" FOREIGN KEY ("chosen_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;