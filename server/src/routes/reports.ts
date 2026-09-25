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
import { submitEInvoice, submitEwayBillFromIrn, generateEwbDirect, submissionHistory, updateEwbVehicle, extendEwbValidity, cancelEwb } from "../services/irp.js";
import { tdsSections, tcsSections } from "../db/schema.js";

// ---- R-33: threshold advisories (ADVISORY-ONLY — nothing blocks) ----
// The law measures a per-PAYEE per-FY aggregate (or per-payment single limit);
// these helpers make that measurable from the postings themselves — no new
// state, no enforcement, no behavior change. The books record; the operator
// judges; the advisory surfaces what the books already know.
function fyWindow(booksBegin?: string, financialYearStart?: string): { from: string; to: string } {
  // R-56 (F1): the FY window honours the company's STORED financialYearStart.
  return { from: booksBegin ?? fyStart(today(), financialYearStart), to: today() };
}

/** Per-section FY aggregates for one duty head ("TDS" | "TCS") + the books-
 *  begin FY window. The aggregate measures the PAYMENT/COLLECTION BASE — the
 *  statutory thresholds (194C/194J/194I/206C…) bind on what was PAID or
 *  COLLECTED, not on the duty credited; summing the duty lines would compare
 *  10% of the base against a base-sized threshold (the unit mismatch the R-33
 *  test caught). Base lines are found via the ledger's section DECLARATION
 *  (ledgers.tds/tcs_section_id — set on the expense/party master), because the
 *  entry-level snapshot is stamped only on the duty line itself. Sections
 *  without postings still appear (threshold=0 or unset → no advisory).
 *  R-37 (R-33 Option C): rows now ALSO carry a per-PAYEE breakdown — the
 *  statutory unit. The payee grain is the ledger itself (zprime's ledger
 *  master IS the payee master; a payee spread over several ledgers reports
 *  per ledger — documented in R-37_INVESTIGATION.md §5). Each payee row:
 *  { ledgerId, ledgerName, hasPan (GSTIN chars 3–12 present), fyAmount,
 *  maxSingle, count }. Section-level totals remain the rollup across payees. */
