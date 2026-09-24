-- R-57 (R-55 Option B): voucher-numbering periodicity per voucher type —
-- Tally's "voucher numbering restarts each financial year" behaviour.
-- ADDITIVE ONLY, no destructive SQL, no backfill required:
--   voucher_types.numbering_periodicity:
--     'never'  (default) — the pre-Option-B single never-resetting counter,
--               byte-identical behaviour for every existing type
--     'fiscal' — the automatic counter restarts each financial year
--   vouchers.fy / voucher_counters.fy: the numbering bucket — the FY key
--   (fiscal-year BEGIN date, e.g. '2026-04-01') for 'fiscal' types, '' for
--   'never' types. NOT NULL DEFAULT '': on upgrade every existing row lands
--   in the '' bucket, which is exactly its pre-R-57 series; a NULL bucket
--   would defeat the unique indexes (SQL treats NULLs as distinct).
-- Indexes gain the fy dimension so two FYs can each restart at 1:
--   vouchers (company, type, fy, number) unique — manual numbers can repeat
--   across FYs of a fiscal type but never within one bucket (incl. never);
--   counters (company, type, fy) unique — exactly one counter row per bucket.
-- Generated via drizzle-kit's programmatic API (see scripts/gen-0016.ts).
ALTER TABLE "voucher_counters" ADD COLUMN "fy" text DEFAULT '' NOT NULL;
ALTER TABLE "voucher_types" ADD COLUMN "numbering_periodicity" text DEFAULT 'never' NOT NULL;
ALTER TABLE "vouchers" ADD COLUMN "fy" text DEFAULT '' NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "vouchers_company_type_number_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "vouchers_company_type_fy_number_uq" ON "vouchers" USING btree ("company_id","voucher_type_id","fy","number");
--> statement-breakpoint
DROP INDEX IF EXISTS "counter_company_type_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "counter_company_type_fy_uq" ON "voucher_counters" USING btree ("company_id","voucher_type_id","fy");
