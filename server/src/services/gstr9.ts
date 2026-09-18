// R-26: GSTR-9 annual return — a pure report-family projection.
//
// Every number here is a sum of ALREADY-TESTED projections: `gstr1()` and
// `gstr3b()` are called once over the whole financial year (the FY is a single
// query window — no monthly summation, no rounding drift), and Table 8's ITC
// reconciliation comes from `ledgerBalances()` duty-ledger positions. Nothing
// recalculates tax. Accounting math untouched.
//
// Honesty rules (same posture as every zprime report):
// - Tables with no transaction surface (5: ITC reversals; amendments 10/11;
//   refunds) render as explicit zeros/stated limitations — never invented.
// - `consistency` carries cross-checks: Table 9 vs GSTR-3B outward, and
//   Table 8's computed closing vs the ACTUAL duty-ledger closing. Any gap is
//   surfaced, never silently absorbed.
// - R-15 semantics become visible here: GSTR returns are period-only, so an
//   unpaired opening GST position shows up in Table 8 as a difference.

import { db } from "../db/index.js";
import { ledgers } from "../db/schema.js";
import { and, eq, inArray } from "drizzle-orm";
import { r2 } from "../lib/util.js";
import { ledgerBalances } from "./accounting.js";
import { gstr1, gstr3b } from "./gst.js";

export interface Gstr9Result {
  fy: { from: string; to: string };
  /** Table 4(A): eligible ITC — A(5) supplier-charged, A(3) reverse charge */
  table4: {
    currentYearRegular: { igst: number; cgst: number; sgst: number; cess: number };
    currentYearRcm: { igst: number; cgst: number; sgst: number; cess: number };
  };
  /** Table 5: ITC reversals — no transaction surface in zprime (honest zeros) */
  table5: { total: number; note: string };
  /** Tables 6/7: inward & outward supply detail (3B aggregates) */
  table6_7: {
    inwardRcm: { taxable: number; igst: number; cgst: number; sgst: number; cess: number };
    outward: { taxable: number; igst: number; cgst: number; sgst: number; cess: number };
  };
  /** Table 8: ITC reconciliation — opening position → FY claims → closing */
  table8: {
    opening: { igst: number; cgst: number; sgst: number; cess: number };
    claimed: { igst: number; cgst: number; sgst: number; cess: number };
    computedClosing: { igst: number; cgst: number; sgst: number; cess: number };
    ledgerClosing: { igst: number; cgst: number; sgst: number; cess: number };
    difference: { igst: number; cgst: number; sgst: number; cess: number };
    note: string;
  };
  /** Table 9: supplies declared in the return */
  table9: {
    b2b: { taxable: number; igst: number; cgst: number; sgst: number };
    b2c: { taxable: number; igst: number; cgst: number; sgst: number };
    cdnr: { taxable: number; igst: number; cgst: number; sgst: number };
    cdnur: { taxable: number; igst: number; cgst: number; sgst: number };
    net: { taxable: number; igst: number; cgst: number; sgst: number };
  };
  /** Table 12: annual HSN summary of outward supplies (R-01 population rule) */
  table12: { hsn: string; qty: number; taxable: number; rate: number }[];
  /** Cross-return and cross-ledger consistency checks (non-zero = amber) */
  consistency: {
    table9Vs3bOutward: { taxable: number; igst: number; cgst: number; sgst: number };
    table8ClosingVsLedger: { igst: number; cgst: number; sgst: number; cess: number };
  };
}

const zero = () => ({ igst: 0, cgst: 0, sgst: 0, cess: 0 });
const zero4 = () => ({ taxable: 0, igst: 0, cgst: 0, sgst: 0 });
const DUTY_HEADS = ["IGST", "CGST", "SGST", "CESS"];

