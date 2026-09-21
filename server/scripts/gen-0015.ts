// One-shot R-33 helper: produce the 0015 migration through drizzle-kit's
// programmatic API (same discipline as gen-0011…0014 — bypasses
// `drizzle-kit generate`'s folder validator, pre-existing incompatibility).
//
// prev := current code minus the R-33 addition → every unchanged table is
// byte-identical to cur, so the diff contains exactly the R-33 statements.
// SQL of 0000-0014 is untouched; runtime migrate() unaffected.
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
const prev0014 = JSON.parse(fs.readFileSync(path.join(metaDir, "0014_snapshot.json"), "utf8"));

const schema = await import("../src/db/schema.js");
const cur: any = generateDrizzleJson(schema);

// prev := current code minus the R-33 columns.
const prev: any = JSON.parse(JSON.stringify(cur));
for (const table of ["public.tds_sections", "public.tcs_sections"]) {
  delete prev.tables[table].columns["threshold_mode"];
}

const stmts: string[] = await generateMigration(prev, cur);
const body = stmts.map((s: string) => s.replace(/;+\s*$/, ";")).join("\n");

const sql = `-- R-33: TDS/TCS threshold advisories — one nullable column per section
-- master recording how the threshold legally binds ('single' per payment,
-- 'aggregate' per payee per FY, NULL = advisory wording only). ADDITIVE and
-- ADVISORY-ONLY: nothing in zprime blocks a voucher on a threshold (R-33
-- Option A — the operator judges; the books record). No destructive SQL,
-- no backfill (NULL = pre-R-33 advisory wording, byte-identical).
-- Generated via drizzle-kit's programmatic API (see scripts/gen-0015.ts).
${body}
`;

// Chain the new snapshot onto 0014.
cur.prevId = prev0014.id;
const snapshot = JSON.stringify(cur, null, "\t");

const journal = JSON.parse(fs.readFileSync(path.join(metaDir, "_journal.json"), "utf8"));
if (journal.entries.length !== 15) throw new Error(`journal has ${journal.entries.length} entries, expected 15`);
journal.entries.push({
  idx: 15,
  version: "7",
  when: Date.now(),
  tag: "0015_r33_threshold_mode",
  breakpoints: true,
});

fs.writeFileSync(path.join(drizzleDir, "0015_r33_threshold_mode.sql"), sql);
fs.writeFileSync(path.join(metaDir, "0015_snapshot.json"), snapshot);
fs.writeFileSync(path.join(metaDir, "_journal.json"), JSON.stringify(journal, null, "\t"));

console.log("0015_r33_threshold_mode.sql written:", body.trim() || "(no statements)");
