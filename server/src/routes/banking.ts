import { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { vouchers, voucherEntries, ledgers, voucherTypes } from "../db/schema.js";
import { and, eq, gte, lte, asc, isNotNull, ne } from "drizzle-orm";
import { cid } from "../lib/routes.js";
import { num, r2 } from "../lib/util.js";

export default async function bankingRoutes(app: FastifyInstance) {
  // Cheque register: all vouchers carrying a cheque number with their bank ledger line
  app.get("/cheque-register", async (req) => {
    const c = await cid(req);
    const q = req.query as any;
    const conds = [eq(vouchers.companyId, c), isNotNull(vouchers.chequeNumber), ne(vouchers.chequeNumber, "")];
    if (q.from) conds.push(gte(vouchers.date, q.from));
    if (q.to) conds.push(lte(vouchers.date, q.to));

    const rows = await db
      .select({
        voucherId: vouchers.id, date: vouchers.date, chequeNumber: vouchers.chequeNumber,
        chequeDate: vouchers.chequeDate, typeName: voucherTypes.name, number: vouchers.number,
        narration: vouchers.narration,
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
}
