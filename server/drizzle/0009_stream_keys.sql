CREATE TABLE "stream_keys" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stream_keys_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "stream_keys" ADD CONSTRAINT "stream_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;