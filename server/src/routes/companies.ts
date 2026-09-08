import { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/index.js";
import { companies, groups, ledgers, voucherTypes } from "../db/schema.js";
import { eq, asc } from "drizzle-orm";
import { DEFAULT_GROUPS, DEFAULT_VOUCHER_TYPES } from "../lib/defaults.js";
import { bad, pgFriendly } from "../lib/routes.js";

const optText = (max = 200) => z.string().trim().max(max).optional().nullable();

const companySchema = z.object({
  name: z.string().trim().min(1).max(200),
  mailingName: optText(),
  address: optText(500),
  city: optText(100),
  state: optText(100),
  stateCode: optText(10),
  pincode: optText(20),
  phone: optText(30),
  email: optText(200),
  gstin: optText(20),
  financialYearStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  booksBeginFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** Seed reserved groups, default voucher types and starter ledgers for a new company. */
export async function seedCompany(companyId: number) {
  const groupId = new Map<string, number>();
  for (const g of DEFAULT_GROUPS) {
    const [row] = await db
      .insert(groups)
      .values({
        companyId,
        name: g.name,
        parentId: g.parent ? groupId.get(g.parent)! : null,
        nature: g.nature,
        isReserved: true,
        affectsGross: !!g.affectsGross,
      })
      .returning({ id: groups.id });
    groupId.set(g.name, row.id);
  }

  const typeId = new Map<string, number>();
  for (const vt of DEFAULT_VOUCHER_TYPES) {
    const [row] = await db
      .insert(voucherTypes)
      .values({
        companyId,
        name: vt.name,
        shortCode: vt.shortCode,
        category: vt.category,
        affectsStock: vt.affectsStock,
        functionKey: vt.functionKey ?? null,
      })
      .returning({ id: voucherTypes.id });
    typeId.set(vt.name, row.id);
  }

  const starter = [
    { name: "Cash", groupId: groupId.get("Cash-in-Hand")!, isBankCash: true },
    { name: "Profit & Loss A/c", groupId: groupId.get("Capital Account")!, isBankCash: false },
    { name: "IGST", groupId: groupId.get("Duties & Taxes")!, dutyHead: "IGST" },
    { name: "CGST", groupId: groupId.get("Duties & Taxes")!, dutyHead: "CGST" },
    { name: "SGST/UTGST", groupId: groupId.get("Duties & Taxes")!, dutyHead: "SGST" },
    { name: "CESS", groupId: groupId.get("Duties & Taxes")!, dutyHead: "CESS" },
    { name: "TDS Payable", groupId: groupId.get("Duties & Taxes")!, dutyHead: "TDS" },
    { name: "Salary Payable", groupId: groupId.get("Current Liabilities")! },
  ];
  for (const l of starter) {
    await db.insert(ledgers).values({
      companyId,
      name: l.name,
      groupId: l.groupId,
      isBankCash: l.isBankCash ?? false,
      dutyHead: (l as any).dutyHead ?? null,
      gstRegistrationType: "none",
      taxability: "none",
    });
  }
  return { groupId, typeId };
}

export default async function companyRoutes(app: FastifyInstance) {
  app.get("/companies", async () => {
    return db.select().from(companies).orderBy(asc(companies.name));
  });

  app.get("/companies/:id", async (req) => {
    const id = parseInt((req.params as any).id, 10);
    const [row] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
    if (!row) throw bad("Company not found");
    return row;
  });

  app.post("/companies", async (req) => {
    const parsed = companySchema.safeParse(req.body);
    if (!parsed.success) throw bad("Invalid company data: " + parsed.error.issues[0]?.message);
    try {
      const [row] = await db.insert(companies).values(parsed.data).returning();
      await seedCompany(row.id);
      return row;
    } catch (err: any) {
      throw pgFriendly(err);
    }
  });

  app.put("/companies/:id", async (req) => {
    const id = parseInt((req.params as any).id, 10);
    const parsed = companySchema.partial().safeParse(req.body);
    if (!parsed.success) throw bad("Invalid company data");
    const [row] = await db.update(companies).set(parsed.data).where(eq(companies.id, id)).returning();
    if (!row) throw bad("Company not found", 404);
    return row;
  });
}
