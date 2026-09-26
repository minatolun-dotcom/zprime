// One-shot R-68 helper: produce the 0017 migration through drizzle-kit's
// programmatic API (gen-0011/0012/0013 precedent). prev := current code minus
// the R-68 columns → the diff contains exactly the two ALTER statements.
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
const prev0016 = JSON.parse(fs.readFileSync(path.join(metaDir, "0016_snapshot.json"), "utf8"));

const schema = await import("../src/db/schema.js");
const cur: any = generateDrizzleJson(schema);

// prev := current code minus the R-68 additions.
const prev: any = JSON.parse(JSON.stringify(cur));
delete prev.tables["public.irp_submissions"].columns["signed_qr_code"];
delete prev.tables["public.irp_submissions"].columns["signed_invoice"];

const stmts: string[] = await generateMigration(prev, cur);
const body = stmts.map((s: string) => s.replace(/;+\s*$/, ";")).join("\n");

const sql = `-- R-68: e-invoice IRP signature artifacts — NIC's GENIRN response carries
-- SignedQRCode (the IRP-signed QR payload printed on a B2B e-invoice face)
-- and SignedInvoice (the offline-verifiable signed invoice JSON). Both were
-- previously buried in the verbatim response jsonb only; they are now
-- first-class, queryable columns seeded on the accepted GENIRN path.
-- Additive only: two nullable columns; no backfill (pre-R-68 rows keep null
-- and render no QR, honestly); verbatim response contract unchanged.
-- Generated via drizzle-kit's programmatic API (see scripts/gen-0017.ts).
${body}
`;

// Chain the new snapshot onto 0016.
cur.prevId = prev0016.id;
const snapshot = JSON.stringify(cur, null, "\t");

const journal = JSON.parse(fs.readFileSync(path.join(metaDir, "_journal.json"), "utf8"));
if (journal.entries.length !== 17) throw new Error(`journal has ${journal.entries.length} entries, expected 17`);
journal.entries.push({
  idx: 17,
  version: "7",
  when: Date.now(),
  tag: "0017_r68_signed_qr",
  breakpoints: true,
});

fs.writeFileSync(path.join(drizzleDir, "0017_r68_signed_qr.sql"), sql);
fs.writeFileSync(path.join(metaDir, "0017_snapshot.json"), snapshot);
fs.writeFileSync(path.join(metaDir, "_journal.json"), JSON.stringify(journal, null, "\t"));
console.log("wrote: 0017_r68_signed_qr.sql, meta/0017_snapshot.json, journal idx 17");
console.log("--- sql ---");
console.log(sql);
