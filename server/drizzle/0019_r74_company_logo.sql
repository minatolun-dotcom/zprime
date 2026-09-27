-- R-74: company logo for prints (invoice face + report print headers).
-- Additive only — one nullable bytea column; no backfill, no data change.
-- The client canvas-converts ANY uploaded image to a canonical ≤512px PNG
-- before upload, so the server stores/validates PNG bytes only (no native
-- image-processing dependency server-side). Served by GET /api/companies/:id/logo.
-- Generated via drizzle-kit's programmatic API (see scripts/gen-0019.ts).
ALTER TABLE "companies" ADD COLUMN "logo" "bytea";
