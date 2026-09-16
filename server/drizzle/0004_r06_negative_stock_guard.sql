-- R-06 (B-01): negative-stock guard policy flag.
-- Additive only: one new column with a safe default; no existing column
-- changes, no destructive SQL, no data backfill needed (default false =
-- stricter behavior; existing books without negative stock are unaffected,
-- existing books WITH negative stock keep working via the opt-in flag).

ALTER TABLE "companies" ADD COLUMN "allow_negative_stock" boolean DEFAULT false NOT NULL;--> statement-breakpoint
