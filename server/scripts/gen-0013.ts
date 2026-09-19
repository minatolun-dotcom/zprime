// One-shot R-29 helper: produce the 0013 migration through drizzle-kit's
// programmatic API, bypassing `drizzle-kit generate`'s folder validator
// (pre-existing incompatibility — see gen-0011.ts / gen-0012.ts precedent).
//
// Same discipline as gen-0012: prev := current code minus the R-29 addition
// → every unchanged table is byte-identical to cur, so the diff contains
// exactly the R-29 statement. SQL of 0000-0012 is untouched; runtime
// migrate() unaffected.
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
const prev0012 = JSON.parse(fs.readFileSync(path.join(metaDir, "0012_snapshot.json"), "utf8"));

const schema = await import("../src/db/schema.js");
const cur: any = generateDrizzleJson(schema);

// prev := current code minus the R-29 addition.
const prev: any = JSON.parse(JSON.stringify(cur));
delete prev.tables["public.irp_ewb_ops"];

const stmts: string[] = await generateMigration(prev, cur);
const body = stmts.map((s: string) => s.replace(/;+\s*$/, ";")).join("\n");

const sql = `-- R-29: EWB lifecycle operations — verbatim ledger of vehicle updates,
-- validity extensions, and cancellations against accepted e-way bills.
-- Additive only: one new table; no destructive SQL; no data backfill (no ops
-- can exist until an operator performs one). The 'cancelled' submission
-- status is a TEXT value, not DDL — documented in schema.ts.
-- Generated via drizzle-kit's programmatic API (see scripts/gen-0013.ts).
${body}
`;

// Chain the new snapshot onto 0012.
cur.prevId = prev0012.id;
const snapshot = JSON.stringify(cur, null, "\t");

const journal = JSON.parse(fs.readFileSync(path.join(metaDir, "_journal.json"), "utf8"));
if (journal.entries.length !== 13) throw new Error(`journal has ${journal.entries.length} entries, expected 13`);
journal.entries.push({
  idx: 13,
  version: "7",
  when: Date.now(),
  tag: "0013_r29_ewb_ops",
  breakpoints: true,
});

fs.writeFileSync(path.join(drizzleDir, "0013_r29_ewb_ops.sql"), sql);
fs.writeFileSync(path.join(metaDir, "0013_snapshot.json"), snapshot);
fs.writeFileSync(path.join(metaDir, "_journal.json"), JSON.stringify(journal, null, "\t"));
console.log("wrote: 0013_r29_ewb_ops.sql, meta/0013_snapshot.json, journal idx 13");
console.log("--- sql ---");
console.log(sql);
