import { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/index.js";
import { companies, groups, ledgers, voucherTypes, userCompanies, users } from "../db/schema.js";
import { and, eq, asc } from "drizzle-orm";
import { DEFAULT_GROUPS, DEFAULT_VOUCHER_TYPES } from "../lib/defaults.js";
import { bad, pgFriendly } from "../lib/routes.js";
import { hashPassword } from "../plugins/auth.js";

const optText = (max = 200) => z.string().trim().max(max).optional().nullable();
/** R-03: require the authenticated user to hold a membership on company :id.
 *  404 (not 403) so unauthorized companies are indistinguishable from unknown. */
async function requireMember(req: any, companyId: number): Promise<number> {
  if (!Number.isFinite(companyId) || companyId <= 0) throw bad("Company not found", 404);
  const [m] = await db.select({ id: userCompanies.id }).from(userCompanies)
    .where(and(eq(userCompanies.companyId, companyId), eq(userCompanies.userId, req.userId as number))).limit(1);
  if (!m) throw bad("Company not found", 404);
  return companyId;
}
/** R-03: membership management (invite/remove members) is OWNER-only. A plain
 *  member (accountant) must never be able to grant access or remove owners. */
async function requireOwner(req: any, companyId: number): Promise<number> {
  const id = await requireMember(req, companyId);
  const [m] = await db.select({ role: userCompanies.role }).from(userCompanies)
    .where(and(eq(userCompanies.companyId, id), eq(userCompanies.userId, req.userId as number))).limit(1);
  if (m?.role !== "owner") throw bad("Owner access required", 403);
  return id;
}


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
  // R-06 (B-01): permit outward movements that drive stock negative. Default
  // false — overselling is rejected at posting with an explanatory message.
  allowNegativeStock: z.boolean().optional(),
});

/** Seed reserved groups, default voucher types and starter ledgers for a new company.
 *  R-03: transaction-scoped so company + seed + owner membership commit atomically. */
