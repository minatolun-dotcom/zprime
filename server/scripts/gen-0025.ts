// One-shot R-88 helper: produce the 0025 migration through drizzle-kit's
// programmatic API (gen-0011..gen-0024 precedent). prev := current code minus
// the R-88 additions -> the diff contains exactly the R-88 statements.
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
const prev0024 = JSON.parse(fs.readFileSync(path.join(metaDir, "0024_snapshot.json"), "utf8"));

const schema = await import("../src/db/schema.js");
const cur: any = generateDrizzleJson(schema);

// prev := current code minus the R-88 additions.
const prev: any = JSON.parse(JSON.stringify(cur));
delete prev.tables["public.backup_runs"].columns["scope_kind"];
delete prev.tables["public.backup_runs"].columns["company_id"];
// prev has no backup_runs indexes that mention company_id/scope_kind either.
delete prev.tables["public.backup_runs"].indexes["backup_runs_company_scope_idx"];

const stmts: string[] = await generateMigration(prev, cur);
const body = stmts.map((s) => s.replace(/;+\s*$/, ";")).join("\n");

const sql = `-- R-88: per-company (manual) backup/restore — scope bookkeeping on the
-- existing deployment-level run history. Additive only.
--
-- Extend backup_runs with a scope dimension so the same audit trail records
-- both deployment-wide runs (current behavior, scope_kind = 'deployment') and
-- per-company runs (scope_kind = 'company', company_id populated). Existing
-- rows are all deployment runs -> set scope_kind = 'deployment' once; every
-- future company run carries its cid. company_id is nullable (deployment rows
-- have none) and FK'd to companies so a removed company leaves its run rows
-- intact (set null) rather than cascading them away.
--
-- Why extend the existing table rather than add a second one: the audit trail
-- is "everything this deployment's backup subsystem did", and scope is a
-- property of a run, not a separate subsystem. One history table to render
-- and to assert on; the UI filters by scope_kind (+ company_id for company
-- runs) and the restore engine reads scope_kind to choose the restore path.
${body}
UPDATE "backup_runs" SET "scope_kind" = 'deployment' WHERE "scope_kind" IS NULL;
`;

// Chain the new snapshot onto 0024.
cur.prevId = prev0024.id;
const snapshot = JSON.stringify(cur, null, "\t");

const journal = JSON.parse(fs.readFileSync(path.join(metaDir, "_journal.json"), "utf8"));
// Idempotent: drop any earlier idx-25 attempt before appending.
journal.entries = journal.entries.filter((e: any) => e.tag !== "0025_r88_company_backups");
if (journal.entries.length !== 25) throw new Error(`journal has ${journal.entries.length} entries, expected 25`);
journal.entries.push({
  idx: 25,
  version: "7",
  when: Date.now(),
  tag: "0025_r88_company_backups",
  breakpoints: true,
});

fs.writeFileSync(path.join(drizzleDir, "0025_r88_company_backups.sql"), sql);
fs.writeFileSync(path.join(metaDir, "0025_snapshot.json"), snapshot);
fs.writeFileSync(path.join(metaDir, "_journal.json"), JSON.stringify(journal, null, "\t"));
console.log("wrote: 0025_r88_company_backups.sql, meta/0025_snapshot.json, journal idx 25");
console.log("--- sql ---");
console.log(sql);