async function tdsTcsFyAggregates(companyId: number, dutyHead: "TDS" | "TCS") {
  const [fyCompany] = await db.select({ financialYearStart: companies.financialYearStart }).from(companies).where(eq(companies.id, companyId));
  const { from, to } = fyWindow(undefined, fyCompany?.financialYearStart);
  const sectionTable = dutyHead === "TDS" ? tdsSections : tcsSections;
  const sectionCol = dutyHead === "TDS" ? ledgers.tdsSectionId : ledgers.tcsSectionId;
  const sections = await db.select().from(sectionTable).where(eq(sectionTable.companyId, companyId));
  const rows = await db
    .select({
      sectionId: sectionCol,
      ledgerId: voucherEntries.ledgerId,
      amount: voucherEntries.amount,
    })
    .from(voucherEntries)
    .innerJoin(vouchers, eq(vouchers.id, voucherEntries.voucherId))
    .innerJoin(ledgers, eq(ledgers.id, voucherEntries.ledgerId))
    .where(and(
      eq(vouchers.companyId, companyId), eq(vouchers.isCancelled, false),
      // Defense-in-depth: the ledger itself must belong to this company.
      eq(ledgers.companyId, companyId),
      gte(vouchers.date, from), lte(vouchers.date, to),
    ));
  type PayeeAgg = { ledgerId: number; ledgerName: string; hasPan: boolean; fyAmount: number; maxSingle: number; count: number };
  const bySection = new Map<number, { sectionId: number; section: string; threshold: number; thresholdMode: string | null; fyAmount: number; maxSingle: number; count: number; payees: Map<number, PayeeAgg> }>();
  for (const sec of sections) {
    bySection.set(sec.id, { sectionId: sec.id, section: sec.section, threshold: num(sec.threshold), thresholdMode: (sec as any).thresholdMode ?? null, fyAmount: 0, maxSingle: 0, count: 0, payees: new Map() });
  }
  const ledgerNames = new Map<number, string>();
  const ledgerPans = new Map<number, boolean>();
  for (const row of rows) {
    const key = row.sectionId ?? 0;
    const cur = bySection.get(key);
    if (!cur) continue; // ledger references a since-deleted section, or a duty/remittance line (no section on the ledger)
    // TDS base: expense DEBIT lines (amount > 0). TCS base: party CREDIT lines
    // (amount < 0). The opposite direction is never a base event; duty lines
    // live on duty-head ledgers without a section declaration and never match.
    const amt = dutyHead === "TDS" ? num(row.amount) : -num(row.amount);
    if (amt <= 0) continue;
    cur.fyAmount = r2(cur.fyAmount + amt);
    if (amt > cur.maxSingle) cur.maxSingle = amt;
    cur.count += 1;
    // R-37: per-payee (per-ledger) split — the statutory aggregation unit.
    if (row.ledgerId == null) continue; // cannot happen (inner join) — belt and braces
    let ledgerName = ledgerNames.get(row.ledgerId);
    if (ledgerName === undefined) {
      const [l] = await db.select({ name: ledgers.name, gstin: ledgers.gstin }).from(ledgers).where(eq(ledgers.id, row.ledgerId));
      ledgerName = l?.name ?? `#${row.ledgerId}`;
      ledgerNames.set(row.ledgerId, ledgerName);
      ledgerPans.set(row.ledgerId, Boolean(l?.gstin && String(l.gstin).length >= 12)); // PAN = GSTIN chars 3–12
    }
    let payee = cur.payees.get(row.ledgerId);
    if (!payee) {
      payee = { ledgerId: row.ledgerId, ledgerName, hasPan: ledgerPans.get(row.ledgerId) ?? false, fyAmount: 0, maxSingle: 0, count: 0 };
      cur.payees.set(row.ledgerId, payee);
    }
    payee.fyAmount = r2(payee.fyAmount + amt);
    if (amt > payee.maxSingle) payee.maxSingle = amt;
    payee.count += 1;
  }
  return [...bySection.values()]
    .filter((s) => s.threshold > 0 || s.count > 0)
    .map((s) => ({
      ...s,
      payees: [...s.payees.values()].sort((a, b) => b.fyAmount - a.fyAmount || a.ledgerName.localeCompare(b.ledgerName)),
    }))
    .sort((a, b) => a.section.localeCompare(b.section));
}

function period(q: any, booksBegin?: string, financialYearStart?: string): { from: string; to: string } {
  return {
    from: q.from ?? booksBegin ?? fyStart(today(), financialYearStart),
    to: q.to ?? today(),
  };
}

// ---- R-60: cross-FY comparison (Tally F12 "previous year" columns) ----
/** The comparison window for a period: the SAME-LENGTH slice one year back
 *  (a full-FY view compares against the full prior FY; an Apr–Jun slice
 *  against the prior Apr–Jun — Tally's period-report semantics). Returns
 *  null when the entire prior window precedes the books (no prior history —
 *  the client renders an honest dash, never a fabricated zero). A partial
 *  overlap is kept as-is: pre-books dates simply carry no vouchers, and the
 *  engine already computes honest openings for any window (R-56 F2). */
function prevWindow(from: string, to: string, booksBegin?: string): { from: string; to: string } | null {
  const shiftYear = (ds: string) => {
    const dt = new Date(ds + "T00:00:00Z");
    const day = dt.getUTCDate();
    dt.setUTCFullYear(dt.getUTCFullYear() - 1);
    if (dt.getUTCDate() !== day) dt.setUTCDate(0); // Feb 29 → Feb 28, never Mar 1
    return dt.toISOString().slice(0, 10);
  };
  const pFrom = shiftYear(from), pTo = shiftYear(to);
  if (booksBegin && pTo < booksBegin) return null;
  return { from: pFrom, to: pTo };
}

/** Attach `previous` + `previousWindow` + `compareLabels` to a report payload
 *  when compare=1. The SAME service function runs over the derived prior
 *  window — zero engine change; the payload shape is additive so the
 *  off-state is byte-identical to the pre-R-60 response. */
