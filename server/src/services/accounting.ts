import { db } from "../db/index.js";
import { companies, groups, ledgers, vouchers, voucherEntries, billAllocations, voucherTypes } from "../db/schema.js";
import { and, eq, gte, lte, sql, asc, desc } from "drizzle-orm";
import { num, r2, addDays, cmpDate, fyStart } from "../lib/util.js";
import { stockClosingValue } from "./stock.js";

export interface Period { from: string; to: string }

export interface LedgerBalance {
  ledgerId: number; name: string; groupId: number; groupName: string; groupParentId: number | null;
  nature: string; affectsGross: boolean;
  opening: number; debit: number; credit: number; closing: number;
}

/** Per-ledger opening/movement/closing for a period. Opening includes pre-period movement. */
export async function ledgerBalances(companyId: number, from: string, to: string): Promise<LedgerBalance[]> {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  const booksBegin = company ? company.booksBeginFrom : from;

  const led = await db
    .select({
      id: ledgers.id, name: ledgers.name, groupId: ledgers.groupId,
      groupName: groups.name, groupParentId: groups.parentId, nature: groups.nature,
      affectsGross: groups.affectsGross, opening: ledgers.openingBalance,
    })
    .from(ledgers)
    .innerJoin(groups, eq(groups.id, ledgers.groupId))
    .where(eq(ledgers.companyId, companyId));

  const movements = await db
    .select({
      ledgerId: voucherEntries.ledgerId,
      debit: sql<string>`coalesce(sum(case when ${voucherEntries.amount} > 0 then ${voucherEntries.amount} else 0 end), 0)`,
      credit: sql<string>`coalesce(sum(case when ${voucherEntries.amount} < 0 then -${voucherEntries.amount} else 0 end), 0)`,
    })
    .from(voucherEntries)
    .innerJoin(vouchers, eq(vouchers.id, voucherEntries.voucherId))
    .where(and(eq(vouchers.companyId, companyId), eq(vouchers.isCancelled, false), gte(vouchers.date, from), lte(vouchers.date, to)))
    .groupBy(voucherEntries.ledgerId);

  const priorMovements = await db
    .select({
      ledgerId: voucherEntries.ledgerId,
      debit: sql<string>`coalesce(sum(case when ${voucherEntries.amount} > 0 then ${voucherEntries.amount} else 0 end), 0)`,
      credit: sql<string>`coalesce(sum(case when ${voucherEntries.amount} < 0 then -${voucherEntries.amount} else 0 end), 0)`,
    })
    .from(voucherEntries)
    .innerJoin(vouchers, eq(vouchers.id, voucherEntries.voucherId))
    .where(and(eq(vouchers.companyId, companyId), eq(vouchers.isCancelled, false), gte(vouchers.date, booksBegin), lte(vouchers.date, addDays(from, -1))))
    .groupBy(voucherEntries.ledgerId);

  const mv = new Map(movements.map((m) => [m.ledgerId, { dr: num(m.debit), cr: num(m.credit) }]));
  const pv = new Map(priorMovements.map((m) => [m.ledgerId, { dr: num(m.debit), cr: num(m.credit) }]));

  return led.map((l) => {
    const open = num(l.opening) + (pv.get(l.id)?.dr ?? 0) - (pv.get(l.id)?.cr ?? 0);
    const debit = mv.get(l.id)?.dr ?? 0;
    const credit = mv.get(l.id)?.cr ?? 0;
    return {
      ledgerId: l.id, name: l.name, groupId: l.groupId, groupName: l.groupName,
      groupParentId: l.groupParentId, nature: l.nature, affectsGross: l.affectsGross,
      opening: r2(open), debit: r2(debit), credit: r2(credit), closing: r2(open + debit - credit),
    };
  });
}

export interface TreeNode {
  id: number; name: string; nature: string; isReserved: boolean;
  opening: number; debit: number; credit: number; closing: number;
  children: TreeNode[];
}

