import { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { vouchers, voucherEntries, ledgers, voucherTypes, groups } from "../db/schema.js";
import { and, eq, gte, lte, asc, isNotNull, ne, inArray } from "drizzle-orm";
import { cid, bad, pgFriendly } from "../lib/routes.js";
import { num, r2, today } from "../lib/util.js";
import { recordAuditEvent } from "./vouchers.js";

export default async function bankingRoutes(app: FastifyInstance) {
  // R-84 (A1): Tally's deposit slip is a BANK instrument — the seeded "Cash"
  // ledger (isBankCash) is not a bank. Deposit/payment-advice candidates scope
  // to ledgers in the "Bank Accounts" group so unrelated cash-ledger legs can
  // never leak into the slips.
  const bankLedgerIds = async (companyId: number): Promise<number[]> => {
    const rows = await db
      .select({ id: ledgers.id })
      .from(ledgers)
      .innerJoin(groups, eq(groups.id, ledgers.groupId))
      .where(and(eq(ledgers.companyId, companyId), eq(groups.name, "Bank Accounts")));
    return rows.map((r) => r.id);
  };

  // R-84 (A1): the deposit-slips bank picker — the SAME bank definition the
  // candidates endpoint enforces (Bank Accounts group), so the page can never
  // offer a ledger that would yield a foreign list. Fields are aliased to the
  // slip faces' expectations (bankLedger/bankAccount).
  app.get("/banks", async (req) => {
    const c = await cid(req);
    const ids = await bankLedgerIds(c);
    if (!ids.length) return [];
    return db
      .select({ id: ledgers.id, bankLedger: ledgers.name, bankAccount: ledgers.bankAccountNumber })
      .from(ledgers)
      .where(and(eq(ledgers.companyId, c), inArray(ledgers.id, ids)))
      .orderBy(asc(ledgers.name));
  });

  // Cheque register: all vouchers carrying a cheque number with their bank ledger line
  app.get("/cheque-register", async (req) => {
    const c = await cid(req);
    const q = req.query as any;
    // R-02: cancelled vouchers must not appear as active cheque transactions.
    const conds = [eq(vouchers.companyId, c), eq(vouchers.isCancelled, false), eq(vouchers.isOptional, false), isNotNull(vouchers.chequeNumber), ne(vouchers.chequeNumber, "")];
    if (q.from) conds.push(gte(vouchers.date, q.from));
    if (q.to) conds.push(lte(vouchers.date, q.to));

    const rows = await db
      .select({
        voucherId: vouchers.id, date: vouchers.date, chequeNumber: vouchers.chequeNumber,
        chequeDate: vouchers.chequeDate, typeName: voucherTypes.name, number: vouchers.number,
        narration: vouchers.narration,
        // R-73 (F-73-5): instrument taxonomy (cheque|rtgs|neft|upi|other|null).
        txnType: vouchers.bankTxnType,
        // R-73 (F-73-5): reconciliation date for the BRS view (null = unreconciled).
        reconciledAt: vouchers.reconciledAt,
        // R-83 (F-83-7): Bank Allocation Ref ID + Tally's post-dated class.
        bankRefId: vouchers.bankRefId,
        isPostDated: vouchers.isPostDated,
        // R-84 (A1): deposit-slip printed bookkeeping (null = never printed).
        depositSlipPrintedAt: vouchers.depositSlipPrintedAt,
      })
      .from(vouchers)
      .innerJoin(voucherTypes, eq(voucherTypes.id, vouchers.voucherTypeId))
      .where(and(...conds))
      .orderBy(asc(vouchers.date), asc(vouchers.id));

    const result = [];
    for (const r of rows) {
      const bankLines = await db
        .select({ ledgerName: ledgers.name, amount: voucherEntries.amount, bankAccount: ledgers.bankAccountNumber })
        .from(voucherEntries)
        .innerJoin(ledgers, eq(ledgers.id, voucherEntries.ledgerId))
        .where(and(eq(voucherEntries.voucherId, r.voucherId), eq(ledgers.isBankCash, true)));
      for (const b of bankLines) {
        // R-83 (F-83-7): Tally's register classes — cleared (operator-confirmed
        // BRS reconciliation), pdc (post-dated, instrument not yet due), due
        // (post-dated whose instrument date has arrived — treat like a normal
        // open cheque), open (plain unreconciled). Derived, never stored.
        const status =
          r.reconciledAt != null
            ? "cleared"
            : r.isPostDated && r.chequeDate && r.chequeDate > today()
              ? "pdc"
              : r.isPostDated
                ? "due"
                : "open";
        result.push({ ...r, status, bankLedger: b.ledgerName, bankAccount: b.bankAccount, amount: r2(Math.abs(num(b.amount))), direction: num(b.amount) > 0 ? "issued" : "received" });
      }
    }
    // R-83 (F-83-7): optional class filter (?status=pdc|due|cleared|open).
    const st = String((req.query as any)?.status ?? "");
    return ["pdc", "due", "cleared", "open"].includes(st) ? result.filter((x) => x.status === st) : result;
  });

  // ---- R-73 (F-73-5): Bank Reconciliation statement data ----
  // Honest operator-confirmed BRS: a voucher's bank leg is "cleared" when the
  // operator marks it reconciled against their statement (no statement import,
  // no auto-matching — zprime never fabricates bank facts). A leg is a bank
  // LEDGER entry on the voucher: debit (positive) = deposit, credit (negative)
  // = withdrawal. The statement balance shown is the books' closing minus the
  // un-cleared legs — the classical Tally BRS identity, derived from data the
  // company actually recorded.
  app.get("/bank-reconciliation", async (req) => {
    const c = await cid(req);
    const q = req.query as any;
    let bankLedgerId = parseInt(q.ledgerId ?? "", 10);
    if (!Number.isFinite(bankLedgerId) || bankLedgerId <= 0) {
      // Default: the company's first bank/cash ledger (the picker's first row).
      const [first] = await db.select({ id: ledgers.id }).from(ledgers)
        .where(and(eq(ledgers.companyId, c), eq(ledgers.isBankCash, true)))
        .orderBy(asc(ledgers.id)).limit(1);
      if (!first) throw bad("No bank/cash ledger found for this company");
      bankLedgerId = first.id;
    }
    const [bank] = await db.select().from(ledgers).where(and(eq(ledgers.companyId, c), eq(ledgers.id, bankLedgerId)));
    if (!bank) throw bad("Ledger not found", 404);
    const asOf = /^\d{4}-\d{2}-\d{2}$/.test(String(q.asOf ?? "")) ? String(q.asOf) : today();
    const legs = await db
      .select({
        voucherId: vouchers.id, date: vouchers.date, number: vouchers.number, typeName: voucherTypes.name,
        narration: vouchers.narration, reconciledAt: vouchers.reconciledAt, amount: voucherEntries.amount,
      })
      .from(voucherEntries)
      .innerJoin(vouchers, eq(vouchers.id, voucherEntries.voucherId))
      .innerJoin(voucherTypes, eq(voucherTypes.id, vouchers.voucherTypeId))
      .where(and(
        eq(vouchers.companyId, c), eq(vouchers.isCancelled, false), eq(vouchers.isOptional, false),
        lte(vouchers.date, asOf), eq(voucherEntries.ledgerId, bankLedgerId),
      ))
      .orderBy(asc(vouchers.date), asc(vouchers.id));
    const bookClosing = r2(num(bank.openingBalance) + legs.reduce((s, r) => s + num(r.amount), 0));
    const items = legs.map((r) => ({
      voucherId: r.voucherId, date: r.date, number: r.number, typeName: r.typeName, narration: r.narration,
      amount: r2(num(r.amount)), // deposit + / withdrawal −
      reconciled: r.reconciledAt != null && r.reconciledAt <= asOf,
      reconciledAt: r.reconciledAt,
    }));
    const reconciledTotal = r2(items.filter((i) => i.reconciled).reduce((s, i) => s + i.amount, 0));
    const outstandingTotal = r2(items.filter((i) => !i.reconciled).reduce((s, i) => s + i.amount, 0));
    return {
      ledgerId: bankLedgerId, ledgerName: bank.name, asOf,
      bookClosing,
      reconciledTotal,
      outstandingTotal,
      // Classical BRS identity: books' closing adjusted for un-cleared legs.
      balanceAsPerStatement: r2(bookClosing - outstandingTotal),
      items,
    };
  });

  // ---- R-73 (F-73-5): mark/unmark a voucher's bank leg as reconciled ----
  app.patch("/vouchers/:id/reconcile", async (req) => {
    const c = await cid(req);
    const id = parseInt((req.params as any).id, 10);
    if (!Number.isFinite(id) || id <= 0) throw bad("Invalid voucher id");
    const body = req.body as any;
    if (typeof body?.reconciled !== "boolean") throw bad("reconciled must be a boolean");
    const reconciledDate = body.reconciled
      ? (/^\d{4}-\d{2}-\d{2}$/.test(String(body?.date ?? "")) ? String(body.date) : today())
      : null;
    try {
      return await db.transaction(async (tx) => {
        const [v] = await tx.select().from(vouchers).where(and(eq(vouchers.companyId, c), eq(vouchers.id, id))).for("update");
        if (!v) throw bad("Voucher not found", 404);
        if (v.isCancelled) throw bad("Cancelled vouchers cannot be reconciled", 409);
        if (v.isOptional) throw bad("Optional (draft) vouchers cannot be reconciled", 409);
        await tx.update(vouchers).set({ reconciledAt: reconciledDate }).where(eq(vouchers.id, id));
        await recordAuditEvent(tx, c, id, req.userId, body.reconciled ? "reconcile" : "unreconcile");
        return { ok: true, id, reconciledAt: reconciledDate };
      });
    } catch (err: any) {
      throw pgFriendly(err);
    }
  });

  // ---- R-84 (A1): Deposit Slips / Payment Advice ---- Tally's banking-print
  // family: a REPORT over recorded bank legs, not new accounting. The listing
  // is the register service's data re-filtered: deposit candidates are legs on
  // Receipt/Contra vouchers (money ARRIVING at this bank), payment-advice
  // candidates are Payment legs (money LEAVING). Printed bookkeeping is an
  // explicit operator action stamped in the same transaction as the audit
  // event — never inferred, never back-filled.
  app.get("/deposit-candidates", async (req) => {
    const c = await cid(req);
    const q = req.query as any;
    const bankIds = await bankLedgerIds(c);
    const kind = q.kind === "payment-advice" ? "payment-advice" : "deposit";
    const includePrinted = q.includePrinted === "1" || q.includePrinted === "true";
    const types = kind === "deposit" ? ["Receipt", "Contra"] : ["Payment"];
    const rows = await db
      .select({
        voucherId: vouchers.id, date: vouchers.date, number: vouchers.number, typeName: voucherTypes.name,
        narration: vouchers.narration, txnType: vouchers.bankTxnType,
        chequeNumber: vouchers.chequeNumber, chequeDate: vouchers.chequeDate,
        bankRefId: vouchers.bankRefId, amount: voucherEntries.amount,
        ledgerId: ledgers.id, bankLedger: ledgers.name, bankAccount: ledgers.bankAccountNumber,
        printedAt: vouchers.depositSlipPrintedAt,
        reconciledAt: vouchers.reconciledAt,
      })
      .from(voucherEntries)
      .innerJoin(vouchers, eq(vouchers.id, voucherEntries.voucherId))
      .innerJoin(voucherTypes, eq(voucherTypes.id, vouchers.voucherTypeId))
      .innerJoin(ledgers, eq(ledgers.id, voucherEntries.ledgerId))
      .where(and(
        eq(vouchers.companyId, c), eq(vouchers.isCancelled, false), eq(vouchers.isOptional, false),
        bankIds.length ? inArray(ledgers.id, bankIds) : undefined, inArray(voucherTypes.name, types),
        q.ledgerId ? eq(ledgers.id, parseInt(String(q.ledgerId), 10) || 0) : undefined,
      ))
      .orderBy(asc(vouchers.date), asc(vouchers.id));
    const seen = new Set<number>();
    const result: any[] = [];
    for (const r of rows) {
      // One row per voucher (a voucher may carry several bank legs; the slip
      // aggregates the voucher). Direction check keeps Contra transfers that
      // LEAVE the bank out of deposit candidates and vice versa.
      const amt = num(r.amount);
      if (kind === "deposit" && amt <= 0) continue;
      if (kind === "payment-advice" && amt >= 0) continue;
      if (seen.has(r.voucherId)) continue;
      seen.add(r.voucherId);
      if (!includePrinted && r.printedAt != null) continue;
      result.push({
        voucherId: r.voucherId, date: r.date, number: r.number, typeName: r.typeName,
        narration: r.narration, txnType: r.txnType ?? "cheque",
        chequeNumber: r.chequeNumber, chequeDate: r.chequeDate, bankRefId: r.bankRefId,
        bankLedger: r.bankLedger, bankAccount: r.bankAccount,
        amount: r2(Math.abs(amt)), printedAt: r.printedAt, reconciled: r.reconciledAt != null,
        // Received-from: the voucher's narration carries Tally's "Being received from X".
        receivedFrom: (r.narration ?? "").replace(/^being\s+/i, "").trim() || null,
      });
    }
    return result;
  });

  // R-84 (A1): stamp/clear the printed flag for the selected vouchers.
  app.patch("/deposit-slips/print", async (req) => {
    const c = await cid(req);
    const body = req.body as any;
    const ids: number[] = Array.isArray(body?.voucherIds) ? body.voucherIds.map((x: any) => parseInt(x, 10)).filter((x: number) => Number.isFinite(x) && x > 0) : [];
    if (!ids.length) throw bad("voucherIds must be a non-empty array");
    const printed = body.printed !== false; // default: stamp
    try {
      return await db.transaction(async (tx) => {
        for (const id of ids) {
          const [v] = await tx.select().from(vouchers).where(and(eq(vouchers.companyId, c), eq(vouchers.id, id))).for("update");
          if (!v) throw bad(`Voucher ${id} not found`, 404);
          if (v.isCancelled || v.isOptional) continue; // nothing to print on
        }
        await tx.update(vouchers)
          .set({ depositSlipPrintedAt: printed ? new Date() : null })
          .where(and(eq(vouchers.companyId, c), inArray(vouchers.id, ids)));
        await recordAuditEvent(tx, c, ids[0], req.userId, printed ? "deposit-slip-print" : "deposit-slip-unprint");
        return { ok: true, ids, printedAt: printed ? new Date().toISOString() : null };
      });
    } catch (err: any) {
      throw pgFriendly(err);
    }
  });
}
