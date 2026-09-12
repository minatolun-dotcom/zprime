import { db } from "../db/index.js";
import { companies, ledgers, vouchers, voucherEntries, inventoryEntries, stockItems, voucherTypes, units } from "../db/schema.js";
import { and, eq, gte, lte } from "drizzle-orm";
import { num, r2 } from "../lib/util.js";

export interface VoucherGst {
  voucherId: number; date: string; number: string; typeName: string;
  partyName: string | null; partyGstin: string | null; placeOfSupply: string | null;
  taxable: number; igst: number; cgst: number; sgst: number; cess: number; total: number;
  /** Resolved supply classification (place of supply vs company state). */
  supplyType: "interstate" | "intrastate";
  /** True when duty heads contradict the resolved supply type (A-07 guard). */
  supplyMismatch: boolean;
  rateBuckets: { rate: number; taxable: number; igst: number; cgst: number; sgst: number; cess: number }[];
}

function stateCodeFromGstin(gstin: string | null | undefined): string | null {
  if (!gstin || gstin.length < 2) return null;
  return gstin.slice(0, 2);
}

function stateCodeFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  const map: Record<string, string> = {
    "Jammu & Kashmir": "01", "Himachal Pradesh": "02", Punjab: "03", Chandigarh: "04",
    Uttarakhand: "05", Haryana: "06", Delhi: "07", Rajasthan: "08", "Uttar Pradesh": "09",
    Bihar: "10", Sikkim: "11", "Arunachal Pradesh": "12", Nagaland: "13", Manipur: "14",
    Mizoram: "15", Tripura: "16", Meghalaya: "17", Assam: "18", "West Bengal": "19",
    Jharkhand: "20", Odisha: "21", Chhattisgarh: "22", "Madhya Pradesh": "23", Gujarat: "24",
    Maharashtra: "27", Karnataka: "29", Goa: "30", Lakshadweep: "31", Kerala: "32",
    "Tamil Nadu": "33", Puducherry: "34", "Andaman & Nicobar Islands": "35", Telangana: "36",
    "Andhra Pradesh": "37", Ladakh: "38",
  };
  return map[name] ?? null;
}

