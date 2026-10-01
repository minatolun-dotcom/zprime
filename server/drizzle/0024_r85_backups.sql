-- R-85: in-app backups to Google Drive (UpdraftPlus-style), restore included.
-- Deployment-level backup settings (singleton), run history, and the
-- deployment-level admin flag (users.is_admin — backups are instance-wide,
-- so configuring/running/restoring them is admin-only; company membership
-- does not confer it). All additive, zero backfill except: the FIRST user
-- (min(id)) is the seeded operator — is_admin true for them, every other
-- existing row honest as non-admin until promoted in Company Settings.
CREATE TABLE "backup_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"file_name" text,
	"file_size" bigint,
	"sha256" text,
	"drive_file_id" text,
	"error" text,
	"actor_id" integer
);
CREATE TABLE "backup_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"client_id" text,
	"client_secret_enc" text,
	"refresh_token_enc" text,
	"folder_name" text DEFAULT 'zprime-backups' NOT NULL,
	"schedule_kind" text DEFAULT 'off' NOT NULL,
	"schedule_dow" integer,
	"schedule_hhmm" text DEFAULT '02:30' NOT NULL,
	"retention_count" integer DEFAULT 14 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"last_scheduled_date" text,
	"last_run_at" timestamp with time zone
);
ALTER TABLE "users" ADD COLUMN "is_admin" boolean DEFAULT false NOT NULL;
ALTER TABLE "backup_runs" ADD CONSTRAINT "backup_runs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
UPDATE "users" SET "is_admin" = true WHERE "id" = (SELECT min("id") FROM "users");
