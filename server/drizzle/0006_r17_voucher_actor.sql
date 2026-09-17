-- R-17: audit-trail groundwork — actor provance on vouchers.
-- Additive only: three nullable columns; existing rows keep NULL (honest
-- "before audit groundwork" state — fabricating actor values is worse than
-- null). No destructive SQL, no backfill. cancelled_by (R-02) established
-- the pattern; the full audit feature (events table, history UI) remains
-- future scope and needs no further schema campaign for these columns.
ALTER TABLE "vouchers" ADD COLUMN "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "vouchers" ADD COLUMN "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "vouchers" ADD COLUMN "updated_at" timestamp with time zone;
