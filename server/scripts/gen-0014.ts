// One-shot R-30 helper: produce the 0014 migration through drizzle-kit's
// programmatic API (same discipline as gen-0011/0012/0013 — bypasses
// `drizzle-kit generate`'s folder validator, pre-existing incompatibility).
//
// prev := current code minus the R-30 addition → every unchanged table is
// byte-identical to cur, so the diff contains exactly the R-30 statements.
// SQL of 0000-0013 is untouched; runtime migrate() unaffected.
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
const prev0013 = JSON.parse(fs.readFileSync(path.join(metaDir, "0013_snapshot.json"), "utf8"));

const schema = await import("../src/db/schema.js");
const cur: any = generateDrizzleJson(schema);

// prev := current code minus the R-30 columns.
const prev: any = JSON.parse(JSON.stringify(cur));
for (const col of ["ewb_username", "ewb_password_enc"]) {
  delete prev.tables["public.irp_credentials"].columns[col];
}

const stmts: string[] = await generateMigration(prev, cur);
const body = stmts.map((s: string) => s.replace(/;+\s*$/, ";")).join("\n");

const sql = `-- R-30: direct e-way bill generation (non-IRN) — the NIC EWB-API is a
-- SEPARATE portal from the e-invoice IRP and needs its own credentials
-- (the taxpayer's ewaybillgst.gov.in username/password). Additive only:
-- two nullable columns on irp_credentials; NULL = EWB-from-IRN only (B2B),
-- the pre-R-30 behavior exactly. No destructive SQL, no backfill.
-- Generated via drizzle-kit's programmatic API (see scripts/gen-0014.ts).
${body}
`;

// Chain the new snapshot onto 0013.
cur.prevId = prev0013.id;
const snapshot = JSON.stringify(cur, null, "\t");

const journal = JSON.parse(fs.readFileSync(path.join(metaDir, "_journal.json"), "utf8"));
if (journal.entries.length !== 14) throw new Error(`journal has ${journal.entries.length} entries, expected 14`);
journal.entries.push({
  idx: 14,
  version: "7",
  when: Date.now(),
  tag: "0014_r30_ewb_direct",
  breakpoints: true,
});

fs.writeFileSync(path.join(drizzleDir, "0014_r30_ewb_direct.sql"), sql);
fs.writeFileSync(path.join(metaDir, "0014_snapshot.json"), snapshot);
fs.writeFileSync(path.join(metaDir, "_journal.json"), JSON.stringify(journal, null, "\t"));
console.log("wrote: 0014_r30_ewb_direct.sql, meta/0014_snapshot.json, journal idx 14");
