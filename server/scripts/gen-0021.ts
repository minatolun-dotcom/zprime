// One-shot R-83 F-83-7 helper: produce the 0021 migration through drizzle-kit's
// programmatic API (gen-0011…gen-0020 precedent). prev := current code minus
// the F-83-7 addition → the diff contains exactly the F-83-7 statement.
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
const prev0020 = JSON.parse(fs.readFileSync(path.join(metaDir, "0020_snapshot.json"), "utf8"));

const schema = await import("../src/db/schema.js");
const cur: any = generateDrizzleJson(schema);

// prev := current code minus the F-83-7 addition.
const prev: any = JSON.parse(JSON.stringify(cur));
delete prev.tables["public.vouchers"].columns["bank_ref_id"];
delete prev.tables["public.vouchers"].columns["is_post_dated"];

const stmts: string[] = await generateMigration(prev, cur);
const body = stmts.map((s: string) => s.replace(/;+\s*$/, ";")).join("\n");

const sql = `-- R-83 (F-83-7): Tally's Bank Allocation "Ref ID" plus the post-dated
-- class (Ctrl+T). bank_ref_id = the bank-side reference (transaction/reference
-- id on RTGS/NEFT/UPI/other instruments, printed on the pay-in slip /
-- statement line) keyed per voucher alongside cheque_number/cheque_date and
-- reconciled_at (BRS). is_post_dated = advisory-only class flag — the voucher
-- posts normally; the Cheque Register derives pdc/due/cleared/open from it +
-- instrument date + reconciliation. ADDITIVE ONLY, no destructive SQL, no
-- backfill: NULL = no bank reference, false = not post-dated (every pre-R-83
-- row). Free short text validated by routes.lib — zprime never parses or
-- verifies it (no third-party banking in the threat model).
-- Generated via drizzle-kit's programmatic API (see scripts/gen-0021.ts).
${body}
`;

// Chain the new snapshot onto 0020.
cur.prevId = prev0020.id;
const snapshot = JSON.stringify(cur, null, "\t");

const journal = JSON.parse(fs.readFileSync(path.join(metaDir, "_journal.json"), "utf8"));
// Idempotent: drop any earlier idx-21 attempt before appending (re-runs happen
// while the schema definition settles).
journal.entries = journal.entries.filter((e: any) => e.tag !== "0021_r83_bank_ref_id");
if (journal.entries.length !== 21) throw new Error(`journal has ${journal.entries.length} entries, expected 21`);
journal.entries.push({
  idx: 21,
  version: "7",
  when: Date.now(),
  tag: "0021_r83_bank_ref_id",
  breakpoints: true,
});

fs.writeFileSync(path.join(drizzleDir, "0021_r83_bank_ref_id.sql"), sql);
fs.writeFileSync(path.join(metaDir, "0021_snapshot.json"), snapshot);
fs.writeFileSync(path.join(metaDir, "_journal.json"), JSON.stringify(journal, null, "\t"));
console.log("wrote: 0021_r83_bank_ref_id.sql, meta/0021_snapshot.json, journal idx 21");
console.log("--- sql ---");
console.log(sql);