async function withCompare<T extends object>(
  q: any, booksBegin: string | undefined, financialYearStart: string | undefined,
  window: { from: string; to: string },
  run: (w: { from: string; to: string }) => Promise<T>,
  asOf = false,
): Promise<T & { previous?: T | null; previousWindow?: { from: string; to: string } | null; compareLabels?: { current: string; previous: string | null } }> {
  const result: any = await run(window);
  if (q.compare !== "1") return result;
  const pw = asOf
    ? prevWindow(window.to, window.to, booksBegin)
    : prevWindow(window.from, window.to, booksBegin);
  const label = (w: { from: string }) => {
    const s = fyStart(w.from, financialYearStart);
    const y = parseInt(s.slice(0, 4), 10);
    return `FY ${y}-${String((y + 1) % 100).padStart(2, "0")}`;
  };
  result.compareLabels = { current: label(window), previous: pw ? label(pw) : null };
  result.previousWindow = pw;
  result.previous = pw ? await run(pw) : null;
  return result;
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
    return withCompare(req.query as any, company?.booksBeginFrom, company?.financialYearStart,
      period(req.query as any, company?.booksBeginFrom, company?.financialYearStart),
      (w) => trialBalance(c, w));
  });

  app.get("/profit-loss", async (req) => {
    const c = await cid(req);
    const [company] = await db.select().from(companies).where(eq(companies.id, c));
    return withCompare(req.query as any, company?.booksBeginFrom, company?.financialYearStart,
      period(req.query as any, company?.booksBeginFrom, company?.financialYearStart),
      (w) => profitAndLoss(c, w));
  });

  app.get("/balance-sheet", async (req) => {
    const c = await cid(req);
    const [company] = await db.select().from(companies).where(eq(companies.id, c));
    return withCompare(req.query as any, company?.booksBeginFrom, company?.financialYearStart,
      { from: (req.query as any).to ?? today(), to: (req.query as any).to ?? today() },
      (w) => balanceSheet(c, w.to), true);
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
    const p = period(req.query as any, company?.booksBeginFrom, company?.financialYearStart);
    const result = await ledgerVouchers(c, parseInt((req.params as any).ledgerId, 10), p);
    if (!result) throw bad("Ledger not found");
    return result;
  });

  app.get("/group-summary/:groupId", async (req) => {
    const c = await cid(req);
    const [company] = await db.select().from(companies).where(eq(companies.id, c));
    const p = period(req.query as any, company?.booksBeginFrom, company?.financialYearStart);
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

  // R-63: Chart of Accounts explorer — the whole chart in one payload:
  // every group node (full tree, includeZero — masters always visible) with
  // rolled-up opening/debit/credit/closing, plus the ledger leaves with their
  // own balances. Read-only; period-scoped like every report.
  app.get("/chart-of-accounts", async (req) => {
    const c = await cid(req);
    const [company] = await db.select().from(companies).where(eq(companies.id, c));
    const p = period(req.query as any, company?.booksBeginFrom, company?.financialYearStart);
    const balances = await ledgerBalances(c, p.from, p.to);
    const groupRows = await getGroupRows(c);
    // `groups` carries rolled-up node totals; `ledgers` is the flat leaf list
    // (every master, zero-activity included) the client grafts under groupId.
    return { period: p, groups: buildGroupTree(groupRows, balances, { includeZero: true }), ledgers: balances };
  });

  app.get("/cash-bank", async (req) => {
    const c = await cid(req);
    const [company] = await db.select().from(companies).where(eq(companies.id, c));
    return cashBankBook(c, period(req.query as any, company?.booksBeginFrom, company?.financialYearStart));
  });

  app.get("/register", async (req) => {
    const c = await cid(req);
    const [company] = await db.select().from(companies).where(eq(companies.id, c));
    const p = period(req.query as any, company?.booksBeginFrom, company?.financialYearStart);
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
    const p = period(req.query as any, company?.booksBeginFrom, company?.financialYearStart);
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

  // R-30: DIRECT e-way bill generation (no IRN — B2C). Same partB query
  // contract and the same honest mapping as the IRN path; the service owns
  // the friendly IRN-exists boundary and the idempotency, so the route is a
  // thin cid-gated adapter — identical to every other submission route.
  app.post("/ewaybill/:voucherId/generate-direct", async (req, reply) => {
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
    const result = await generateEwbDirect(c, vid, req.userId as number, partB, submitEnv(req));
    const code = result.ok ? 200 : result.validationErrors ? 422 : result.duplicate ? 409 : 502;
    if (!result.ok) {
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
    const p = period(req.query as any, company?.booksBeginFrom, company?.financialYearStart);
    return gstr3b(c, p.from, p.to);
  });

  // R-26: GSTR-9 annual return — pure projection of gstr1/gstr3b over the
  // financial year plus duty-ledger reconciliation (Table 8). Read-only.
  app.get("/gstr9", async (req) => {
    const c = await cid(req);
    const [company] = await db.select().from(companies).where(eq(companies.id, c));
    const p = period(req.query as any, company?.booksBeginFrom, company?.financialYearStart);
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
    const p = period(req.query as any, company?.booksBeginFrom, company?.financialYearStart);

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
      // R-33: per-section FY aggregates — same advisory purpose as the TDS
      // report (the 206C(1H) trigger is per-buyer turnover; the per-section FY
      // total is the honest company-level approximation; per-buyer tracking
      // stays out of scope, documented in R-33_INVESTIGATION.md).
      fyAggregates: await tdsTcsFyAggregates(c, "TCS"),
    };
  });

  // TDS report: deductions by section + payable balances
  app.get("/tds", async (req) => {
    const c = await cid(req);
    const [company] = await db.select().from(companies).where(eq(companies.id, c));
    const p = period(req.query as any, company?.booksBeginFrom, company?.financialYearStart);

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
      // R-33: per-section FY aggregates so the stored threshold becomes
      // actionable advisory data (what the law actually measures), not an
      // orphaned reference column. Derived from the same postings — no new
      // state, no enforcement.
      fyAggregates: await tdsTcsFyAggregates(c, "TDS"),
    };
  });

  // R-33: threshold advisory check — read-only, NON-BLOCKING. Given a duty
  // head and the voucher's section lines, returns per-section FY aggregates
  // plus the advisory wording the client may show. The client decides what to
  // surface; the server never refuses a voucher on a threshold (the operator
  // judges; the books record — A-04 posture, R-33_INVESTIGATION.md).
  app.get("/tds-threshold-check", async (req) => {
    const c = await cid(req);
    const q = req.query as any;
    const dutyHead = String(q.dutyHead ?? "TDS") === "TCS" ? "TCS" : "TDS";
    const aggregates = await tdsTcsFyAggregates(c, dutyHead);
    const sections = await db.select().from(dutyHead === "TDS" ? tdsSections : tcsSections).where(eq((dutyHead === "TDS" ? tdsSections : tcsSections).companyId, c));
    const advisories = aggregates.map((s) => {
      // Mode-aware comparison. aggregate mode (default): the FY BASE is
      // compared with the threshold. single mode: the threshold binds PER
      // PAYMENT — the advisory reflects the LARGEST single base line this FY
      // (maxSingle), the payment most plainly at risk; the FY total is still
      // shown for context. threshold=0 never triggers (no recorded threshold
      // — no guessing).
      // R-37: the statutory unit is PER PAYEE (per ledger declaring the
      // section). Each payee is evaluated individually; the section row
      // remains as the rollup across payees ("across payees" label). The
      // wording substrings earlier consumers match on ("TDS/TCS due",
      // "single", "no threshold recorded") are preserved in every branch.
      const mode = s.thresholdMode ?? "aggregate";
      const payeeOver = (p: { ledgerName: string; hasPan: boolean; fyAmount: number; maxSingle: number }) =>
        mode === "single" ? p.maxSingle >= s.threshold : p.fyAmount >= s.threshold;
      const payeeNear = (p: { ledgerName: string; hasPan: boolean; fyAmount: number; maxSingle: number }) =>
        !payeeOver(p) && (mode === "single" ? p.maxSingle : p.fyAmount) > 0 && (mode === "single" ? p.maxSingle : p.fyAmount) >= s.threshold * 0.8;
      const payeeWording = (p: { ledgerId: number; ledgerName: string; hasPan: boolean; fyAmount: number; maxSingle: number }) => {
        const panNote = p.hasPan ? "" : " — PAN/GSTIN not recorded for this payee; verify before remitting";
        if (s.threshold <= 0) return `Payee "${p.ledgerName}" under ${s.section}: no threshold recorded — confirm applicability manually`;
        if (payeeOver(p)) {
          if (mode === "single") return `Payee "${p.ledgerName}" (${s.section}): largest single payment ₹${p.maxSingle.toLocaleString("en-IN")} meets/exceeds the ₹${s.threshold.toLocaleString("en-IN")} per-payment threshold (single mode) — TDS/TCS applies to payments at or above it${panNote}`;
          return `Payee "${p.ledgerName}" (${s.section}): ₹${p.fyAmount.toLocaleString("en-IN")} this FY (threshold ₹${s.threshold.toLocaleString("en-IN")}) — TDS/TCS due on further payments${panNote}`;
        }
        if (payeeNear(p)) {
          if (mode === "single") return `Payee "${p.ledgerName}" (${s.section}): largest single payment ₹${p.maxSingle.toLocaleString("en-IN")} is near the ₹${s.threshold.toLocaleString("en-IN")} per-payment threshold (single mode)`;
          return `Payee "${p.ledgerName}" (${s.section}): ₹${p.fyAmount.toLocaleString("en-IN")} this FY — approaching the ₹${s.threshold.toLocaleString("en-IN")} threshold`;
        }
        return `Payee "${p.ledgerName}" (${s.section}): ₹${p.fyAmount.toLocaleString("en-IN")} this FY — threshold ₹${s.threshold.toLocaleString("en-IN")} not yet reached${mode === "single" ? " (single mode: threshold applies per payment)" : ""}`;
      };
      const payeesEval = (s.payees ?? []).map((p: any) => ({
        ...p,
        over: s.threshold > 0 && payeeOver(p),
        near: s.threshold > 0 && payeeNear(p),
        wording: payeeWording(p),
      }));
      const compare = mode === "single" ? s.maxSingle : s.fyAmount;
      const over = s.threshold > 0 && compare >= s.threshold;
      const near = !over && s.threshold > 0 && compare > 0 && compare >= s.threshold * 0.8;
      const wording = s.threshold <= 0
        ? `Section ${s.section}: no threshold recorded — confirm applicability manually`
        : over
          ? mode === "single"
            ? `Section ${s.section}: largest single payment ₹${s.maxSingle.toLocaleString("en-IN")} meets/exceeds the ₹${s.threshold.toLocaleString("en-IN")} per-payment threshold (single mode) — TDS/TCS applies to payments at or above it`
            : `Section ${s.section}: ₹${s.fyAmount.toLocaleString("en-IN")} this FY across payees (threshold ₹${s.threshold.toLocaleString("en-IN")}) — TDS/TCS due on further payments`
          : near
            ? mode === "single"
              ? `Section ${s.section}: largest single payment ₹${s.maxSingle.toLocaleString("en-IN")} is near the ₹${s.threshold.toLocaleString("en-IN")} per-payment threshold (single mode)`
              : `Section ${s.section}: ₹${s.fyAmount.toLocaleString("en-IN")} this FY across payees — approaching the ₹${s.threshold.toLocaleString("en-IN")} threshold`
            : `Section ${s.section}: ₹${s.fyAmount.toLocaleString("en-IN")} this FY — threshold ₹${s.threshold.toLocaleString("en-IN")} not yet reached${mode === "single" ? " (single mode: threshold applies per payment)" : ""}`;
      return { ...s, over, near, wording, payees: payeesEval };
    });
    return { dutyHead, advisories, sectionCount: sections.length };
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
