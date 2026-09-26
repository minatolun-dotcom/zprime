import { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { vouchers, voucherEntries, ledgers, voucherTypes } from "../db/schema.js";
import { and, eq, gte, lte, asc, isNotNull, ne } from "drizzle-orm";
import { cid, bad, pgFriendly } from "../lib/routes.js";
import { num, r2, today } from "../lib/util.js";
import { recordAuditEvent } from "./vouchers.js";

export default async function bankingRoutes(app: FastifyInstance) {
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
        result.push({ ...r, bankLedger: b.ledgerName, bankAccount: b.bankAccount, amount: r2(Math.abs(num(b.amount))), direction: num(b.amount) > 0 ? "issued" : "received" });
      }
    }
    return result;
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
}