/** Group tree aggregated with balances from ledger balances list. */
export function buildGroupTree(
  groupRows: { id: number; name: string; parentId: number | null; nature: string; isReserved: boolean }[],
  balances: LedgerBalance[],
  opts: { includeZero?: boolean } = {}
): TreeNode[] {
  const byId = new Map<number, TreeNode>();
  for (const g of groupRows) {
    byId.set(g.id, { id: g.id, name: g.name, nature: g.nature, isReserved: g.isReserved, opening: 0, debit: 0, credit: 0, closing: 0, children: [] });
  }
  for (const g of groupRows) {
    const node = byId.get(g.id)!;
    if (g.parentId && byId.has(g.parentId)) byId.get(g.parentId)!.children.push(node);
  }
  for (const b of balances) {
    const node = byId.get(b.groupId);
    if (!node) continue;
    node.opening = r2(node.opening + b.opening);
    node.debit = r2(node.debit + b.debit);
    node.credit = r2(node.credit + b.credit);
    node.closing = r2(node.closing + b.closing);
  }
  const roots = [...byId.values()].filter((n) => {
    const g = groupRows.find((gr) => gr.id === n.id)!;
    return !g.parentId || !byId.has(g.parentId);
  });
  // Roll children up the tree (bottom-up)
  const rollUp = (node: TreeNode): void => {
    for (const child of node.children) {
      rollUp(child);
      node.opening = r2(node.opening + child.opening);
      node.debit = r2(node.debit + child.debit);
      node.credit = r2(node.credit + child.credit);
      node.closing = r2(node.closing + child.closing);
    }
  };
  roots.forEach(rollUp);
  if (!opts.includeZero) {
    const prune = (nodes: TreeNode[]): TreeNode[] =>
      nodes.filter((n) => Math.abs(n.closing) > 0.004 || n.children.length > 0).map((n) => ({ ...n, children: prune(n.children) }));
    return prune(roots);
  }
  return roots;
}

export async function getGroupRows(companyId: number) {
  return db.select().from(groups).where(eq(groups.companyId, companyId)).orderBy(asc(groups.id));
}

/** R-07 (F-07-3): ids of `rootName` and every group below it (for structural BS zeroing). */
async function descendantGroupIds(companyId: number, rootName: string): Promise<Set<number>> {
  const rows = await db.select({ id: groups.id, name: groups.name, parentId: groups.parentId })
    .from(groups).where(eq(groups.companyId, companyId));
  const root = rows.find((r) => r.name === rootName);
  if (!root) return new Set();
  const byParent = new Map<number | null, number[]>();
  for (const r of rows) {
    const list = byParent.get(r.parentId) ?? [];
    list.push(r.id);
    byParent.set(r.parentId, list);
  }
  const out = new Set<number>([root.id]);
  const stack = [root.id];
  while (stack.length) {
    for (const child of byParent.get(stack.pop()!) ?? []) {
      if (!out.has(child)) { out.add(child); stack.push(child); }
    }
  }
  return out;
}

