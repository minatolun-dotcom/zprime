-- R-33: TDS/TCS threshold advisories — one nullable column per section
-- master recording how the threshold legally binds ('single' per payment,
-- 'aggregate' per payee per FY, NULL = advisory wording only). ADDITIVE and
-- ADVISORY-ONLY: nothing in zprime blocks a voucher on a threshold (R-33
-- Option A — the operator judges; the books record). No destructive SQL,
-- no backfill (NULL = pre-R-33 advisory wording, byte-identical).
-- Generated via drizzle-kit's programmatic API (see scripts/gen-0015.ts).
ALTER TABLE "tcs_sections" ADD COLUMN "threshold_mode" text;
ALTER TABLE "tds_sections" ADD COLUMN "threshold_mode" text;
