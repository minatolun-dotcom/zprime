import { db } from "../db/index.js";
import { and, eq, ilike, or } from "drizzle-orm";
import { cid, bad, pgFriendly, pgCode, trimStrings } from "../lib/routes.js";
import type { z } from "zod";
import { groupSchema, tdsSectionSchema } from "../lib/routes.js";
import { groups, ledgers, units, stockGroups, stockCategories } from "../db/schema.js";

/** Field caps for the generic CRUD path: reject oversized strings with a
 *  400 instead of truncating silently (truncation would corrupt names).
 *  name-ish fields cap at 200, all other strings at 1000. */
const NAME_FIELDS = new Set(["name", "symbol", "section", "shortCode", "username"]);
function capFields(data: any): any {
  if (data && typeof data === "object") {
    for (const [k, v] of Object.entries(data)) {
      if (typeof v === "string") {
        const max = NAME_FIELDS.has(k) ? 200 : 1000;
        if (v.length > max) throw bad(`Field "${k}" is too long (max ${max} characters)`);
      }
    }
  }
  return data;
}

/** A master with a blank identifying name is invalid — reject with a clear 400
 *  (after trimming, "" and "   " must not reach the DB or the unique index). */
function requireName(data: any): any {
  if (data && typeof data === "object") {
    for (const k of NAME_FIELDS) {
      if (k in data && (data[k] === "" || data[k] === null || data[k] === undefined)) {
        throw bad(k === "name" ? "Name is required" : `Field "${k}" is required`);
      }
    }
  }
  return data;
}

type Table = any;

/** R-08 (F-08-1): company-scope validation for master FK references.
 *  The schema-level FKs (ledgers.group_id, stock_items.unit_id, ...) are global,
 *  so without this check a POST/PUT body could silently reference another
 *  company's master. Downstream that is accounting corruption, not just odd
 *  input: a payroll entry posted against a foreign ledger is invisible to BOTH
 *  companies' reports (ledgerBalances is company-join-scoped) and the trial
 *  balance goes unbalanced, silently (live-reproduced in R-08_INVESTIGATION.md).
 *  The voucher path has enforced the same rule since before R-03
 *  (assertLedgersTx/assertRefsTx); this closes the master-CRUD boundary. */
export type RefSpec = Record<string, { table: Table; label: string }>;

async function assertCompanyRefs(c: number, refs: RefSpec | undefined, data: any): Promise<void> {
  if (!refs) return;
  for (const [field, spec] of Object.entries(refs)) {
    const v = data[field];
    if (v === null || v === undefined) continue; // nullable/unset refs are fine
    const id = typeof v === "number" ? v : typeof v === "string" && /^-?\d+$/.test(v.trim()) ? parseInt(v, 10) : NaN;
    if (!Number.isFinite(id) || id <= 0) continue; // non-numeric junk is the schema's problem
    const [row] = await db.select({ id: spec.table.id }).from(spec.table).where(and(eq(spec.table.companyId, c), eq(spec.table.id, id)));
    if (!row) throw bad(`${spec.label} does not exist in this company`);
  }
}

export function crud(
  app: any,
  name: string,
  table: Table,
  opts: {
    orderBy?: (a: any, b: any) => number;
    searchFields?: any[];
    forbidDeleteReserved?: string;
    /** Zod schema applied to POST/PUT bodies before insert (validated at the trust boundary). */
    schema?: z.ZodTypeAny;
    /** Domain hook applied after schema validation (e.g. derive nature from parent). */
    beforeSave?: (data: any, companyId: number) => Promise<any>;
    /** R-08: FK fields that must reference rows of the SAME company. */
    refs?: RefSpec;
  } = {}
) {
  app.get(`/${name}`, async (req: any) => {
    const c = await cid(req);
    const q = (req.query as any).q;
    let rows;
    if (q && opts.searchFields?.length) {
      const conds = opts.searchFields.map((f) => ilike(f, `%${q}%`));
      rows = await db.select().from(table).where(and(eq(table.companyId, c), or(...conds))).limit(200);
    } else {
      rows = await db.select().from(table).where(eq(table.companyId, c)).limit(5000);
    }
    if (opts.orderBy) rows.sort(opts.orderBy);
    return rows;
  });

  app.get(`/${name}/:id`, async (req: any) => {
    const c = await cid(req);
    const id = parseInt((req.params as any).id, 10);
    const [row] = await db.select().from(table).where(and(eq(table.companyId, c), eq(table.id, id)));
    if (!row) throw bad("Not found", 404);
    return row;
  });

  app.post(`/${name}`, async (req: any) => {
    const c = await cid(req);
    let data = capFields(trimStrings({ ...(req.body as any), companyId: c }));
    if (opts.schema) {
      const parsed = opts.schema.safeParse(data);
      if (!parsed.success) throw bad(`Invalid ${name.slice(0, -1)}: ${parsed.error.issues[0]?.message}`);
      Object.assign(data, parsed.data); // normalized fields (trimmed, defaults resolved)
    }
    if (opts.beforeSave) data = await opts.beforeSave(data, c);
    await assertCompanyRefs(c, opts.refs, data);
    requireName(data);
    try {
      const [row] = await db.insert(table).values(data).returning();
      return row;
    } catch (err: any) {
      // Duplicate names collide on the table's (companyId, name) unique index.
      if (pgCode(err) === "23505") throw bad("A record with this name/symbol already exists", 409);
      throw pgFriendly(err);
    }
  });

  app.put(`/${name}/:id`, async (req: any) => {
    const c = await cid(req);
    const id = parseInt((req.params as any).id, 10);
    let data = capFields(trimStrings({ ...(req.body as any) }));
    if (opts.schema) {
      const parsed = opts.schema.safeParse({ ...data, id: undefined });
      if (!parsed.success) throw bad(`Invalid ${name.slice(0, -1)}: ${parsed.error.issues[0]?.message}`);
      Object.assign(data, parsed.data);
      delete (data as any).id;
    }
    delete data.id;
    delete data.companyId;
    if (opts.beforeSave) data = await opts.beforeSave(data, c);
    await assertCompanyRefs(c, opts.refs, data);
    requireName(data);
    try {
      const [row] = await db.update(table).set(data).where(and(eq(table.companyId, c), eq(table.id, id))).returning();
      if (!row) throw bad("Not found", 404);
      return row;
    } catch (err: any) {
      if (pgCode(err) === "23505") throw bad("A record with this name/symbol already exists", 409);
      throw pgFriendly(err);
    }
  });

  app.delete(`/${name}/:id`, async (req: any) => {
    const c = await cid(req);
    const id = parseInt((req.params as any).id, 10);
    const [row] = await db.select().from(table).where(and(eq(table.companyId, c), eq(table.id, id)));
    if (!row) throw bad("Not found", 404);
    if (opts.forbidDeleteReserved && row.isReserved) throw bad(opts.forbidDeleteReserved);
    try {
      await db.delete(table).where(and(eq(table.companyId, c), eq(table.id, id)));
    } catch (err: any) {
      // FK violations (in use) and any other delete failure -> explicit 400, never 500.
      throw pgFriendly(err);
    }
    return { ok: true };
  });
}
