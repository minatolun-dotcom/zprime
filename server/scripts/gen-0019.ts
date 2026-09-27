// One-shot R-74 helper: produce the 0019 migration through drizzle-kit's
// programmatic API (gen-0011…gen-0018 precedent). prev := current code minus
// the R-74 addition → the diff contains exactly the one R-74 statement.
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
const prev0018 = JSON.parse(fs.readFileSync(path.join(metaDir, "0018_snapshot.json"), "utf8"));

const schema = await import("../src/db/schema.js");
const cur: any = generateDrizzleJson(schema);

// prev := current code minus the R-74 addition.
const prev: any = JSON.parse(JSON.stringify(cur));
delete prev.tables["public.companies"].columns["logo"];

const stmts: string[] = await generateMigration(prev, cur);
const body = stmts.map((s: string) => s.replace(/;+\s*$/, ";")).join("\n");

const sql = `-- R-74: company logo for prints (invoice face + report print headers).
-- Additive only — one nullable bytea column; no backfill, no data change.
-- The client canvas-converts ANY uploaded image to a canonical ≤512px PNG
-- before upload, so the server stores/validates PNG bytes only (no native
-- image-processing dependency server-side). Served by GET /api/companies/:id/logo.
-- Generated via drizzle-kit's programmatic API (see scripts/gen-0019.ts).
${body}
`;

// Chain the new snapshot onto 0018.
cur.prevId = prev0018.id;
const snapshot = JSON.stringify(cur, null, "\t");

const journal = JSON.parse(fs.readFileSync(path.join(metaDir, "_journal.json"), "utf8"));
// Idempotent: drop any earlier idx-19 attempt before appending (re-runs happen
// while the schema definition settles).
journal.entries = journal.entries.filter((e: any) => e.tag !== "0019_r74_company_logo");
if (journal.entries.length !== 19) throw new Error(`journal has ${journal.entries.length} entries, expected 19`);
journal.entries.push({
  idx: 19,
  version: "7",
  when: Date.now(),
  tag: "0019_r74_company_logo",
  breakpoints: true,
});

fs.writeFileSync(path.join(drizzleDir, "0019_r74_company_logo.sql"), sql);
fs.writeFileSync(path.join(metaDir, "0019_snapshot.json"), snapshot);
fs.writeFileSync(path.join(metaDir, "_journal.json"), JSON.stringify(journal, null, "\t"));
console.log("wrote: 0019_r74_company_logo.sql, meta/0019_snapshot.json, journal idx 19");
console.log("--- sql ---");
console.log(sql);
