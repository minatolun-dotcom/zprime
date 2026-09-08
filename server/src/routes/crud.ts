import { db } from "../db/index.js";
import { and, eq, ilike, or } from "drizzle-orm";
import { cid, bad, pgFriendly, pgCode } from "../lib/routes.js";

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

type Table = any;

export function crud(
  app: any,
  name: string,
  table: Table,
  opts: {
    orderBy?: (a: any, b: any) => number;
    searchFields?: any[];
    forbidDeleteReserved?: string;
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
    const data = capFields({ ...(req.body as any), companyId: c });
    try {
      const [row] = await db.insert(table).values(data).returning();
      return row;
    } catch (err: any) {
      // Duplicate names collide on the table's (companyId, name) unique index.
      if (pgCode(err) === "23505") throw bad("A record with this name/symbol already exists");
      throw err;
    }
  });

  app.put(`/${name}/:id`, async (req: any) => {
    const c = await cid(req);
    const id = parseInt((req.params as any).id, 10);
    const data = capFields({ ...(req.body as any) });
    delete data.id;
    delete data.companyId;
    try {
      const [row] = await db.update(table).set(data).where(and(eq(table.companyId, c), eq(table.id, id))).returning();
      if (!row) throw bad("Not found", 404);
      return row;
    } catch (err: any) {
      if (pgCode(err) === "23505") throw bad("A record with this name/symbol already exists");
      throw err;
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
