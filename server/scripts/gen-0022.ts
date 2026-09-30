// One-shot R-83 F-83-8 helper: produce the 0022 migration through drizzle-kit's
// programmatic API (gen-0011…gen-0021 precedent). prev := current code minus
// the F-83-8 additions → the diff contains exactly the F-83-8 statements.
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
const prev0021 = JSON.parse(fs.readFileSync(path.join(metaDir, "0021_snapshot.json"), "utf8"));

const schema = await import("../src/db/schema.js");
const cur: any = generateDrizzleJson(schema);

// prev := current code minus the F-83-8 additions.
const prev: any = JSON.parse(JSON.stringify(cur));
delete prev.tables["public.ledgers"].columns["track_cost_centre"];
delete prev.tables["public.cost_categories"];
delete prev.tables["public.cost_centres"];
delete prev.tables["public.voucher_cost_allocations"];

const stmts: string[] = await generateMigration(prev, cur);
const body = stmts.map((s: string) => s.replace(/;+\s*$/, ";")).join("\n");

const sql = `-- R-83 (F-83-8): Tally F11 Cost Centres — the two-level master
-- (cost_categories -> cost_centres; a NULL category = Tally's "Primary Cost
-- Category"), the per-ledger opt-in (ledgers.track_cost_centre, Tally's
-- "Cost centres are applicable" — default false, every existing ledger
-- unaffected) and the per-row allocation dimension
-- (voucher_cost_allocations, entry-cascade). ADDITIVE ONLY, no destructive
-- SQL, no backfill. An allocation is a DIMENSION of the posting, never a
-- second posting: the voucher write path enforces that a row's allocations
-- sum to the row's signed amount, so the trial balance cannot move.
-- Generated via drizzle-kit's programmatic API (see scripts/gen-0022.ts).
${body}
`;

// Chain the new snapshot onto 0021.
cur.prevId = prev0021.id;
const snapshot = JSON.stringify(cur, null, "\t");

const journal = JSON.parse(fs.readFileSync(path.join(metaDir, "_journal.json"), "utf8"));
// Idempotent: drop any earlier idx-22 attempt before appending (re-runs happen
// while the schema definition settles).
journal.entries = journal.entries.filter((e: any) => e.tag !== "0022_r83_cost_centres");
if (journal.entries.length !== 22) throw new Error(`journal has ${journal.entries.length} entries, expected 22`);
journal.entries.push({
  idx: 22,
  version: "7",
  when: Date.now(),
  tag: "0022_r83_cost_centres",
  breakpoints: true,
});

fs.writeFileSync(path.join(drizzleDir, "0022_r83_cost_centres.sql"), sql);
fs.writeFileSync(path.join(metaDir, "0022_snapshot.json"), snapshot);
fs.writeFileSync(path.join(metaDir, "_journal.json"), JSON.stringify(journal, null, "\t"));
console.log("wrote: 0022_r83_cost_centres.sql, meta/0022_snapshot.json, journal idx 22");
console.log("--- sql ---");
console.log(sql);