/** Trial balance rows. */
export async function trialBalance(companyId: number, period: Period) {
  const balances = await ledgerBalances(companyId, period.from, period.to);
  const rows = balances
    .filter((b) => Math.abs(b.closing) > 0.004 || Math.abs(b.opening) > 0.004)
    .map((b) => ({
      ledgerId: b.ledgerId, name: b.name, groupName: b.groupName,
      debit: b.closing > 0 ? b.closing : 0,
      credit: b.closing < 0 ? -b.closing : 0,
      openingDebit: b.opening > 0 ? b.opening : 0,
      openingCredit: b.opening < 0 ? -b.opening : 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const totalDebit = r2(rows.reduce((s, r) => s + r.debit, 0));
  const totalCredit = r2(rows.reduce((s, r) => s + r.credit, 0));
  // R-14: display-only health field (same class as the balance-sheet
  // `difference`) so the UI can surface an out-of-balance books state.
  // Pure arithmetic on the already-computed totals — no calculation changes.
  return { rows, totalDebit, totalCredit, difference: r2(totalDebit - totalCredit) };
}

/** Profit & Loss with trading + net sections. */
export async function profitAndLoss(companyId: number, period: Period) {
  const balances = await ledgerBalances(companyId, period.from, period.to);
  const groupRows = await getGroupRows(companyId);

  const pick = (groupName: string) => balances.filter((b) => b.groupName === groupName || groupAncestry(groupRows, b.groupId).includes(groupName));

  // A-06 fix: an income/expense report for a period must reflect THAT period's
  // activity (debit − credit within the range), not the cumulative-through
  // closing balance. `closing` folds in books-begin history via the opening
  // carried into the range, so it only equals the period movement for a range
  // that starts at books-begin.
  const periodMovement = (b: LedgerBalance) => r2(b.debit - b.credit);
  const sumMovement = (rows: LedgerBalance[]) => r2(rows.reduce((s, b) => s + periodMovement(b), 0));
  function groupAncestry(rows: any[], groupId: number): string[] {
    const byId = new Map(rows.map((r) => [r.id, r]));
    const out: string[] = [];
    let cur = byId.get(groupId);
    while (cur) {
      out.push(cur.name);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return out;
  }

  const openingStock = r2(await stockClosingValue(companyId, addDays(period.from, -1), "Stock-in-Hand"));
  const closingStock = r2(await stockClosingValue(companyId, period.to, "Stock-in-Hand"));

  // Income ledgers carry credit movements (credit > debit) — flip for positive revenue
  const sales = -sumMovement(pick("Sales Accounts"));
  const purchases = sumMovement(pick("Purchase Accounts"));
  const directIncome = -sumMovement(pick("Direct Incomes"));
  const directExpenses = sumMovement(pick("Direct Expenses"));
  const indirectIncome = -sumMovement(pick("Indirect Incomes"));
  const indirectExpenses = sumMovement(pick("Indirect Expenses"));

  const cogs = r2(purchases + openingStock - closingStock + directExpenses);
  const grossProfit = r2(sales + directIncome - cogs);
  const netProfit = r2(grossProfit + indirectIncome - indirectExpenses);

  const detail = (groupName: string, flip = false) =>
    pick(groupName)
      .filter((b) => Math.abs(periodMovement(b)) > 0.004)
      .map((b) => ({ ledgerId: b.ledgerId, name: b.name, amount: flip ? -periodMovement(b) : periodMovement(b) }))
      .sort((a, b) => a.name.localeCompare(b.name));

  return {
    openingStock, closingStock,
    sales, purchases, directExpenses, directIncome, grossProfit,
    indirectExpenses, indirectIncome, netProfit,
    salesDetail: detail("Sales Accounts", true),
    purchaseDetail: detail("Purchase Accounts"),
    directExpensesDetail: detail("Direct Expenses"),
    directIncomeDetail: detail("Direct Incomes", true),
    indirectExpensesDetail: detail("Indirect Expenses"),
    indirectIncomeDetail: detail("Indirect Incomes", true),
  };
}

/** Balance Sheet (liabilities & assets) as of a date. */
export async function balanceSheet(companyId: number, asOf: string) {
  const balances = await ledgerBalances(companyId, asOf, asOf);
  const groupRows = await getGroupRows(companyId);

  // Stock-in-Hand value comes from the inventory engine, not ledger balances.
  // R-07 (F-07-3): zero the Stock-in-Hand group AND all its descendants —
  // name-equality missed ledgers under SIH sub-groups (Finished Goods, Raw
  // Materials, …), which then double-counted stock in the asset fold.
  const closingStock = r2(await stockClosingValue(companyId, asOf));
  const sihIds = await descendantGroupIds(companyId, "Stock-in-Hand");
  for (const b of balances) if (sihIds.has(b.groupId)) b.closing = 0;

  const tree = buildGroupTree(groupRows, balances, { includeZero: true });

  // Compute P&L (net profit) for books-begin..asOf and add to capital section
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  const bsFrom = company ? company.booksBeginFrom : asOf;
  const pnl = await profitAndLoss(companyId, { from: bsFrom, to: asOf });

  const liabilities = tree.filter((t) => t.nature === "Liabilities");
  const assets = tree.filter((t) => t.nature === "Assets");
  // Inventory value is a top-level asset line (Stock-in-Hand ledger closings were zeroed above)
  assets.push({ id: -1, name: "Stock-in-Hand", nature: "Assets", isReserved: true, opening: 0, debit: 0, credit: 0, closing: closingStock, children: [] });

  const profitLine = { name: "Profit & Loss A/c", amount: pnl.netProfit, ledgerId: null as number | null };

  // Liability closings are credit-normal (negative) — flip for positive display totals
  const totalLiabilities = r2(-liabilities.reduce((s, l) => s + l.closing, 0) + pnl.netProfit);
  const totalAssets = r2(assets.reduce((s, a) => s + a.closing, 0));

  return {
    asOf,
    liabilities: liabilities.map((l) => ({ ...l, children: l.children })),
    assets: assets.map((a) => ({ ...a })),
    profitLine: Math.abs(pnl.netProfit) > 0.004 ? profitLine : null,
    stockValue: closingStock,
    totalLiabilities, totalAssets,
    difference: r2(totalLiabilities - totalAssets),
    netProfit: pnl.netProfit,
  };
}

/** Ledger voucher statement with running balance. */
export async function ledgerVouchers(companyId: number, ledgerId: number, period: Period) {
  const [ledger] = await db
    .select({ id: ledgers.id, name: ledgers.name, opening: ledgers.openingBalance })
    .from(ledgers)
    .where(and(eq(ledgers.companyId, companyId), eq(ledgers.id, ledgerId)));
  if (!ledger) return null;

  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  const booksBegin = company ? company.booksBeginFrom : period.from;

  const prior = await db
    .select({ total: sql<string>`coalesce(sum(${voucherEntries.amount}), 0)` })
    .from(voucherEntries)
    .innerJoin(vouchers, eq(vouchers.id, voucherEntries.voucherId))
    .where(and(
      eq(vouchers.companyId, companyId), eq(vouchers.isCancelled, false),
      eq(voucherEntries.ledgerId, ledgerId),
      gte(vouchers.date, booksBegin), lte(vouchers.date, addDays(period.from, -1)),
    ));

  let running = r2(num(ledger.opening) + num(prior[0]?.total));

  const rows = await db
    .select({
      voucherId: vouchers.id, date: vouchers.date, number: vouchers.number,
      typeName: voucherTypes.name, narration: vouchers.narration, isCancelled: vouchers.isCancelled,
      partyLedgerId: vouchers.partyLedgerId,
      amount: voucherEntries.amount,
    })
    .from(voucherEntries)
    .innerJoin(vouchers, eq(vouchers.id, voucherEntries.voucherId))
    .innerJoin(voucherTypes, eq(voucherTypes.id, vouchers.voucherTypeId))
    .where(and(
      eq(vouchers.companyId, companyId), eq(vouchers.isCancelled, false),
      eq(voucherEntries.ledgerId, ledgerId),
      gte(vouchers.date, period.from), lte(vouchers.date, period.to),
    ))
    .orderBy(asc(vouchers.date), asc(vouchers.id));

  const txns = rows.map((row) => {
    const amt = num(row.amount);
    running = r2(running + amt);
    return {
      voucherId: row.voucherId, date: row.date, number: row.number, typeName: row.typeName,
      narration: row.narration, debit: amt > 0 ? amt : 0, credit: amt < 0 ? -amt : 0,
      balance: running,
    };
  });

  const totalDebit = r2(txns.reduce((s, t) => s + t.debit, 0));
  const totalCredit = r2(txns.reduce((s, t) => s + t.credit, 0));

  return {
    ledger, opening: r2(num(ledger.opening) + num(prior[0]?.total)),
    txns, closing: running, totalDebit, totalCredit,
  };
}

/** Cash / bank book summary per ledger. */
export async function cashBankBook(companyId: number, period: Period) {
  const balances = await ledgerBalances(companyId, period.from, period.to);
  const bankLedgers = await db
    .select({ id: ledgers.id, name: ledgers.name, isBankCash: ledgers.isBankCash })
    .from(ledgers)
    .where(and(eq(ledgers.companyId, companyId), eq(ledgers.isBankCash, true)));
  const bankIds = new Set(bankLedgers.map((b) => b.id));
  return balances
    .filter((b) => bankIds.has(b.ledgerId))
    .map((b) => ({ ...b, isBank: (bankLedgers.find((x) => x.id === b.ledgerId)?.name.toLowerCase().includes("bank")) ?? false }));
}

/** Sales / Purchase register. */
export async function register(companyId: number, period: Period, voucherTypeName: string, inverseNames: string[] = []) {
  const rows = await db
    .select({
      voucherId: vouchers.id, date: vouchers.date, number: vouchers.number,
      partyName: ledgers.name, narration: vouchers.narration,
      amount: sql<string>`coalesce((select sum(amount) from voucher_entries e2 where e2.voucher_id = ${vouchers.id} and e2.amount > 0), 0)`,
    })
    .from(vouchers)
    .innerJoin(voucherTypes, eq(voucherTypes.id, vouchers.voucherTypeId))
    .leftJoin(ledgers, eq(ledgers.id, vouchers.partyLedgerId))
    .where(and(
      eq(vouchers.companyId, companyId), eq(vouchers.isCancelled, false),
      eq(voucherTypes.name, voucherTypeName),
      gte(vouchers.date, period.from), lte(vouchers.date, period.to),
    ))
    .orderBy(asc(vouchers.date), asc(vouchers.id));

  const withGst = await Promise.all(
    rows.map(async (r) => {
      const gst = await db
        .select({ dutyHead: ledgers.dutyHead, amount: voucherEntries.amount })
        .from(voucherEntries)
        .innerJoin(ledgers, eq(ledgers.id, voucherEntries.ledgerId))
        .where(and(eq(voucherEntries.voucherId, r.voucherId), sql`${ledgers.dutyHead} is not null`));
      const gstTotal = r2(gst.reduce((s, g) => s + (num(g.amount) < 0 ? -num(g.amount) : num(g.amount) > 0 ? num(g.amount) : 0), 0));
      const gross = num(r.amount);
      return { ...r, amount: r2(gross), gst: r2(gstTotal), net: r2(gross) };
    })
  );
  const total = r2(withGst.reduce((s, r) => s + r.amount, 0));
  return { rows: withGst, total };
}

/** Bill-wise outstanding for Sundry Debtors (receivable) or Sundry Creditors (payable). */
export async function billWiseOutstanding(companyId: number, partyGroup: "Sundry Debtors" | "Sundry Creditors", asOf: string) {
  const rows = await db
    .select({
      ledgerId: ledgers.id, ledgerName: ledgers.name,
      billName: billAllocations.billName, billType: billAllocations.billType,
      amount: billAllocations.amount, dueDate: billAllocations.dueDate,
      date: vouchers.date,
    })
    .from(billAllocations)
    .innerJoin(voucherEntries, eq(voucherEntries.id, billAllocations.entryId))
    .innerJoin(vouchers, eq(vouchers.id, voucherEntries.voucherId))
    .innerJoin(ledgers, eq(ledgers.id, voucherEntries.ledgerId))
    .where(and(
      eq(vouchers.companyId, companyId), eq(vouchers.isCancelled, false),
      lte(vouchers.date, asOf),
    ));

  // Debtors outstanding = sum of signed allocations; creditors likewise (mirrored signs)
  const ledgerFilter = new Map(
    (await db
      .select({ id: ledgers.id, name: ledgers.name })
      .from(ledgers)
      .innerJoin(groups, eq(groups.id, ledgers.groupId))
      .where(and(eq(ledgers.companyId, companyId), eq(groups.name, partyGroup))))
      .map((l) => [l.id, l.name])
  );

  interface Bill { ledgerId: number; ledgerName: string; billName: string; billType: string; amount: number; dueDate: string | null; date: string; }
  const billMap = new Map<string, Bill>();

  for (const row of rows) {
    if (!ledgerFilter.has(row.ledgerId)) continue;
    const amt = num(row.amount);
    const key = `${row.ledgerId}::${row.billName}`;
    const cur = billMap.get(key);
    const dueDate = row.billType === "new_ref" ? row.dueDate : cur?.dueDate ?? row.dueDate;
    if (row.billType === "on_account") continue;
    if (cur) {
      cur.amount = r2(cur.amount + amt);
      if (row.billType === "new_ref") { cur.dueDate = row.dueDate ?? cur.dueDate; cur.date = row.date; }
    } else {
      billMap.set(key, { ledgerId: row.ledgerId, ledgerName: row.ledgerName, billName: row.billName, billType: row.billType, amount: amt, dueDate, date: row.date });
    }
  }

  const onAccount = await db
    .select({
      ledgerId: voucherEntries.ledgerId,
      amount: sql<string>`sum(${billAllocations.amount})`,
      firstDate: sql<string>`min(${vouchers.date})`,
    })
    .from(billAllocations)
    .innerJoin(voucherEntries, eq(voucherEntries.id, billAllocations.entryId))
    .innerJoin(vouchers, eq(vouchers.id, voucherEntries.voucherId))
    .where(and(
      eq(vouchers.companyId, companyId), eq(vouchers.isCancelled, false),
      eq(billAllocations.billType, "on_account"), lte(vouchers.date, asOf),
    ))
    .groupBy(voucherEntries.ledgerId);

  const bills = [...billMap.values()].filter((b) => Math.abs(b.amount) > 0.004);
  const byLedger = new Map<string, { ledgerId: number; ledgerName: string; total: number; bills: Bill[] }>();
  for (const b of bills) {
    if (!byLedger.has(b.ledgerName)) byLedger.set(b.ledgerName, { ledgerId: b.ledgerId, ledgerName: b.ledgerName, total: 0, bills: [] });
    const grp = byLedger.get(b.ledgerName)!;
    grp.bills.push(b);
    grp.total = r2(grp.total + b.amount);
  }
  const result = [...byLedger.values()].map((g) => ({
    ...g,
    total: r2(g.total),
    bills: g.bills.sort((a, b) => cmpDate(a.date, b.date)),
  })).sort((a, b) => a.ledgerName.localeCompare(b.ledgerName));

  // R-07 (F-07-1): a party ledger's opening balance is real outstanding money —
  // a migrated book's receivable/payable carried in from before books-begin.
  // Tally surfaces it in Outstanding reports as an "Opening Balance" bill.
  // Merge it here (A-05 on-account precedent) with the allocation sign
  // convention (Dr + / Cr −): Debtors openings are Dr (+), Creditors Cr (−).
  const [company] = await db.select({ booksBeginFrom: companies.booksBeginFrom })
    .from(companies).where(eq(companies.id, companyId));
  const openRows = await db
    .select({ id: ledgers.id, name: ledgers.name, opening: ledgers.openingBalance })
    .from(ledgers)
    .innerJoin(groups, eq(groups.id, ledgers.groupId))
    .where(and(eq(ledgers.companyId, companyId), eq(groups.name, partyGroup)));
  for (const o of openRows) {
    const amt = r2(num(o.opening));
    if (Math.abs(amt) <= 0.004) continue;
    let grp = result.find((g) => g.ledgerId === o.id);
    if (!grp) {
      grp = { ledgerId: o.id, ledgerName: o.name, total: 0, bills: [] };
      result.push(grp);
      result.sort((a, b) => a.ledgerName.localeCompare(b.ledgerName));
    }
    const merged = grp.bills.find((b) => b.billType === "opening");
    if (merged) merged.amount = r2(merged.amount + amt);
    else grp.bills.push({ ledgerId: o.id, ledgerName: o.name, billName: "Opening Balance", billType: "opening", amount: amt, dueDate: null, date: String(company?.booksBeginFrom ?? "") });
    grp.bills.sort((a, b) => cmpDate(a.date, b.date));
    grp.total = r2(grp.total + amt);
  }

  // A-05 fix: on-account allocations were computed but never merged, so an
  // advance against a party was invisible in outstanding reports. Merge each
  // party-ledger's on-account net into a synthetic "On Account" bill (raw
  // signed amount, same convention as the other bills) and the total.
  for (const oa of onAccount) {
    if (!ledgerFilter.has(oa.ledgerId)) continue; // only party ledgers of this group
    const amt = r2(num(oa.amount));
    if (Math.abs(amt) <= 0.004) continue;
    const ledgerName = ledgerFilter.get(oa.ledgerId)!;
    let grp = result.find((g) => g.ledgerId === oa.ledgerId);
    if (!grp) {
      grp = { ledgerId: oa.ledgerId, ledgerName, total: 0, bills: [] };
      result.push(grp);
      result.sort((a, b) => a.ledgerName.localeCompare(b.ledgerName));
    }
    const merged = grp.bills.find((b) => b.billType === "on_account");
    if (merged) merged.amount = r2(merged.amount + amt);
    else grp.bills.push({ ledgerId: oa.ledgerId, ledgerName, billName: "On Account", billType: "on_account", amount: amt, dueDate: null, date: String(oa.firstDate ?? "") });
    grp.total = r2(grp.total + amt);
  }

  const total = r2(result.reduce((s, g) => s + g.total, 0));
  return { parties: result, total, asOf };
}