/** Collect GST breakup per voucher for outbound (sales, credit notes) or inbound (purchases, debit notes). */
export async function voucherGst(companyId: number, from: string, to: string, kind: "outward" | "inward"): Promise<VoucherGst[]> {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  const companyState = company?.stateCode ?? (company?.gstin ? company.gstin.slice(0, 2) : null);

  const typeNames = kind === "outward" ? ["Sales", "Credit Note"] : ["Purchase", "Debit Note"];
  const rows = await db
    .select({
      voucherId: vouchers.id, date: vouchers.date, number: vouchers.number,
      typeName: voucherTypes.name, partyName: ledgers.name, partyGstin: ledgers.gstin,
      partyState: ledgers.partyState, placeOfSupply: vouchers.placeOfSupply,
    })
    .from(vouchers)
    .innerJoin(voucherTypes, eq(voucherTypes.id, vouchers.voucherTypeId))
    .leftJoin(ledgers, eq(ledgers.id, vouchers.partyLedgerId))
    .where(and(
      eq(vouchers.companyId, companyId), eq(vouchers.isCancelled, false),
      gte(vouchers.date, from), lte(vouchers.date, to),
    ));

  const entriesByVoucher = await db
    .select({
      voucherId: voucherEntries.voucherId, ledgerId: voucherEntries.ledgerId,
      amount: voucherEntries.amount, gstRate: voucherEntries.gstRate, hsnSac: voucherEntries.hsnSac,
      dutyHead: ledgers.dutyHead, taxability: ledgers.taxability,
    })
    .from(voucherEntries)
    .innerJoin(ledgers, eq(ledgers.id, voucherEntries.ledgerId))
    .innerJoin(vouchers, eq(vouchers.id, voucherEntries.voucherId))
    .where(and(eq(vouchers.companyId, companyId), eq(vouchers.isCancelled, false)));

  const byVoucher = new Map<number, typeof entriesByVoucher>();
  for (const e of entriesByVoucher) {
    if (!byVoucher.has(e.voucherId)) byVoucher.set(e.voucherId, []);
    byVoucher.get(e.voucherId)!.push(e);
  }

  const out: VoucherGst[] = [];
  for (const v of rows) {
    if (!typeNames.includes(v.typeName)) continue;
    const entries = byVoucher.get(v.voucherId) ?? [];
    const sign = kind === "outward" ? -1 : 1; // outward duty is credit (negative), inward duty is debit (positive)

    const taxableRows = entries.filter((e) => !e.dutyHead && e.taxability === "taxable");
    const dutyRows = entries.filter((e) => e.dutyHead && e.dutyHead !== "TDS");

    const taxable = r2(taxableRows.reduce((s, e) => s + Math.abs(num(e.amount)), 0));
    const heads = new Map<string, number>();
    for (const d of dutyRows) {
      const amt = Math.abs(num(d.amount));
      heads.set(d.dutyHead!, r2((heads.get(d.dutyHead!) ?? 0) + amt));
    }
    const igst = heads.get("IGST") ?? 0;
    const cgst = heads.get("CGST") ?? 0;
    const sgst = r2((heads.get("SGST") ?? 0) + (heads.get("UTGST") ?? 0));
    const cess = heads.get("CESS") ?? 0;
    const total = r2(taxable + igst + cgst + sgst + cess);

    const pos = v.placeOfSupply || v.partyState;
    const posCode = stateCodeFromName(pos) ?? stateCodeFromGstin(v.partyGstin);
    const interState = posCode != null && companyState != null && posCode !== companyState;
    // A-07 reporting-integrity rule (canonical): the DUTY HEADS POSTED ON THE
    // VOUCHER are the accounting truth and are always reported as-is.
    // "GST present in the transaction == GST represented in GST reports".
    // Place-of-supply classification is advisory: when it contradicts the duty
    // heads (or cannot be resolved), the duty heads still win and the voucher
    // is flagged `supplyMismatch` so the contradiction is visible, never silent.
    const intraDuty = cgst + sgst;
    const interDuty = igst;
    const supplyMismatch =
      (interState && intraDuty > 0.004) ||      // CGST/SGST posted on inter-state supply
      (!interState && interDuty > 0.004) ||     // IGST posted on intra-state/unknown supply
      (posCode == null && interDuty + intraDuty > 0.004); // supply type unresolvable

    // Rate buckets: derive rate from duty amount / taxable, or entry snapshot
    const buckets = new Map<number, { rate: number; taxable: number; igst: number; cgst: number; sgst: number; cess: number }>();
    for (const e of taxableRows) {
      const rate = e.gstRate != null ? num(e.gstRate) : deriveRate(Math.abs(num(e.amount)), igst, cgst, sgst, cess, taxable);
      const b = buckets.get(rate) ?? { rate, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
      b.taxable = r2(b.taxable + Math.abs(num(e.amount)));
      buckets.set(rate, b);
    }
    const dutyTotal = igst + cgst + sgst + cess;
    for (const b of buckets.values()) {
      const share = taxable > 0 ? b.taxable / taxable : 0;
      b.igst = r2(igst * share); b.cgst = r2(cgst * share); b.sgst = r2(sgst * share); b.cess = r2(cess * share);
    }

    out.push({
      voucherId: v.voucherId, date: v.date, number: v.number, typeName: v.typeName,
      partyName: v.partyName, partyGstin: v.partyGstin, placeOfSupply: pos,
      taxable, igst, cgst, sgst, cess, total,
      supplyType: interState ? "interstate" : "intrastate",
      supplyMismatch,
      rateBuckets: [...buckets.values()].sort((a, b) => a.rate - b.rate),
    });
  }
  return out;
}

function deriveRate(taxable: number, igst: number, cgst: number, sgst: number, cess: number, totalTaxable: number): number {
  if (totalTaxable <= 0) return 0;
  const duty = igst + cgst + sgst + cess;
  const rate = taxable > 0 ? (duty / totalTaxable) * 100 : 0;
  const known = [0, 0.25, 3, 5, 12, 18, 28];
  return known.reduce((best, k) => (Math.abs(k - rate) < Math.abs(best - rate) ? k : best), rate);
}

export async function gstr1(companyId: number, from: string, to: string) {
  const outward = await voucherGst(companyId, from, to, "outward");
  const b2b = outward.filter((v) => v.partyGstin);
  const b2c = outward.filter((v) => !v.partyGstin);

  // R-01: HSN summary (Table 12) represents OUTWARD SUPPLIES ONLY. The
  // population is defined by voucher-type semantics — the same rule used by
  // voucherGst(..., "outward") — never by inventory quantity direction:
  // stored qty is signed (+ = stock in, - = stock out), so a direction test
  // silently includes purchases/receipt notes and excludes sales.
  // Credit/Debit Notes are separate reporting documents and stay out of
  // Table 12 (CDNR remains a known gap, see the cdnr field below).
  const hsnRows = await db
    .select({
      hsn: inventoryEntries.hsnSac, qty: inventoryEntries.qty, rate: inventoryEntries.rate,
      amount: inventoryEntries.amount, gstRate: inventoryEntries.gstRate,
      itemHsn: stockItems.hsnSac, itemGstRate: stockItems.gstRate, unit: units.symbol,
      item: stockItems.name,
    })
    .from(inventoryEntries)
    .innerJoin(vouchers, eq(vouchers.id, inventoryEntries.voucherId))
    .innerJoin(voucherTypes, eq(voucherTypes.id, vouchers.voucherTypeId))
    .innerJoin(stockItems, eq(stockItems.id, inventoryEntries.itemId))
    .innerJoin(units, eq(units.id, stockItems.unitId))
    .where(and(
      eq(vouchers.companyId, companyId), eq(vouchers.isCancelled, false),
      eq(voucherTypes.name, "Sales"),
      gte(vouchers.date, from), lte(vouchers.date, to),
    ));

  const hsnMap = new Map<string, { hsn: string; qty: number; taxable: number; rate: number }>();
  for (const r of hsnRows) {
    // Sales rows are stored with negative qty (stock out). Report outward
    // quantity as positive. HSN/rate resolve from the voucher snapshot when
    // present (importer history) and fall back to the stock-item master
    // otherwise (UI-created vouchers do not populate snapshots).
    const hsnCode = r.hsn ?? r.itemHsn ?? "-";
    const gstRate = r.gstRate != null ? num(r.gstRate) : num(r.itemGstRate ?? 0);
    const key = `${hsnCode}::${gstRate}`;
    const cur = hsnMap.get(key) ?? { hsn: hsnCode, qty: 0, taxable: 0, rate: gstRate };
    cur.qty = r2(cur.qty + Math.abs(num(r.qty)));
    cur.taxable = r2(cur.taxable + Math.abs(num(r.amount)));
    hsnMap.set(key, cur);
  }

  const sum = (vs: VoucherGst[], f: (v: VoucherGst) => number) => r2(vs.reduce((s, v) => s + f(v), 0));
  return {
    b2b,
    b2c,
    cdnr: [], // credit notes appear via typeName; kept in b2b/b2c with negative impact future work
    hsn: [...hsnMap.values()].sort((a, b) => a.hsn.localeCompare(b.hsn)),
    totals: {
      b2bTaxable: sum(b2b, (v) => v.taxable), b2bIgst: sum(b2b, (v) => v.igst),
      b2bCgst: sum(b2b, (v) => v.cgst), b2bSgst: sum(b2b, (v) => v.sgst),
      b2cTaxable: sum(b2c, (v) => v.taxable), b2cIgst: sum(b2c, (v) => v.igst),
      b2cCgst: sum(b2c, (v) => v.cgst), b2cSgst: sum(b2c, (v) => v.sgst),
    },
  };
}

export async function gstr3b(companyId: number, from: string, to: string) {
  const outward = await voucherGst(companyId, from, to, "outward");
  const inward = await voucherGst(companyId, from, to, "inward");

  const sum = (vs: VoucherGst[], f: (v: VoucherGst) => number) => r2(vs.reduce((s, v) => s + f(v), 0));

  const outwardTaxable = sum(outward, (v) => v.taxable);
  const outwardIgst = sum(outward, (v) => v.igst);
  const outwardCgst = sum(outward, (v) => v.cgst);
  const outwardSgst = sum(outward, (v) => v.sgst);
  const outwardCess = sum(outward, (v) => v.cess);

  const itcIgst = sum(inward, (v) => v.igst);
  const itcCgst = sum(inward, (v) => v.cgst);
  const itcSgst = sum(inward, (v) => v.sgst);
  const itcCess = sum(inward, (v) => v.cess);

  const netIgst = r2(outwardIgst - itcIgst);
  const netCgst = r2(outwardCgst - itcCgst);
  const netSgst = r2(outwardSgst - itcSgst);
  const netCess = r2(outwardCess - itcCess);

  return {
    outward: { taxable: outwardTaxable, igst: outwardIgst, cgst: outwardCgst, sgst: outwardSgst, cess: outwardCess },
    itc: { igst: itcIgst, cgst: itcCgst, sgst: itcSgst, cess: itcCess },
    net: { igst: netIgst, cgst: netCgst, sgst: netSgst, cess: netCess, total: r2(netIgst + netCgst + netSgst + netCess) },
    outwardDetail: outward, inwardDetail: inward,
  };
}
