-- R-18: full audit feature — append-only voucher event log.
-- Additive only: a new table; no existing table or row is touched.
-- voucher_id is nullable + ON DELETE SET NULL (not CASCADE): a hard delete
-- must not erase its own audit trail — when the voucher row goes, its history
-- detaches (voucher_id NULL) and the terminal `delete` event survives with a
-- one-line snapshot in detail. company_id keeps the log company-scoped.
-- No backfill: pre-R-18 transitions are unknowable, and seeding events at
-- migration time would fabricate timestamps/actors — existing vouchers
-- honestly show an empty history.
CREATE TABLE IF NOT EXISTS "audit_events" (
	"id" serial PRIMARY KEY,
	"company_id" integer NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"voucher_id" integer REFERENCES "vouchers"("id") ON DELETE SET NULL,
	"actor_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
	"action" text NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "audit_events_company_voucher_idx" ON "audit_events" ("company_id", "voucher_id");
CREATE INDEX IF NOT EXISTS "audit_events_company_created_idx" ON "audit_events" ("company_id", "created_at");
