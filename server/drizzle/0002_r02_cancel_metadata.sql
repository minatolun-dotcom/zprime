-- R-02 voucher cancellation metadata (Model A: mark + exclude).
-- Additive only: existing rows keep is_cancelled = false and need no backfill;
-- new columns are nullable. No destructive change, no data rewrite.
ALTER TABLE "vouchers" ADD COLUMN "cancelled_at" timestamp with time zone;
ALTER TABLE "vouchers" ADD COLUMN "cancel_reason" text;
ALTER TABLE "vouchers" ADD COLUMN "cancelled_by" integer;
