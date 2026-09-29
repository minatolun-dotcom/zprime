// One-shot R-83 helper: produce the 0020 migration through drizzle-kit's
// programmatic API (gen-0011…gen-0018 precedent). prev := current code minus
// the R-83 addition → the diff contains exactly the R-83 statement.
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
const prev0019 = JSON.parse(fs.readFileSync(path.join(metaDir, "0019_snapshot.json"), "utf8"));

const schema = await import("../src/db/schema.js");
const cur: any = generateDrizzleJson(schema);

// prev := current code minus the R-83 addition.
const prev: any = JSON.parse(JSON.stringify(cur));
delete prev.tables["public.vouchers"].columns["invoice_details"];

const stmts: string[] = await generateMigration(prev, cur);
const body = stmts.map((s: string) => s.replace(/;+\s*$/, ";")).join("\n");

const sql = `-- R-83 (Option A, F-83-4): Tally's descriptive invoice details —
-- the Party (buyer address override / consignee ship-to), Dispatch (dispatch
-- doc no, through, destination, carrier LR-RR, vehicle no., ports of
-- loading/discharge, marks/container no., no. of packages) and Order (buyer
-- order no/date, mode/terms of payment, other references, terms of delivery)
-- screens Tally toggles per voucher on invoice-class entries. ADDITIVE ONLY,
-- no destructive SQL, no backfill: NULL = the voucher carries none (every
-- pre-R-83 row). Purely descriptive — validated/shaped by routes.lib, never
-- read by the accounting engine; the printable invoice face renders it.
-- Generated via drizzle-kit's programmatic API (see scripts/gen-0020.ts).
${body}
`;

// Chain the new snapshot onto 0019.
cur.prevId = prev0019.id;
const snapshot = JSON.stringify(cur, null, "\t");

const journal = JSON.parse(fs.readFileSync(path.join(metaDir, "_journal.json"), "utf8"));
// Idempotent: drop any earlier idx-20 attempt before appending (re-runs happen
// while the schema definition settles).
journal.entries = journal.entries.filter((e: any) => e.tag !== "0020_r83_invoice_details");
if (journal.entries.length !== 20) throw new Error(`journal has ${journal.entries.length} entries, expected 20`);
journal.entries.push({
  idx: 20,
  version: "7",
  when: Date.now(),
  tag: "0020_r83_invoice_details",
  breakpoints: true,
});

fs.writeFileSync(path.join(drizzleDir, "0020_r83_invoice_details.sql"), sql);
fs.writeFileSync(path.join(metaDir, "0020_snapshot.json"), snapshot);
fs.writeFileSync(path.join(metaDir, "_journal.json"), JSON.stringify(journal, null, "\t"));
console.log("wrote: 0020_r83_invoice_details.sql, meta/0020_snapshot.json, journal idx 20");
console.log("--- sql ---");
console.log(sql);
