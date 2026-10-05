-- Scores the game reported, not ones the API worked out: the boards start again (the beta keeps no data).
DELETE FROM "daily_runs";--> statement-breakpoint
DELETE FROM "leaderboard_records";--> statement-breakpoint
ALTER TABLE "leaderboard_records" ADD COLUMN "merged_track" boolean NOT NULL;