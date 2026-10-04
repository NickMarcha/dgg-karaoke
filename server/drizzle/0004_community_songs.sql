CREATE TYPE "public"."song_status" AS ENUM('submitted', 'published', 'rejected', 'archived');--> statement-breakpoint
CREATE TABLE "community_songs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"song_id" text NOT NULL,
	"artist" text NOT NULL,
	"title" text NOT NULL,
	"txt" text NOT NULL,
	"preview" jsonb NOT NULL,
	"status" "song_status" DEFAULT 'submitted' NOT NULL,
	"rejection_reason" text,
	"submitted_by" uuid,
	"reviewed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "community_songs" ADD CONSTRAINT "community_songs_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_songs" ADD CONSTRAINT "community_songs_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "community_songs_published_unique" ON "community_songs" USING btree ("song_id") WHERE "community_songs"."status" = 'published';--> statement-breakpoint
CREATE INDEX "community_songs_status_index" ON "community_songs" USING btree ("status","updated_at");