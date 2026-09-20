-- R-30: direct e-way bill generation (non-IRN) — the NIC EWB-API is a
-- SEPARATE portal from the e-invoice IRP and needs its own credentials
-- (the taxpayer's ewaybillgst.gov.in username/password). Additive only:
-- two nullable columns on irp_credentials; NULL = EWB-from-IRN only (B2B),
-- the pre-R-30 behavior exactly. No destructive SQL, no backfill.
-- Generated via drizzle-kit's programmatic API (see scripts/gen-0014.ts).
ALTER TABLE "irp_credentials" ADD COLUMN "ewb_username" text;
ALTER TABLE "irp_credentials" ADD COLUMN "ewb_password_enc" text;
