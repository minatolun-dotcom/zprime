// One-shot R-57 helper: produce the 0016 migration through drizzle-kit's
// programmatic API (same discipline as gen-0011…0015 — bypasses
// `drizzle-kit generate`'s folder validator, pre-existing incompatibility).
//
// prev := current code minus the R-57 additions → every unchanged table is
// byte-identical to cur, so the diff contains exactly the R-57 statements.
// SQL of 0000-0015 is untouched; runtime migrate() unaffected.
//
// R-57 (R-55 Option B): voucher-numbering periodicity per voucher type —
// Tally's "voucher numbering restarts each financial year" behaviour.
// fy is NOT NULL DEFAULT '': the never-bucket must be a REAL value — a NULL
// bucket would defeat the unique indexes (SQL treats NULLs as distinct),
// splitting the never-series across divergent counter rows (live-reproduced:
// ~20 counter rows for one (company,type) pair, auto-numbers diverged, 409
// storms). '' also makes the v1.52.0 upgrade path correct with no backfill:
// existing vouchers/counters all land in the '' (never) bucket, which is
// exactly their pre-R-57 series.
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
const prev0015 = JSON.parse(fs.readFileSync(path.join(metaDir, "0015_snapshot.json"), "utf8"));

const schema = await import("../src/db/schema.js");
const cur: any = generateDrizzleJson(schema);

// prev := current code minus the R-57 additions.
const prev: any = JSON.parse(JSON.stringify(cur));
delete prev.tables["public.voucher_types"].columns["numbering_periodicity"];
delete prev.tables["public.vouchers"].columns["fy"];
delete prev.tables["public.voucher_counters"].columns["fy"];
// The old single-counter uniqueness (no fy dimension) and the old voucher
// number uniqueness (type + number, no fy) are replaced by FY-scoped indexes.
delete prev.tables["public.vouchers"].indexes["vouchers_company_type_number_uq"];
delete prev.tables["public.voucher_counters"].indexes["counter_company_type_uq"];

const stmts: string[] = await generateMigration(prev, cur);
const body = stmts.map((s: string) => s.replace(/;+\s*$/, ";")).join("\n");

const sql = `-- R-57 (R-55 Option B): voucher-numbering periodicity per voucher type —
-- Tally's "voucher numbering restarts each financial year" behaviour.
-- ADDITIVE ONLY, no destructive SQL, no backfill required:
--   voucher_types.numbering_periodicity:
--     'never'  (default) — the pre-Option-B single never-resetting counter,
--               byte-identical behaviour for every existing type
--     'fiscal' — the automatic counter restarts each financial year
--   vouchers.fy / voucher_counters.fy: the numbering bucket — the FY key
--   (fiscal-year BEGIN date, e.g. '2026-04-01') for 'fiscal' types, '' for
--   'never' types. NOT NULL DEFAULT '': on upgrade every existing row lands
--   in the '' bucket, which is exactly its pre-R-57 series; a NULL bucket
--   would defeat the unique indexes (SQL treats NULLs as distinct).
-- Indexes gain the fy dimension so two FYs can each restart at 1:
--   vouchers (company, type, fy, number) unique — manual numbers can repeat
--   across FYs of a fiscal type but never within one bucket (incl. never);
--   counters (company, type, fy) unique — exactly one counter row per bucket.
-- Generated via drizzle-kit's programmatic API (see scripts/gen-0016.ts).
${body}
`;

// Chain the new snapshot onto 0015 (idempotent: drop any earlier 0016 entry
// from a previous run of this generator).
cur.prevId = prev0015.id;
const snapshot = JSON.stringify(cur, null, "\t");

const journal = JSON.parse(fs.readFileSync(path.join(metaDir, "_journal.json"), "utf8"));
journal.entries = journal.entries.filter((e: any) => e.tag !== "0016_r57_numbering_periodicity");
if (journal.entries.length !== 16) throw new Error(`journal has ${journal.entries.length} entries, expected 16`);
journal.entries.push({
  idx: 16,
  version: "7",
  when: Date.now(),
  tag: "0016_r57_numbering_periodicity",
  breakpoints: true,
});

fs.writeFileSync(path.join(drizzleDir, "0016_r57_numbering_periodicity.sql"), sql);
fs.writeFileSync(path.join(metaDir, "0016_snapshot.json"), snapshot);
fs.writeFileSync(path.join(metaDir, "_journal.json"), JSON.stringify(journal, null, "\t"));

console.log("0016_r57_numbering_periodicity.sql written:\n" + body);