async function seedCompanyTx(tx: any, companyId: number) {
  const groupId = new Map<string, number>();
  for (const g of DEFAULT_GROUPS) {
    const [row] = await tx
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
    const [row] = await tx
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
    // R-23: reverse-charge self-assessment liability (s. 9(3)/9(4)). The
    // recipient credits this ledger for tax owed directly; GSTR-3B classifies
    // those entries into Table 4(A)(3), separate from regular supplier ITC.
    { name: "RCM Payable", groupId: groupId.get("Duties & Taxes")!, dutyHead: "RCM" },
    { name: "Salary Payable", groupId: groupId.get("Current Liabilities")! },
  ];
  for (const l of starter) {
    await tx.insert(ledgers).values({
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
  // R-03: only companies the authenticated user holds a membership on. This is
  // the company directory — it must never leak other users' companies.
  app.get("/companies", async (req) => {
    return db
      .select({ id: companies.id, name: companies.name, mailingName: companies.mailingName, address: companies.address,
        city: companies.city, state: companies.state, stateCode: companies.stateCode, pincode: companies.pincode,
        phone: companies.phone, email: companies.email, gstin: companies.gstin,
        financialYearStart: companies.financialYearStart, booksBeginFrom: companies.booksBeginFrom,
        createdAt: companies.createdAt, role: userCompanies.role,
        allowNegativeStock: companies.allowNegativeStock })
      .from(companies)
      .innerJoin(userCompanies, and(eq(userCompanies.companyId, companies.id), eq(userCompanies.userId, req.userId as number)))
      .orderBy(asc(companies.name));
  });

  // R-03: company detail is membership-gated (404 — no existence leak).
  app.get("/companies/:id", async (req) => {
    const id = parseInt((req.params as any).id, 10);
    if (!Number.isFinite(id) || id <= 0) throw bad("Company not found", 404);
    const [row] = await db
      .select({ id: companies.id, name: companies.name, mailingName: companies.mailingName, address: companies.address,
        city: companies.city, state: companies.state, stateCode: companies.stateCode, pincode: companies.pincode,
        phone: companies.phone, email: companies.email, gstin: companies.gstin,
        financialYearStart: companies.financialYearStart, booksBeginFrom: companies.booksBeginFrom, createdAt: companies.createdAt,
        allowNegativeStock: companies.allowNegativeStock })
      .from(companies)
      .innerJoin(userCompanies, and(eq(userCompanies.companyId, companies.id), eq(userCompanies.userId, req.userId as number)))
      .where(eq(companies.id, id))
      .limit(1);
    if (!row) throw bad("Company not found", 404);
    return row;
  });

  // R-03: creation grants the creator an owner membership, atomically — a
  // company without a member would be an orphan nobody can reach.
  app.post("/companies", async (req) => {
    const parsed = companySchema.safeParse(req.body);
    if (!parsed.success) throw bad("Invalid company data: " + parsed.error.issues[0]?.message);
    try {
      const row = await db.transaction(async (tx) => {
        const [created] = await tx.insert(companies).values(parsed.data).returning();
        await seedCompanyTx(tx, created.id);
        await tx.insert(userCompanies).values({ userId: req.userId as number, companyId: created.id, role: "owner" });
        return created;
      });
      return row;
    } catch (err: any) {
      throw pgFriendly(err);
    }
  });

  // R-03: settings updates are membership-gated (404 — no existence leak).
  // The request body can never grant or bypass membership.
  app.put("/companies/:id", async (req) => {
    const id = parseInt((req.params as any).id, 10);
    if (!Number.isFinite(id) || id <= 0) throw bad("Company not found", 404);
    const [member] = await db.select({ id: userCompanies.id }).from(userCompanies)
      .where(and(eq(userCompanies.companyId, id), eq(userCompanies.userId, req.userId as number))).limit(1);
    if (!member) throw bad("Company not found", 404);
    const parsed = companySchema.partial().safeParse(req.body);
    if (!parsed.success) throw bad("Invalid company data");
    const [row] = await db.update(companies).set(parsed.data).where(eq(companies.id, id)).returning();
    if (!row) throw bad("Company not found", 404);
    return row;
  });

  // ---- R-03 minimal membership management ----
  // Smallest mechanism required to operate multi-user memberships: an owner
  // lists/invites/removes members on THEIR company. No invitations, no email,
  // no roles beyond the membership role label. Owner role changes/deletions
  // that would orphan a company are rejected (at least one owner must remain).
  const memberSchema = z.object({
    username: z.string().trim().min(1).max(200),
    password: z.string().min(1).max(200),
    role: z.enum(["owner", "accountant"]).default("accountant"),
  });

  app.get("/companies/:id/members", async (req) => {
    const id = await requireMember(req, parseInt((req.params as any).id, 10));
    return db
      .select({ userId: users.id, username: users.username, role: userCompanies.role, createdAt: userCompanies.createdAt })
      .from(userCompanies)
      .innerJoin(users, eq(users.id, userCompanies.userId))
      .where(eq(userCompanies.companyId, id))
      .orderBy(asc(userCompanies.createdAt));
  });

  app.post("/companies/:id/members", async (req) => {
    const id = await requireOwner(req, parseInt((req.params as any).id, 10));
    const parsed = memberSchema.safeParse(req.body);
    if (!parsed.success) throw bad("Invalid member data: " + parsed.error.issues[0]?.message);
    const { username, password, role } = parsed.data;
    try {
      const [user] = await db.insert(users).values({ username, passwordHash: hashPassword(password) }).returning();
      await db.insert(userCompanies).values({ userId: user.id, companyId: id, role });
      return { userId: user.id, username: user.username, role };
    } catch (err: any) {
      throw pgFriendly(err);
    }
  });

  app.delete("/companies/:id/members/:userId", async (req) => {
    const id = await requireOwner(req, parseInt((req.params as any).id, 10));
    const target = parseInt((req.params as any).userId, 10);
    if (!Number.isFinite(target) || target <= 0) throw bad("Invalid member");
    const members = await db.select({ userId: userCompanies.userId, role: userCompanies.role }).from(userCompanies).where(eq(userCompanies.companyId, id));
    const owners = members.filter((m) => m.role === "owner");
    const targetRow = members.find((m) => m.userId === target);
    if (!targetRow) throw bad("Member not found", 404);
    // Removing the last owner would orphan the company (nobody could manage or
    // even access it) — including an owner trying to leave as sole owner.
    if (targetRow.role === "owner" && owners.length <= 1) throw bad("Cannot remove the last owner of a company", 409);
    await db.delete(userCompanies).where(and(eq(userCompanies.companyId, id), eq(userCompanies.userId, target)));
    return { ok: true };
  });
}
