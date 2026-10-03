CREATE TABLE "online_rooms" (
	"code" text PRIMARY KEY NOT NULL,
	"state" jsonb NOT NULL,
	"last_activity_at" timestamp with time zone NOT NULL
);
