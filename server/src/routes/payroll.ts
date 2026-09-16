import { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { employees, payHeads, salaryStructures, payslips, vouchers, voucherTypes, ledgers, voucherEntries } from "../db/schema.js";
import { and, asc, eq, inArray } from "drizzle-orm";
import { cid, bad, pgFriendly, pgCode, salaryStructureSchema } from "../lib/routes.js";
import { r2, num, today, monthLabel } from "../lib/util.js";
import { crud } from "./crud.js";
import { nextNumber } from "./vouchers.js";

export default async function payrollRoutes(app: FastifyInstance) {
  crud(app, "employees", employees, { orderBy: (a: any, b: any) => (a.name ?? "").localeCompare(b.name ?? "") });
  // R-08 (F-08-1): a pay-head's posting ledger must belong to the same company —
  // a foreign-ledger pay-head silently unbalanced the TB when payroll posted.
  crud(app, "pay-heads", payHeads, { orderBy: (a: any, b: any) => (a.name ?? "").localeCompare(b.name ?? ""),
    refs: { ledgerId: { table: ledgers, label: "Ledger" } } });

  app.get("/salary-structure/:employeeId", async (req) => {
    const c = await cid(req);
    const empId = parseInt((req.params as any).employeeId, 10);
    const rows = await db
      .select({
        id: salaryStructures.id, headId: salaryStructures.headId, headName: payHeads.name,
        type: payHeads.type, monthlyAmount: salaryStructures.monthlyAmount,
      })
      .from(salaryStructures)
      .innerJoin(payHeads, eq(payHeads.id, salaryStructures.headId))
      .where(and(eq(salaryStructures.companyId, c), eq(salaryStructures.employeeId, empId)));
    return rows;
  });

  app.put("/salary-structure/:employeeId", async (req) => {
    const c = await cid(req);
    const empId = parseInt((req.params as any).employeeId, 10);
    // A-03 guard: salary amounts are non-negative — a deduction's amount is the
    // amount DEDUCTED. Negative values would silently inflate net pay.
    const parsed = salaryStructureSchema.safeParse(req.body);
    if (!parsed.success) throw bad("Invalid salary structure: " + parsed.error.issues[0]?.message);
    // Employee must belong to the caller's company (isolation).
    const [emp] = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.companyId, c), eq(employees.id, empId)));
    if (!emp) throw bad("Employee not found", 404);
    // R-08 (F-08-1): every head must belong to this company too.
    for (const id of [...new Set(parsed.data.lines.map((l) => l.headId))]) {
      const [row] = await db.select({ id: payHeads.id }).from(payHeads).where(and(eq(payHeads.companyId, c), eq(payHeads.id, id)));
      if (!row) throw bad(`Pay head ${id} does not exist in this company`);
    }
    await db.delete(salaryStructures).where(and(eq(salaryStructures.companyId, c), eq(salaryStructures.employeeId, empId)));
    for (const line of parsed.data.lines) {
      await db.insert(salaryStructures).values({
        companyId: c, employeeId: empId, headId: line.headId,
        monthlyAmount: String(r2(line.monthlyAmount)),
      });
    }
    return { ok: true };
  });

  // Process payroll for a month: creates a Payroll voucher + payslips.
  // Entirely transactional: voucher, entries and payslips commit together and
  // the duplicate-month guard is race-safe (serializable + payslip unique index).
  app.post("/payroll/process", async (req) => {
    const c = await cid(req);
    const { month } = (req.body as any) as { month: string }; // YYYY-MM
    if (!/^\d{4}-\d{2}$/.test(month) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw bad("month must be YYYY-MM");

    try {
      return await db.transaction(async (tx) => {
        const existing = await tx.select({ id: payslips.id }).from(payslips).where(and(eq(payslips.companyId, c), eq(payslips.month, month))).limit(1);
        if (existing.length > 0) throw bad(`Payroll for ${monthLabel(month)} already processed`);

        const [payrollType] = await tx.select().from(voucherTypes).where(and(eq(voucherTypes.companyId, c), eq(voucherTypes.name, "Payroll")));
        if (!payrollType) throw bad("Payroll voucher type missing");

        const [salaryPayable] = await tx.select().from(ledgers).where(and(eq(ledgers.companyId, c), eq(ledgers.name, "Salary Payable")));
        if (!salaryPayable) throw bad("Salary Payable ledger missing");

        const empRows = await tx.select().from(employees).where(and(eq(employees.companyId, c), eq(employees.isActive, true)));
        const heads = await tx.select().from(payHeads).where(eq(payHeads.companyId, c));
        const headById = new Map(heads.map((h) => [h.id, h]));

        // R-08 (F-08-1) belt-and-braces: heads are company-scoped, but a legacy
        // row may carry a foreign ledgerId (accepted before R-08). Failing loudly
        // here is strictly better than posting an entry invisible to both
        // companies' reports and silently unbalancing the TB.
        if (heads.length > 0) {
          const ledgerIds = [...new Set(heads.map((h) => h.ledgerId))];
          const ledRows = await tx.select({ id: ledgers.id }).from(ledgers).where(and(eq(ledgers.companyId, c), inArray(ledgers.id, ledgerIds)));
          if (ledRows.length !== ledgerIds.length) {
            const okIds = new Set(ledRows.map((l) => l.id));
            const badHead = heads.find((h) => !okIds.has(h.ledgerId));
            throw bad(`Pay head "${badHead?.name ?? "?"}" references a ledger outside this company. Fix the pay head before processing payroll.`);
          }
        }

    const date = `${month}-28`; // month-end-ish posting date
    const entries: { ledgerId: number; amount: number }[] = [];
    const slips: { employeeId: number; lines: any[]; gross: number; deductions: number; net: number }[] = [];

      for (const emp of empRows) {
        const structure = await tx
          .select()
          .from(salaryStructures)
          .where(and(eq(salaryStructures.companyId, c), eq(salaryStructures.employeeId, emp.id)));
      const lines = structure.map((s) => {
        const head = headById.get(s.headId)!;
        return { headId: s.headId, headName: head.name, type: head.type, amount: r2(Math.abs(num(s.monthlyAmount))) };
      });
      // Deduction amounts are non-negative by schema (A-03). Belt-and-braces:
      // clamp at the computation boundary too, so legacy negative rows can no
      // longer inflate net pay.
      const gross = r2(lines.filter((l) => l.type === "earning").reduce((s, l) => s + l.amount, 0));
      const deductions = r2(lines.filter((l) => l.type === "deduction").reduce((s, l) => s + Math.abs(l.amount), 0));
      const net = r2(gross - deductions);
      for (const l of lines) {
        const head = headById.get(l.headId)!;
        if (l.amount === 0) continue;
        // Payroll voucher: earnings are debited to expense ledgers, deductions credited to liability ledgers
        entries.push({ ledgerId: head.ledgerId, amount: head.type === "earning" ? l.amount : -l.amount });
      }
      entries.push({ ledgerId: salaryPayable.id, amount: -net });
      slips.push({ employeeId: emp.id, lines, gross, deductions, net });
    }

      if (slips.length === 0) throw bad("No active employees to process");

      // Merge ledger amounts & enforce double entry
      const merged = new Map<number, number>();
      for (const e of entries) merged.set(e.ledgerId, r2((merged.get(e.ledgerId) ?? 0) + e.amount));
      const finalEntries = [...merged.entries()].filter(([, amt]) => Math.abs(amt) > 0.004).map(([ledgerId, amount]) => ({ ledgerId, amount }));
      const total = r2(finalEntries.reduce((s, e) => s + e.amount, 0));
      if (Math.abs(total) > 0.004) throw bad(`Payroll entries do not balance (diff ${total.toFixed(2)})`);

      const number = await nextNumber(tx, c, payrollType.id);

      const [v] = await tx.insert(vouchers).values({
        companyId: c, voucherTypeId: payrollType.id, date, number,
        narration: `Payroll for ${monthLabel(month)}`, source: "payroll",
      }).returning();

      for (let i = 0; i < finalEntries.length; i++) {
        await tx.insert(voucherEntries).values({ voucherId: v.id, ledgerId: finalEntries[i].ledgerId, amount: String(finalEntries[i].amount), order: i });
      }

      for (const s of slips) {
        await tx.insert(payslips).values({
          companyId: c, voucherId: v.id, employeeId: s.employeeId, month,
          lines: s.lines, gross: String(s.gross), deductions: String(s.deductions), net: String(s.net),
        });
      }

      return { voucherId: v.id, employees: slips.length, total: r2(slips.reduce((s, x) => s + x.net, 0)) };
      });
    } catch (err: any) {
      // Race-safe duplicate-month guard: two simultaneous runs — the loser hits
      // the payslip unique index rather than double-posting salary.
      const detail = String(err?.detail ?? err?.cause?.detail ?? "");
      if (pgCode(err) === "23505" && (detail.includes("pslip_emp_month_uq") || detail.includes("payslips"))) {
        throw bad(`Payroll for ${monthLabel(month)} already processed`);
      }
      throw pgFriendly(err);
    }
  });
}
