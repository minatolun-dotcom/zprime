// One-shot R-28 helper: produce the 0012 migration through drizzle-kit's
// programmatic API, bypassing `drizzle-kit generate`'s folder validator
// (pre-existing incompatibility, see R-27 investigation §5 and the working
// gen-0011.ts precedent).
//
// Same discipline as gen-0011: prev := current code minus the R-28 additions
// → every unchanged table is byte-identical to cur, so the diff contains
// exactly the R-28 statements. SQL of 0000-0011 is untouched; runtime
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
const prev0011 = JSON.parse(fs.readFileSync(path.join(metaDir, "0011_snapshot.json"), "utf8"));

const schema = await import("../src/db/schema.js");
const cur: any = generateDrizzleJson(schema);

// prev := current code minus the R-28 additions.
const prev: any = JSON.parse(JSON.stringify(cur));
delete prev.tables["public.irp_credentials"];
delete prev.tables["public.irp_submissions"];

const stmts: string[] = await generateMigration(prev, cur);
const body = stmts.map((s: string) => s.replace(/;+\s*$/, ";")).join("\n");

const sql = `-- R-28: IRP/EWB connectivity (opt-in) — per-company credentials stored
-- AES-256-GCM encrypted at rest, and the submission ledger that satisfies the
-- legal duty to persist the IRN ("an invoice without IRN will not be a legal
-- document"). Additive only: two new tables; no destructive SQL; no data
-- backfill (no company has credentials until an operator configures them).
-- Generated via drizzle-kit's programmatic API (see scripts/gen-0012.ts).
${body}
`;

// Chain the new snapshot onto 0011.
cur.prevId = prev0011.id;
const snapshot = JSON.stringify(cur, null, "\t");

const journal = JSON.parse(fs.readFileSync(path.join(metaDir, "_journal.json"), "utf8"));
if (journal.entries.length !== 12) throw new Error(`journal has ${journal.entries.length} entries, expected 12`);
journal.entries.push({
  idx: 12,
  version: "7",
  when: Date.now(),
  tag: "0012_r28_irp_connectivity",
  breakpoints: true,
});

fs.writeFileSync(path.join(drizzleDir, "0012_r28_irp_connectivity.sql"), sql);
fs.writeFileSync(path.join(metaDir, "0012_snapshot.json"), snapshot);
fs.writeFileSync(path.join(metaDir, "_journal.json"), JSON.stringify(journal, null, "\t"));
console.log("wrote: 0012_r28_irp_connectivity.sql, meta/0012_snapshot.json, journal idx 12");
console.log("--- sql ---");
console.log(sql);
