import { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { companies, ledgers, groups, voucherTypes, vouchers, voucherEntries, stockItems, units, payslips, employees } from "../db/schema.js";
import { and, eq, gte, lte, asc } from "drizzle-orm";
import { cid, bad } from "../lib/routes.js";
import { num, r2, today, fyStart, d } from "../lib/util.js";
import {
  ledgerBalances, trialBalance, profitAndLoss, balanceSheet, ledgerVouchers,
  cashBankBook, register, billWiseOutstanding, getGroupRows, buildGroupTree,
} from "../services/accounting.js";
import { stockSummary } from "../services/stock.js";
import { gstr1, gstr3b } from "../services/gst.js";

function period(q: any, booksBegin?: string): { from: string; to: string } {
  return {
    from: q.from ?? booksBegin ?? fyStart(today()),
    to: q.to ?? today(),
  };
}

export default async function reportRoutes(app: FastifyInstance) {
  app.get("/trial-balance", async (req) => {
    const c = await cid(req);
    const [company] = await db.select().from(companies).where(eq(companies.id, c));
    return trialBalance(c, period(req.query as any, company?.booksBeginFrom));
  });

  app.get("/profit-loss", async (req) => {
    const c = await cid(req);
    const [company] = await db.select().from(companies).where(eq(companies.id, c));
    return profitAndLoss(c, period(req.query as any, company?.booksBeginFrom));
  });

  app.get("/balance-sheet", async (req) => {
    const c = await cid(req);
    const asOf = (req.query as any).to ?? today();
    return balanceSheet(c, asOf);
  });

  app.get("/day-book", async (req) => {
    const c = await cid(req);
    const q = req.query as any;
    const conds = [eq(vouchers.companyId, c)];
    if (q.from) conds.push(gte(vouchers.date, q.from));
    if (q.to) conds.push(lte(vouchers.date, q.to));
    const rows = await db
      .select({
        id: vouchers.id, date: vouchers.date, number: vouchers.number, typeName: voucherTypes.name,
        partyName: ledgers.name, narration: vouchers.narration, isCancelled: vouchers.isCancelled,
        amount: (await import("drizzle-orm")).sql<number>`coalesce((select sum(amount) from voucher_entries e where e.voucher_id = ${vouchers.id} and e.amount > 0), 0)::float8`,
      })
      .from(vouchers)
      .innerJoin(voucherTypes, eq(voucherTypes.id, vouchers.voucherTypeId))
      .leftJoin(ledgers, eq(ledgers.id, vouchers.partyLedgerId))
      .where(and(...conds))
      .orderBy(asc(vouchers.date), asc(vouchers.id))
      .limit(2000);
    return rows;
  });

  app.get("/ledger-vouchers/:ledgerId", async (req) => {
    const c = await cid(req);
    const [company] = await db.select().from(companies).where(eq(companies.id, c));
    const p = period(req.query as any, company?.booksBeginFrom);
    const result = await ledgerVouchers(c, parseInt((req.params as any).ledgerId, 10), p);
    if (!result) throw bad("Ledger not found");
    return result;
  });

  app.get("/group-summary/:groupId", async (req) => {
    const c = await cid(req);
    const [company] = await db.select().from(companies).where(eq(companies.id, c));
    const p = period(req.query as any, company?.booksBeginFrom);
    const groupId = parseInt((req.params as any).groupId, 10);
    const groupRows = await getGroupRows(c);
    const group = groupRows.find((g) => g.id === groupId);
    if (!group) throw bad("Group not found");
    // subtree ids
    const ids = new Set<number>([groupId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const g of groupRows) {
        if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) { ids.add(g.id); changed = true; }
      }
    }
    const balances = (await ledgerBalances(c, p.from, p.to)).filter((b) => ids.has(b.groupId));
    const subtree = groupRows.filter((g) => ids.has(g.id));
    return { group, ledgers: balances, subtree, groups: buildGroupTree(subtree, balances, { includeZero: true }) };
  });

  app.get("/cash-bank", async (req) => {
    const c = await cid(req);
    const [company] = await db.select().from(companies).where(eq(companies.id, c));
    return cashBankBook(c, period(req.query as any, company?.booksBeginFrom));
  });

  app.get("/register", async (req) => {
    const c = await cid(req);
    const [company] = await db.select().from(companies).where(eq(companies.id, c));
    const p = period(req.query as any, company?.booksBeginFrom);
    const typeName = (req.query as any).typeName ?? "Sales";
    return register(c, p, typeName);
  });

  app.get("/receivables", async (req) => {
    const c = await cid(req);
    const asOf = (req.query as any).to ?? today();
    return billWiseOutstanding(c, "Sundry Debtors", asOf);
  });

  app.get("/payables", async (req) => {
    const c = await cid(req);
    const asOf = (req.query as any).to ?? today();
    return billWiseOutstanding(c, "Sundry Creditors", asOf);
  });

  app.get("/stock-summary", async (req) => {
    const c = await cid(req);
    const asOf = (req.query as any).to ?? today();
    const itemId = (req.query as any).itemId ? parseInt((req.query as any).itemId, 10) : undefined;
    return stockSummary(c, asOf, itemId);
  });

  app.get("/gstr1", async (req) => {
    const c = await cid(req);
    const [company] = await db.select().from(companies).where(eq(companies.id, c));
    const p = period(req.query as any, company?.booksBeginFrom);
    return gstr1(c, p.from, p.to);
  });

  app.get("/gstr3b", async (req) => {
    const c = await cid(req);
    const [company] = await db.select().from(companies).where(eq(companies.id, c));
    const p = period(req.query as any, company?.booksBeginFrom);
    return gstr3b(c, p.from, p.to);
  });

  // TDS report: deductions by section + payable balances
  app.get("/tds", async (req) => {
    const c = await cid(req);
    const [company] = await db.select().from(companies).where(eq(companies.id, c));
    const p = period(req.query as any, company?.booksBeginFrom);

    const tdsLedgers = await db
      .select({ id: ledgers.id, name: ledgers.name, closing: ledgers.openingBalance })
      .from(ledgers)
      .where(and(eq(ledgers.companyId, c), eq(ledgers.dutyHead, "TDS")));

    // Deductions: entries on TDS duty ledgers within period
    const deductions = await db
      .select({
        voucherId: vouchers.id, date: vouchers.date, number: vouchers.number,
        ledgerId: voucherEntries.ledgerId, amount: voucherEntries.amount,
        tdsSectionId: voucherEntries.tdsSectionId,
        voucherDate: vouchers.date,
      })
      .from(voucherEntries)
      .innerJoin(vouchers, eq(vouchers.id, voucherEntries.voucherId))
      .innerJoin(ledgers, eq(ledgers.id, voucherEntries.ledgerId))
      .where(and(
        eq(vouchers.companyId, c), eq(vouchers.isCancelled, false),
        eq(ledgers.dutyHead, "TDS"),
        gte(vouchers.date, p.from), lte(vouchers.date, p.to),
      ));

    const sections = await db.select().from((await import("../db/schema.js")).tdsSections).where(eq((await import("../db/schema.js")).tdsSections.companyId, c));
    const bySection = new Map<number, { sectionId: number; section: string; amount: number; count: number }>();
    for (const ded of deductions) {
      const amt = Math.abs(num(ded.amount));
      const secId = ded.tdsSectionId ?? 0;
      const sec = sections.find((s) => s.id === secId);
      const key = secId;
      const cur = bySection.get(key) ?? { sectionId: secId, section: sec?.section ?? "Unspecified", amount: 0, count: 0 };
      cur.amount = r2(cur.amount + amt);
      cur.count += 1;
      bySection.set(key, cur);
    }

    return {
      sections: [...bySection.values()].sort((a, b) => a.section.localeCompare(b.section)),
      payableLedgers: tdsLedgers.map((l) => ({ ...l })),
      deductions: deductions.map((d2) => ({ ...d2, amount: Math.abs(num(d2.amount)) })),
    };
  });

  // Salary register
  app.get("/salary-register", async (req) => {
    const c = await cid(req);
    const q = req.query as any;
    const conds = [eq(payslips.companyId, c)];
    if (q.month) conds.push(eq(payslips.month, q.month));
    const rows = await db
      .select({
        id: payslips.id, month: payslips.month, employeeName: employees.name,
        gross: payslips.gross, deductions: payslips.deductions, net: payslips.net,
        lines: payslips.lines, voucherId: payslips.voucherId,
      })
      .from(payslips)
      .innerJoin(employees, eq(employees.id, payslips.employeeId))
      .where(and(...conds))
      .orderBy(asc(payslips.month), asc(employees.name));
    return rows;
  });
}
