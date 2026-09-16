import { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import {
  groups, ledgers, units, stockGroups, stockCategories, godowns, stockItems, voucherTypes, tdsSections,
} from "../db/schema.js";
import { and, asc, eq, ilike } from "drizzle-orm";
import { cid, bad, groupSchema, tdsSectionSchema } from "../lib/routes.js";
import { crud } from "./crud.js";

const byName = (a: any, b: any) => (a.name ?? "").localeCompare(b.name ?? "");
const bySection = (a: any, b: any) => (a.section ?? "").localeCompare(b.section ?? "");

// Reserved groups that must stay childless (mirror of the server's seed rules:
// Primary/loop-protection anchors and the system P&L ledger group).
const RESERVED_NO_CHILDREN = new Set(["Primary", "Profit & Loss A/c"]);

export default async function masterRoutes(app: FastifyInstance) {
  crud(app, "groups", groups, {
    orderBy: byName,
    forbidDeleteReserved: "Pre-defined groups cannot be deleted",
    schema: groupSchema,
    // F-GRP-01 fix: `nature` is NOT NULL. Resolve it at the trust boundary —
    // explicit nature wins; otherwise inherit from the parent group (Tally
    // semantics); a top-level group without nature is a clean 400.
    beforeSave: async (data: any, companyId: number) => {
      let nature: string | undefined = data.nature;
      if (data.parentId) {
        const [parent] = await db.select().from(groups).where(and(eq(groups.companyId, companyId), eq(groups.id, data.parentId)));
        if (!parent) throw bad("Parent group not found in this company", 404);
        if (parent.isReserved && RESERVED_NO_CHILDREN.has(parent.name)) {
          throw bad(`Groups cannot be created under "${parent.name}"`);
        }
        nature = nature ?? parent.nature;
      }
      if (!nature) {
        throw bad("A top-level group must specify its nature (Assets | Liabilities | Income | Expenses)");
      }
      const [dupe] = await db.select({ id: groups.id }).from(groups)
        .where(and(eq(groups.companyId, companyId), eq(groups.name, data.name)));
      if (dupe) throw bad(`A group named "${data.name}" already exists`, 409);
      return { ...data, nature, isReserved: false };
    },
  });
  // R-08 (F-08-1): FK refs are validated in-company at the CRUD boundary —
  // a ledger may only reference a group of its own company, an item only a
  // unit/stock-group/category of its own (schema FKs are global).
  crud(app, "ledgers", ledgers, { orderBy: byName, searchFields: [ledgers.name],
    refs: { groupId: { table: groups, label: "Group" } } });
  crud(app, "units", units, { orderBy: byName });
  crud(app, "stock-groups", stockGroups, { orderBy: byName });
  crud(app, "stock-categories", stockCategories, { orderBy: byName });
  crud(app, "godowns", godowns, { orderBy: byName });
  crud(app, "stock-items", stockItems, { orderBy: byName, searchFields: [stockItems.name],
    refs: {
      unitId: { table: units, label: "Unit" },
      groupId: { table: stockGroups, label: "Stock group" },
      categoryId: { table: stockCategories, label: "Stock category" },
    } });
  crud(app, "voucher-types", voucherTypes, { orderBy: byName });
  // tds_sections has no `name` column — sorting by name crashed the list route (F-TDS-01)
  crud(app, "tds-sections", tdsSections, { orderBy: bySection, schema: tdsSectionSchema });

  // Ledger lookup for voucher screens
  app.get("/ledger-lookup", async (req) => {
    const c = await cid(req);
    const q = (req.query as any).q ?? "";
    return db
      .select({
        id: ledgers.id, name: ledgers.name, groupId: ledgers.groupId,
        groupName: groups.name, groupNature: groups.nature,
        isBankCash: ledgers.isBankCash, billWise: ledgers.billWise,
        gstRegistrationType: ledgers.gstRegistrationType, taxability: ledgers.taxability,
        gstin: ledgers.gstin, dutyHead: ledgers.dutyHead, tdsSectionId: ledgers.tdsSectionId,
        openingBalance: ledgers.openingBalance,
      })
      .from(ledgers)
      .innerJoin(groups, eq(groups.id, ledgers.groupId))
      .where(and(eq(ledgers.companyId, c), ilike(ledgers.name, `%${q}%`)))
      .orderBy(asc(ledgers.name))
      .limit(50);
  });

  // Item lookup for voucher screens
  app.get("/item-lookup", async (req) => {
    const c = await cid(req);
    const q = (req.query as any).q ?? "";
    return db
      .select({
        id: stockItems.id, name: stockItems.name, unitId: stockItems.unitId,
        unitSymbol: units.symbol, unitDecimals: units.decimalPlaces,
        gstRate: stockItems.gstRate, hsnSac: stockItems.hsnSac,
        standardSalePrice: stockItems.standardSalePrice, standardCost: stockItems.standardCost,
      })
      .from(stockItems)
      .innerJoin(units, eq(units.id, stockItems.unitId))
      .where(and(eq(stockItems.companyId, c), ilike(stockItems.name, `%${q}%`)))
      .orderBy(asc(stockItems.name))
      .limit(50);
  });

  // Group tree for masters UI + reports
  app.get("/group-tree", async (req) => {
    const c = await cid(req);
    const rows = await db.select().from(groups).where(eq(groups.companyId, c));
    const byId = new Map(rows.map((r) => [r.id, { ...r, children: [] as any[] }]));
    const roots: any[] = [];
    for (const r of byId.values()) {
      if (r.parentId && byId.has(r.parentId)) byId.get(r.parentId)!.children.push(r);
      else roots.push(r);
    }
    const sortRec = (nodes: any[]) => {
      nodes.sort((a, b) => a.name.localeCompare(b.name));
      nodes.forEach((n) => sortRec(n.children));
    };
    sortRec(roots);
    return roots;
  });
}
