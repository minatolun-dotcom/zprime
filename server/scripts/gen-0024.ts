// One-shot R-85 helper: produce the 0024 migration through drizzle-kit's
// programmatic API (gen-0011…gen-0023 precedent). prev := current code minus
// the R-85 additions → the diff contains exactly the R-85 statements.
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
const prev0023 = JSON.parse(fs.readFileSync(path.join(metaDir, "0023_snapshot.json"), "utf8"));

const schema = await import("../src/db/schema.js");
const cur: any = generateDrizzleJson(schema);

// prev := current code minus the R-85 additions.
const prev: any = JSON.parse(JSON.stringify(cur));
delete prev.tables["public.users"].columns["is_admin"];
delete prev.tables["public.backup_settings"];
delete prev.tables["public.backup_runs"];

const stmts: string[] = await generateMigration(prev, cur);
const body = stmts.map((s) => s.replace(/;+\s*$/, ";")).join("\n");

const sql = `-- R-85: in-app backups to Google Drive (UpdraftPlus-style), restore included.
-- Deployment-level backup settings (singleton), run history, and the
-- deployment-level admin flag (users.is_admin — backups are instance-wide,
-- so configuring/running/restoring them is admin-only; company membership
-- does not confer it). All additive, zero backfill except: the FIRST user
-- (min(id)) is the seeded operator — is_admin true for them, every other
-- existing row honest as non-admin until promoted in Company Settings.
${body}
UPDATE "users" SET "is_admin" = true WHERE "id" = (SELECT min("id") FROM "users");
`;

// Chain the new snapshot onto 0023.
cur.prevId = prev0023.id;
const snapshot = JSON.stringify(cur, null, "\t");

const journal = JSON.parse(fs.readFileSync(path.join(metaDir, "_journal.json"), "utf8"));
// Idempotent: drop any earlier idx-24 attempt before appending.
journal.entries = journal.entries.filter((e: any) => e.tag !== "0024_r85_backups");
if (journal.entries.length !== 24) throw new Error(`journal has ${journal.entries.length} entries, expected 24`);
journal.entries.push({
  idx: 24,
  version: "7",
  when: Date.now(),
  tag: "0024_r85_backups",
  breakpoints: true,
});

fs.writeFileSync(path.join(drizzleDir, "0024_r85_backups.sql"), sql);
fs.writeFileSync(path.join(metaDir, "0024_snapshot.json"), snapshot);
fs.writeFileSync(path.join(metaDir, "_journal.json"), JSON.stringify(journal, null, "\t"));
console.log("wrote: 0024_r85_backups.sql, meta/0024_snapshot.json, journal idx 24");
console.log("--- sql ---");
console.log(sql);
