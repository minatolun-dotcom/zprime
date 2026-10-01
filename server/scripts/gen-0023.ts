// One-shot R-84 A1 helper: produce the 0023 migration through drizzle-kit's
// programmatic API (gen-0011…gen-0022 precedent). prev := current code minus
// the A1 addition → the diff contains exactly the A1 statement.
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
const prev0022 = JSON.parse(fs.readFileSync(path.join(metaDir, "0022_snapshot.json"), "utf8"));

const schema = await import("../src/db/schema.js");
const cur: any = generateDrizzleJson(schema);

// prev := current code minus the A1 addition.
const prev: any = JSON.parse(JSON.stringify(cur));
delete prev.tables["public.vouchers"].columns["deposit_slip_printed_at"];

const stmts: string[] = await generateMigration(prev, cur);
const body = stmts.map((s: string) => s.replace(/;+\s*$/, ";")).join("\n");

const sql = `-- R-84 (A1): Tally's deposit-slip "printed" bookkeeping — the timestamp
-- when an operator printed this voucher's bank leg on a (cash/cheque) deposit
-- slip. NULL = never printed (every pre-R-84 row). The Deposit Slips page
-- lists unreconciled legs by default and can include printed ones (Tally's
-- F8 Incl-Printed parity). Operator-action-stamped only, never inferred.
-- Generated via drizzle-kit's programmatic API (see scripts/gen-0023.ts).
${body}
`;

// Chain the new snapshot onto 0022.
cur.prevId = prev0022.id;
const snapshot = JSON.stringify(cur, null, "\t");

const journal = JSON.parse(fs.readFileSync(path.join(metaDir, "_journal.json"), "utf8"));
// Idempotent: drop any earlier idx-23 attempt before appending (re-runs happen
// while the schema definition settles).
journal.entries = journal.entries.filter((e: any) => e.tag !== "0023_r84_deposit_slip_printed");
if (journal.entries.length !== 23) throw new Error(`journal has ${journal.entries.length} entries, expected 23`);
journal.entries.push({
  idx: 23,
  version: "7",
  when: Date.now(),
  tag: "0023_r84_deposit_slip_printed",
  breakpoints: true,
});

fs.writeFileSync(path.join(drizzleDir, "0023_r84_deposit_slip_printed.sql"), sql);
fs.writeFileSync(path.join(metaDir, "0023_snapshot.json"), snapshot);
fs.writeFileSync(path.join(metaDir, "_journal.json"), JSON.stringify(journal, null, "\t"));
console.log("wrote: 0023_r84_deposit_slip_printed.sql, meta/0023_snapshot.json, journal idx 23");
console.log("--- sql ---");
console.log(sql);
