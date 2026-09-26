-- R-73: voucher feature batch (operator-approved findings F-73-1..F-73-7).
-- Additive only — all columns nullable or NOT NULL DEFAULT, no data backfill
-- except voucher types: every existing company gains Tally's order-processing
-- pair (Sale Order, Purchase Order) so order linkage is available fleet-wide.
--   vouchers.is_optional        — optional/draft class (F-73-1), excluded from
--                                 reports/balances/outstanding/stock like isCancelled
--   vouchers.bank_txn_type      — cheque|rtgs|neft|upi|other instrument facet (F-73-5)
--   vouchers.order_voucher_id   — the order this invoice/note fulfils (F-73-4)
--   voucher_entries.narration   — per-line narration (F-73-6)
--   inventory_entries.discount_pct — trade discount %, amount booked NET (F-73-3)
--   voucher_types.allow_zero_value_entries — per-type zero-line opt-in (F-73-7)
-- Generated via drizzle-kit's programmatic API (see scripts/gen-0018.ts).
DROP INDEX "vouchers_company_type_fy_number_uq";
ALTER TABLE "inventory_entries" ADD COLUMN "discount_pct" numeric(6, 3);
ALTER TABLE "voucher_entries" ADD COLUMN "narration" text;
ALTER TABLE "voucher_types" ADD COLUMN "allow_zero_value_entries" boolean DEFAULT false NOT NULL;
ALTER TABLE "vouchers" ADD COLUMN "is_optional" boolean DEFAULT false NOT NULL;
ALTER TABLE "vouchers" ADD COLUMN "bank_txn_type" text;
ALTER TABLE "vouchers" ADD COLUMN "reconciled_at" date;
ALTER TABLE "vouchers" ADD COLUMN "order_voucher_id" integer;
CREATE UNIQUE INDEX "vouchers_company_type_fy_number_opt_uq" ON "vouchers" USING btree ("company_id","voucher_type_id","fy","number") WHERE is_optional = true;
CREATE UNIQUE INDEX "vouchers_company_type_fy_number_uq" ON "vouchers" USING btree ("company_id","voucher_type_id","fy","number") WHERE is_optional = false;

-- R-73 (F-73-4): seed the order pair into EVERY company (existing books get
-- Tally's order-processing flow without any operator action). a/so = shared
-- Alt+F7/Alt+F6 slots, Tally's own order-voucher keys — the R-53c letter/digit
-- scheme is untouched (orders are reachable via Gateway/Day Book/palette).
INSERT INTO voucher_types (company_id, name, short_code, category, affects_stock, function_key, prefix)
SELECT c.id, 'Sale Order', 'SO', 'Accounting', false, 'Alt+F7', ''
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM voucher_types vt WHERE vt.company_id = c.id AND vt.name = 'Sale Order'
);
INSERT INTO voucher_types (company_id, name, short_code, category, affects_stock, function_key, prefix)
SELECT c.id, 'Purchase Order', 'PO', 'Accounting', false, 'Alt+F7', ''
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM voucher_types vt WHERE vt.company_id = c.id AND vt.name = 'Purchase Order'
);
