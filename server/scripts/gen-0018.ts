// One-shot R-73 helper: produce the 0018 migration through drizzle-kit's
// programmatic API (gen-0011…gen-0017 precedent). prev := current code minus
// the R-73 additions → the diff contains exactly the R-73 statements.
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const req = createRequire(import.meta.url);
const { generateDrizzleJson, generateMigration } = req(
  path.join(here, "..", "..", "node_modules", "drizzle-kit", "api.js"),
);

const drizzleDir = path.join(here, "..", "drizzle");
const metaDir = path.join(drizzleDir, "meta");
const prev0017 = JSON.parse(fs.readFileSync(path.join(metaDir, "0017_snapshot.json"), "utf8"));

const schema = await import("../src/db/schema.js");
const cur: any = generateDrizzleJson(schema);

// prev := current code minus the R-73 additions.
const prev: any = JSON.parse(JSON.stringify(cur));
delete prev.tables["public.vouchers"].columns["is_optional"];
delete prev.tables["public.vouchers"].columns["bank_txn_type"];
delete prev.tables["public.vouchers"].columns["order_voucher_id"];
delete prev.tables["public.vouchers"].columns["reconciled_at"];
delete prev.tables["public.voucher_entries"].columns["narration"];
delete prev.tables["public.inventory_entries"].columns["discount_pct"];
delete prev.tables["public.voucher_types"].columns["allow_zero_value_entries"];
// Index swap: the posted-voucher uniqueness gains its class WHERE clause and a
// sibling optional-class unique index appears (R-73 F-73-1).
const prevUq = prev.tables["public.vouchers"].indexes["vouchers_company_type_fy_number_uq"];
delete prevUq.where;
delete prev.tables["public.vouchers"].indexes["vouchers_company_type_fy_number_opt_uq"];

const stmts: string[] = await generateMigration(prev, cur);
const body = stmts.map((s: string) => s.replace(/;+\s*$/, ";")).join("\n");

const sql = `-- R-73: voucher feature batch (operator-approved findings F-73-1..F-73-7).
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
${body}

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
`;

// Chain the new snapshot onto 0017.
cur.prevId = prev0017.id;
const snapshot = JSON.stringify(cur, null, "\t");

const journal = JSON.parse(fs.readFileSync(path.join(metaDir, "_journal.json"), "utf8"));
// Idempotent: drop any earlier idx-18 attempt before appending (re-runs happen
// while the schema definition settles).
journal.entries = journal.entries.filter((e: any) => e.tag !== "0018_r73_voucher_features");
if (journal.entries.length !== 18) throw new Error(`journal has ${journal.entries.length} entries, expected 18`);
journal.entries.push({
  idx: 18,
  version: "7",
  when: Date.now(),
  tag: "0018_r73_voucher_features",
  breakpoints: true,
});

fs.writeFileSync(path.join(drizzleDir, "0018_r73_voucher_features.sql"), sql);
fs.writeFileSync(path.join(metaDir, "0018_snapshot.json"), snapshot);
fs.writeFileSync(path.join(metaDir, "_journal.json"), JSON.stringify(journal, null, "\t"));
console.log("wrote: 0018_r73_voucher_features.sql, meta/0018_snapshot.json, journal idx 18");
console.log("--- sql ---");
console.log(sql);