export async function gstr9(companyId: number, from: string, to: string): Promise<Gstr9Result> {
  // One call per return over the whole FY — voucherGst queries [from, to]
  // directly, so figures are exact, not accumulated monthly buckets.
  const g1 = await gstr1(companyId, from, to);
  const b3 = await gstr3b(companyId, from, to);

  // ---- Table 4: eligible ITC (A(5) regular supplier-charged, A(3) RCM) ----
  const table4 = {
    currentYearRegular: {
      igst: r2(b3.itc.igst), cgst: r2(b3.itc.cgst),
      sgst: r2(b3.itc.sgst), cess: r2(b3.itc.cess),
    },
    currentYearRcm: {
      igst: r2(b3.rcmItc.igst), cgst: r2(b3.rcmItc.cgst),
      sgst: r2(b3.rcmItc.sgst), cess: r2(b3.rcmItc.cess),
    },
  };

  // ---- Table 5: ITC reversals — no transaction surface; honest zeros ----
  const table5 = {
    total: 0,
    note: "zprime has no ITC-reversal transaction type; this table is zero by construction (rules 42/43 reclaims and s.17(5) reversals are not modeled).",
  };

  // ---- Tables 6/7: the 3B aggregates the annual return restates ----
  const table6_7 = {
    inwardRcm: { taxable: r2(b3.inwardRcm.taxable), igst: r2(b3.inwardRcm.igst), cgst: r2(b3.inwardRcm.cgst), sgst: r2(b3.inwardRcm.sgst), cess: r2(b3.inwardRcm.cess) },
    outward: { taxable: r2(b3.outward.taxable), igst: r2(b3.outward.igst), cgst: r2(b3.outward.cgst), sgst: r2(b3.outward.sgst), cess: r2(b3.outward.cess) },
  };

  // ---- Table 8: ITC reconciliation against the ACTUAL duty ledgers ----
  const dutyLedgers = await db
    .select({ id: ledgers.id, dutyHead: ledgers.dutyHead })
    .from(ledgers)
    .where(and(eq(ledgers.companyId, companyId), inArray(ledgers.dutyHead, DUTY_HEADS)));
  const dutyIds = dutyLedgers.map((l) => l.id);
  const opening = zero();
  const ledgerClosing = zero();
  if (dutyIds.length > 0) {
    const balances = await ledgerBalances(companyId, from, to);
    for (const b of balances) {
      const dl = dutyLedgers.find((d) => d.id === b.ledgerId);
      if (!dl) continue;
      // Duty ledgers carry CREDITS as negative (posted duty). The ITC position
      // is the credit magnitude: opening credit = -opening, closing credit = -closing.
      const head = dl.dutyHead!.toLowerCase() === "sgst" ? "sgst" : dl.dutyHead!.toLowerCase();
      if (head === "cess" || head === "igst" || head === "cgst" || head === "sgst") {
        opening[head] = r2(opening[head] + (b.opening < 0 ? -b.opening : 0));
        ledgerClosing[head] = r2(ledgerClosing[head] + (b.closing < 0 ? -b.closing : 0));
      }
    }
  }
  // Computed closing = opening + FY claims (Table 4 regular; RCM claims its own
  // liability so it nets nil on the same ledgers and is excluded from the walk).
  const claimed = table4.currentYearRegular;
  const computedClosing = zero();
  for (const h of ["igst", "cgst", "sgst", "cess"] as const) {
    computedClosing[h] = r2(opening[h] + claimed[h]);
  }
  const difference = zero();
  for (const h of ["igst", "cgst", "sgst", "cess"] as const) {
    difference[h] = r2(ledgerClosing[h] - computedClosing[h]);
  }
  const table8 = {
    opening,
    claimed,
    computedClosing,
    ledgerClosing,
    difference,
    note: "Opening = credit balance on duty ledgers at FY start (includes pre-FY movement); claimed = Table 4(A)(5); difference = ledger closing − computed closing (non-zero means unposted or unclaimed credit — visible, never silent).",
  };

  // ---- Table 9: supplies declared (GSTR-1 populations, already netted) ----
  const pick = (rows: any) => ({
    taxable: r2(rows.reduce((s: any, v: any) => s + v.taxable, 0)),
    igst: r2(rows.reduce((s: any, v: any) => s + v.igst, 0)),
    cgst: r2(rows.reduce((s: any, v: any) => s + v.cgst, 0)),
    sgst: r2(rows.reduce((s: any, v: any) => s + v.sgst, 0)),
  });
  const b2b = pick(g1.b2b);
  const b2c = pick(g1.b2c);
  const cdnr = pick(g1.cdnr);
  const cdnur = pick(g1.cdnur);
  const net = zero4();
  for (const h of ["taxable", "igst", "cgst", "sgst"] as const) {
    net[h] = r2(b2b[h] + b2c[h] - cdnr[h] - cdnur[h]);
  }
  const table9 = { b2b, b2c, cdnr, cdnur, net };

  // ---- Table 12: annual HSN of outward supplies (R-01 population rule) ----
  const table12 = g1.hsn.map((h) => ({ hsn: h.hsn, qty: r2(h.qty), taxable: r2(h.taxable), rate: r2(h.rate) }));

  // ---- Consistency: cross-return and cross-ledger checks ----
  // Table 9 net outward must agree with 3B's outward for the same FY (both
  // derive from voucherGst with R-05 note semantics — any drift is a defect).
  const table9Vs3bOutward = zero4();
  table9Vs3bOutward.taxable = r2(table9.net.taxable - b3.outward.taxable);
  table9Vs3bOutward.igst = r2(table9.net.igst - b3.outward.igst);
  table9Vs3bOutward.cgst = r2(table9.net.cgst - b3.outward.cgst);
  table9Vs3bOutward.sgst = r2(table9.net.sgst - b3.outward.sgst);
  // 3B outward includes credit notes as negatives already; Table 9 nets them
  // identically, so the difference must be ~0 for well-formed books.
  const table8ClosingVsLedger = { ...difference };

  return {
    fy: { from, to },
    table4,
    table5,
    table6_7,
    table8,
    table9,
    table12,
    consistency: { table9Vs3bOutward, table8ClosingVsLedger },
  };
}
