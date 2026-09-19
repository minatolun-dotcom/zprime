// One-shot R-27 helper: produce the 0011 migration through drizzle-kit's
// programmatic API, bypassing `drizzle-kit generate`'s folder validator
// (which rejects every snapshot >=0003 as "malformed" — a pre-existing
// incompatibility, see R-27 investigation §5).
//
// The prev snapshot is built from the CURRENT schema source with the R-27
// additions reverted (instead of the hand-authored 0010 file, whose index/
// audit metadata drifted from code and would emit index drop/recreate and
// audit_events ALTER noise). Result: a diff containing exactly the R-27
// statements. SQL of 0000-0010 is untouched; runtime migrate() unaffected.
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const req = createRequire(import.meta.url);
// Direct file path — drizzle-kit's exports map doesn't expose "./api.js".
const { generateDrizzleJson, generateMigration } = req(
  path.join(here, "..", "..", "node_modules", "drizzle-kit", "api.js"),
);

const drizzleDir = path.join(here, "..", "drizzle");
const metaDir = path.join(drizzleDir, "meta");
const prev0010 = JSON.parse(fs.readFileSync(path.join(metaDir, "0010_snapshot.json"), "utf8"));

const schema = await import("../src/db/schema.js");
const cur: any = generateDrizzleJson(schema);

// prev := current code minus the R-27 additions → every unchanged table is
// byte-identical to cur, so the diff is exactly the R-27 statements.
const prev: any = JSON.parse(JSON.stringify(cur));
delete prev.tables["public.tcs_sections"];
delete prev.tables["public.ledgers"].columns["tcs_section_id"];
delete prev.tables["public.voucher_entries"].columns["tcs_section_id"];

const stmts: string[] = await generateMigration(prev, cur);
const body = stmts.map((s) => s.replace(/;+\s*$/, ";")).join("\n");

const sql = `-- R-27: TCS (Tax Collected at Source, Income-tax s. 206C) — collection-side
-- mirror of the TDS machinery. Additive only: one new master table, two
-- snapshot columns; no destructive SQL; no accounting-data backfill.
-- Generated via drizzle-kit's programmatic API (see scripts/gen-0011.ts);
-- hand-appended idempotent seed follows the 0009 RCM precedent.
${body}

-- Idempotent seeding: every EXISTING company gets the "TCS Payable" starter
-- ledger (dutyHead='TCS') unless it already has one. The (company_id, name)
-- unique index makes double-insert impossible; WHERE NOT EXISTS makes the
-- statement safe to re-run. Deterministic and additive — no rows updated or
-- deleted, only the one master row added per company. (New companies get the
-- same ledger from seedCompanyTx in code.)
INSERT INTO "ledgers" ("company_id", "name", "group_id", "duty_head", "gst_registration_type", "taxability")
SELECT c.id, 'TCS Payable',
       (SELECT g.id FROM "groups" g WHERE g.company_id = c.id AND g.name = 'Duties & Taxes' LIMIT 1),
       'TCS', 'none', 'none'
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "ledgers" l WHERE l.company_id = c.id AND l.duty_head = 'TCS'
);
`;

// Chain the new snapshot onto 0010 (drizzle-kit mints fresh ids; prevId must
// be 0010's id for the journal chain).
cur.prevId = prev0010.id;
const snapshot = JSON.stringify(cur, null, "\t");

const journal = JSON.parse(fs.readFileSync(path.join(metaDir, "_journal.json"), "utf8"));
if (journal.entries.length !== 11) throw new Error(`journal has ${journal.entries.length} entries, expected 11`);
journal.entries.push({
  idx: 11,
  version: "7",
  when: Date.now(),
  tag: "0011_r27_tcs",
  breakpoints: true,
});

fs.writeFileSync(path.join(drizzleDir, "0011_r27_tcs.sql"), sql);
fs.writeFileSync(path.join(metaDir, "0011_snapshot.json"), snapshot);
fs.writeFileSync(path.join(metaDir, "_journal.json"), JSON.stringify(journal, null, "\t"));
console.log("wrote: 0011_r27_tcs.sql, meta/0011_snapshot.json, journal idx 11");
console.log("--- sql ---");
console.log(sql);
