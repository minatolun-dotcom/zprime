-- R-68: e-invoice IRP signature artifacts — NIC's GENIRN response carries
-- SignedQRCode (the IRP-signed QR payload printed on a B2B e-invoice face)
-- and SignedInvoice (the offline-verifiable signed invoice JSON). Both were
-- previously buried in the verbatim response jsonb only; they are now
-- first-class, queryable columns seeded on the accepted GENIRN path.
-- Additive only: two nullable columns; no backfill (pre-R-68 rows keep null
-- and render no QR, honestly); verbatim response contract unchanged.
-- Generated via drizzle-kit's programmatic API (see scripts/gen-0017.ts).
ALTER TABLE "irp_submissions" ADD COLUMN "signed_qr_code" text;
ALTER TABLE "irp_submissions" ADD COLUMN "signed_invoice" text;
