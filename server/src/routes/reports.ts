import { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { companies, ledgers, groups, voucherTypes, vouchers, voucherEntries, stockItems, units, payslips, employees, irpEwbOps } from "../db/schema.js";
import { and, eq, gte, lte, lt, gt, asc, inArray, desc } from "drizzle-orm";
import { cid, bad } from "../lib/routes.js";
import { num, r2, today, fyStart, d } from "../lib/util.js";
import {
  ledgerBalances, trialBalance, profitAndLoss, balanceSheet, ledgerVouchers,
  cashBankBook, register, billWiseOutstanding, getGroupRows, buildGroupTree,
} from "../services/accounting.js";
import { stockSummary } from "../services/stock.js";
import { gstr1, gstr3b } from "../services/gst.js";
import { eInvoicePayload } from "../services/einvoice.js";
import { ewaybillPayload, EwaybillParams } from "../services/ewaybill.js";
import { gstr9 } from "../services/gstr9.js";
import { submitEInvoice, submitEwayBillFromIrn, submissionHistory, updateEwbVehicle, extendEwbValidity, cancelEwb } from "../services/irp.js";

function period(q: any, booksBegin?: string): { from: string; to: string } {
  return {
    from: q.from ?? booksBegin ?? fyStart(today()),
    to: q.to ?? today(),
  };
}

/** R-28: format IRP errors for a human-readable `error` message. */
function irpErrorMessage(errs: unknown): string {
  if (Array.isArray(errs)) {
    return errs.map((e: any) => e?.ErrorMessage ?? e?.message ?? JSON.stringify(e)).join(" · ") || "IRP submission failed";
  }
  return String(errs ?? "IRP submission failed");
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

  // R-24: NIC v1.01 e-invoice payload for one Sales/Credit Note voucher.
  // Read-only generation + validation; the operator uploads the JSON to their
  // IRP/GSP channel (approved Option A — no IRP connectivity in zprime).
  app.get("/einvoice/:voucherId", async (req) => {
    const c = await cid(req);
    const vid = parseInt((req.params as any).voucherId, 10);
    if (!Number.isFinite(vid) || vid <= 0) throw bad("Invalid voucher");
    return eInvoicePayload(c, vid);
  });

  // R-25: EWB-01 e-way bill payload for one Sales/Credit Note voucher.
  // Part-A is derived from stored data; Part-B (vehicle/transporter) comes as
  // optional request parameters — zprime persists no transport state (approved
  // Option A: generate + download, the portal is the system of record).
  app.get("/ewaybill/:voucherId", async (req) => {
    const c = await cid(req);
    const vid = parseInt((req.params as any).voucherId, 10);
    if (!Number.isFinite(vid) || vid <= 0) throw bad("Invalid voucher");
    const q = req.query as any;
    const params: EwaybillParams = {
      vehicleNo: q.vehicleNo, transMode: q.transMode, transDocNo: q.transDocNo,
      transDocDate: q.transDocDate, transporterName: q.transporterName,
    };
    return ewaybillPayload(c, vid, params);
  });

  // ---- R-28: IRP submission (opt-in; requires company credentials) ----
  // Submissions ride on the SAME cid() authorization boundary as every other
  // report route (404 for non-members — no existence leak). The service layer
  // enforces idempotency (DB partial-unique + eager duplicate refusal) so the
  // NIC's one-hour duplicate-submission block can never be triggered by us.
  const submitEnv = (req: any) => {
    const env = String((req.query as any)?.env ?? "sandbox");
    if (env !== "sandbox" && env !== "production") throw bad("Invalid environment");
    return env;
  };

  app.post("/einvoice/:voucherId/submit", async (req, reply) => {
    const c = await cid(req);
    const vid = parseInt((req.params as any).voucherId, 10);
    if (!Number.isFinite(vid) || vid <= 0) throw bad("Invalid voucher");
    const result = await submitEInvoice(c, vid, req.userId as number, submitEnv(req));
    const code = result.ok ? 200 : result.validationErrors ? 422 : result.duplicate ? 409 : 502;
    if (!result.ok) {
      // Human-readable message alongside the structured result — the client's
      // api() helper surfaces `error` verbatim on non-2xx responses.
      const msg = result.duplicate
        ? "Already submitted (accepted or in-flight) — refusing to resubmit."
        : result.validationErrors
          ? result.validationErrors.join(" · ")
          : irpErrorMessage(result.irpErrors);
      reply.code(code);
      return { ...result, error: msg };
    }
    reply.code(code);
    return result;
  });

  app.post("/ewaybill/:voucherId/submit", async (req, reply) => {
    const c = await cid(req);
    const vid = parseInt((req.params as any).voucherId, 10);
    if (!Number.isFinite(vid) || vid <= 0) throw bad("Invalid voucher");
    const q = req.query as any;
    const partB: Record<string, unknown> = {};
    if (q.vehicleNo) partB.vehicleNo = q.vehicleNo;
    if (q.transMode) partB.transMode = q.transMode;
    if (q.transDocNo) partB.transDocNo = q.transDocNo;
    if (q.transDocDate) partB.transDocDate = q.transDocDate;
    if (q.transporterName) partB.transporterName = q.transporterName;
    const result = await submitEwayBillFromIrn(c, vid, req.userId as number, partB, submitEnv(req));
    const code = result.ok ? 200 : result.duplicate ? 409 : 502;
    if (!result.ok) {
      const msg = result.duplicate
        ? "Already submitted (accepted or in-flight) — refusing to resubmit."
        : irpErrorMessage(result.irpErrors);
      reply.code(code);
      return { ...result, error: msg };
    }
    reply.code(code);
    return result;
  });

  // Submission history — per voucher or whole company; verbatim IRP responses
  // (they carry no secrets) with actors. Read-only.
  app.get("/submissions", async (req) => {
    const c = await cid(req);
    const q = req.query as any;
    const vid = q.voucherId != null ? parseInt(String(q.voucherId), 10) : undefined;
    if (vid != null && (!Number.isFinite(vid) || vid <= 0)) throw bad("Invalid voucher");
    return submissionHistory(c, vid);
  });

  // ---- R-29: EWB lifecycle ops (vehicle update / extend / cancel) ----
  // Shared shape: resolve the accepted EWB for this voucher, run the op with
  // eager guards, record verbatim, map the result honestly. Lifecycle ops are
  // not submissions — the birth idempotency model is untouched.
  const ewbOpReply = (reply: any, result: any) => {
    const code = result.ok ? 200 : result.validationErrors ? 422 : 502;
    if (!result.ok) {
      const msg = result.validationErrors
        ? result.validationErrors.join(" · ")
        : irpErrorMessage(result.irpErrors);
      reply.code(code);
      return { ...result, error: msg };
    }
    reply.code(code);
    return result;
  };

  app.post("/ewaybill/:voucherId/vehicle", async (req, reply) => {
    const c = await cid(req);
    const vid = parseInt((req.params as any).voucherId, 10);
    if (!Number.isFinite(vid) || vid <= 0) throw bad("Invalid voucher");
    const b = (req.body ?? {}) as any;
    const result = await updateEwbVehicle(c, vid, req.userId as number, b, submitEnv(req));
    return ewbOpReply(reply, result);
  });

  app.post("/ewaybill/:voucherId/extend", async (req, reply) => {
    const c = await cid(req);
    const vid = parseInt((req.params as any).voucherId, 10);
    if (!Number.isFinite(vid) || vid <= 0) throw bad("Invalid voucher");
    const b = (req.body ?? {}) as any;
    const result = await extendEwbValidity(c, vid, req.userId as number, b, submitEnv(req));
    return ewbOpReply(reply, result);
  });

  app.post("/ewaybill/:voucherId/cancel", async (req, reply) => {
    const c = await cid(req);
    const vid = parseInt((req.params as any).voucherId, 10);
    if (!Number.isFinite(vid) || vid <= 0) throw bad("Invalid voucher");
    const b = (req.body ?? {}) as any;
    const result = await cancelEwb(c, vid, req.userId as number, b, submitEnv(req));
    return ewbOpReply(reply, result);
  });

  // Ops ledger for a voucher's EWB (or the whole company) — verbatim, read-only.
  app.get("/ewaybill/:voucherId/ops", async (req) => {
    const c = await cid(req);
    const vid = parseInt((req.params as any).voucherId, 10);
    if (!Number.isFinite(vid) || vid <= 0) throw bad("Invalid voucher");
    const subs = await submissionHistory(c, vid);
    const ids = subs.filter((s: any) => s.kind === "ewaybill").map((s: any) => s.id);
    if (ids.length === 0) return [];
    const rows = await db.select().from(irpEwbOps)
      .where(and(eq(irpEwbOps.companyId, c), inArray(irpEwbOps.submissionId, ids)))
      .orderBy(desc(irpEwbOps.id));
    return rows;
  });

  app.get("/gstr3b", async (req) => {
    const c = await cid(req);
    const [company] = await db.select().from(companies).where(eq(companies.id, c));
    const p = period(req.query as any, company?.booksBeginFrom);
    return gstr3b(c, p.from, p.to);
  });

  // R-26: GSTR-9 annual return — pure projection of gstr1/gstr3b over the
  // financial year plus duty-ledger reconciliation (Table 8). Read-only.
  app.get("/gstr9", async (req) => {
    const c = await cid(req);
    const [company] = await db.select().from(companies).where(eq(companies.id, c));
    const p = period(req.query as any, company?.booksBeginFrom);
    return gstr9(c, p.from, p.to);
  });

  // R-27: TCS report — collection-side mirror of the TDS report, with the
  // same A-04 semantics: a TCS ledger entry is a COLLECTION only when it
  // CREDITS the liability (amount < 0); a debit is a REMITTANCE to the
  // government. collected − remitted = outstanding, reconciled on-screen.
  // Threshold/rate data is surfaced as reference — never enforced (s. 206C
  // applicability is the operator's judgment; the books record what happened).
  app.get("/tcs", async (req) => {
    const c = await cid(req);
    const [company] = await db.select().from(companies).where(eq(companies.id, c));
    const p = period(req.query as any, company?.booksBeginFrom);

    const tcsLedgers = await db
      .select({ id: ledgers.id, name: ledgers.name, closing: ledgers.openingBalance })
      .from(ledgers)
      .where(and(eq(ledgers.companyId, c), eq(ledgers.dutyHead, "TCS")));

    const collections = await db
      .select({
        voucherId: vouchers.id, date: vouchers.date, number: vouchers.number,
        ledgerId: voucherEntries.ledgerId, amount: voucherEntries.amount,
        tcsSectionId: voucherEntries.tcsSectionId,
      })
      .from(voucherEntries)
      .innerJoin(vouchers, eq(vouchers.id, voucherEntries.voucherId))
      .innerJoin(ledgers, eq(ledgers.id, voucherEntries.ledgerId))
      .where(and(
        eq(vouchers.companyId, c), eq(vouchers.isCancelled, false),
        eq(ledgers.dutyHead, "TCS"),
        gte(vouchers.date, p.from), lte(vouchers.date, p.to),
        lt(voucherEntries.amount, "0"),
      ));

    const sections = await db.select().from((await import("../db/schema.js")).tcsSections).where(eq((await import("../db/schema.js")).tcsSections.companyId, c));
    const bySection = new Map<number, { sectionId: number; section: string; rate: number; threshold: number; amount: number; count: number }>();
    for (const col of collections) {
      const amt = Math.abs(num(col.amount));
      const secId = col.tcsSectionId ?? 0;
      const sec = sections.find((s) => s.id === secId);
      const key = secId;
      const cur = bySection.get(key) ?? { sectionId: secId, section: sec?.section ?? "Unspecified", rate: num(sec?.rate ?? 0), threshold: num(sec?.threshold ?? 0), amount: 0, count: 0 };
      cur.amount = r2(cur.amount + amt);
      cur.count += 1;
      bySection.set(key, cur);
    }

    const remittances = await db
      .select({
        voucherId: vouchers.id, date: vouchers.date, number: vouchers.number,
        amount: voucherEntries.amount,
      })
      .from(voucherEntries)
      .innerJoin(vouchers, eq(vouchers.id, voucherEntries.voucherId))
      .innerJoin(ledgers, eq(ledgers.id, voucherEntries.ledgerId))
      .where(and(
        eq(vouchers.companyId, c), eq(vouchers.isCancelled, false),
        eq(ledgers.dutyHead, "TCS"),
        gte(vouchers.date, p.from), lte(vouchers.date, p.to),
        gt(voucherEntries.amount, "0"),
      ));

    const collected = r2(collections.reduce((s, x) => s + Math.abs(num(x.amount)), 0));
    const remitted = r2(remittances.reduce((s, x) => s + num(x.amount), 0));

    return {
      sections: [...bySection.values()].sort((a, b) => a.section.localeCompare(b.section)),
      payableLedgers: tcsLedgers.map((l) => ({ ...l })),
      collections: collections.map((x) => ({ ...x, amount: Math.abs(num(x.amount)) })),
      remittances: remittances.map((x) => ({ ...x, amount: num(x.amount) })),
      totals: { collected, remitted, outstanding: r2(collected - remitted) },
    };
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

    // Deductions: entries on TDS duty ledgers within period.
    // A-04 fix: a TDS ledger entry is a DEDUCTION only when it CREDITS the
    // liability (amount < 0). A debit (amount > 0) on the same ledger is a
    // REMITTANCE — counting both made the report read double the true figure.
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
        lt(voucherEntries.amount, "0"),
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

    // A-04: remittances (debits on TDS ledgers) reported separately from
    // deductions, so "deducted − remitted = outstanding" reconciles on-screen.
    const remittances = await db
      .select({
        voucherId: vouchers.id, date: vouchers.date, number: vouchers.number,
        amount: voucherEntries.amount,
      })
      .from(voucherEntries)
      .innerJoin(vouchers, eq(vouchers.id, voucherEntries.voucherId))
      .innerJoin(ledgers, eq(ledgers.id, voucherEntries.ledgerId))
      .where(and(
        eq(vouchers.companyId, c), eq(vouchers.isCancelled, false),
        eq(ledgers.dutyHead, "TDS"),
        gte(vouchers.date, p.from), lte(vouchers.date, p.to),
        gt(voucherEntries.amount, "0"),
      ));

    return {
      sections: [...bySection.values()].sort((a, b) => a.section.localeCompare(b.section)),
      payableLedgers: tdsLedgers.map((l) => ({ ...l })),
      deductions: deductions.map((d2) => ({ ...d2, amount: Math.abs(num(d2.amount)) })),
      remittances: remittances.map((r3) => ({ ...r3, amount: num(r3.amount) })),
    };
  });

  // Salary register. R-02: payslips whose voucher is cancelled must not display —
  // cancellation is the audit-preserving removal path for payroll (delete is
  // blocked), so the register must exclude cancelled payroll vouchers exactly
  // like every other active report.
  app.get("/salary-register", async (req) => {
    const c = await cid(req);
    const q = req.query as any;
    const conds = [eq(payslips.companyId, c), eq(vouchers.isCancelled, false)];
    if (q.month) conds.push(eq(payslips.month, q.month));
    const rows = await db
      .select({
        id: payslips.id, month: payslips.month, employeeName: employees.name,
        gross: payslips.gross, deductions: payslips.deductions, net: payslips.net,
        lines: payslips.lines, voucherId: payslips.voucherId,
      })
      .from(payslips)
      .innerJoin(employees, eq(employees.id, payslips.employeeId))
      .innerJoin(vouchers, eq(vouchers.id, payslips.voucherId))
      .where(and(...conds))
      .orderBy(asc(payslips.month), asc(employees.name));
    return rows;
  });
}
