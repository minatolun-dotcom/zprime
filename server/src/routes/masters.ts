import { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import {
  groups, ledgers, units, stockGroups, stockCategories, godowns, stockItems, voucherTypes, tdsSections,
} from "../db/schema.js";
import { and, asc, eq, ilike } from "drizzle-orm";
import { cid, bad } from "../lib/routes.js";
import { crud } from "./crud.js";

const byName = (a: any, b: any) => a.name.localeCompare(b.name);

export default async function masterRoutes(app: FastifyInstance) {
  crud(app, "groups", groups, { orderBy: byName, forbidDeleteReserved: "Pre-defined groups cannot be deleted" });
  crud(app, "ledgers", ledgers, { orderBy: byName, searchFields: [ledgers.name] });
  crud(app, "units", units, { orderBy: byName });
  crud(app, "stock-groups", stockGroups, { orderBy: byName });
  crud(app, "stock-categories", stockCategories, { orderBy: byName });
  crud(app, "godowns", godowns, { orderBy: byName });
  crud(app, "stock-items", stockItems, { orderBy: byName, searchFields: [stockItems.name] });
  crud(app, "voucher-types", voucherTypes, { orderBy: byName });
  crud(app, "tds-sections", tdsSections, { orderBy: byName });

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
