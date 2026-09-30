-- R-83 (F-83-7): Tally's Bank Allocation "Ref ID" plus the post-dated
-- class (Ctrl+T). bank_ref_id = the bank-side reference (transaction/reference
-- id on RTGS/NEFT/UPI/other instruments, printed on the pay-in slip /
-- statement line) keyed per voucher alongside cheque_number/cheque_date and
-- reconciled_at (BRS). is_post_dated = advisory-only class flag — the voucher
-- posts normally; the Cheque Register derives pdc/due/cleared/open from it +
-- instrument date + reconciliation. ADDITIVE ONLY, no destructive SQL, no
-- backfill: NULL = no bank reference, false = not post-dated (every pre-R-83
-- row). Free short text validated by routes.lib — zprime never parses or
-- verifies it (no third-party banking in the threat model).
-- Generated via drizzle-kit's programmatic API (see scripts/gen-0021.ts).
ALTER TABLE "vouchers" ADD COLUMN "bank_ref_id" text;
ALTER TABLE "vouchers" ADD COLUMN "is_post_dated" boolean DEFAULT false NOT NULL;
