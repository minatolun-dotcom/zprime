// R-24: e-invoice payload generation (NIC schema v1.01, B2B mandatory set).
//
// This service is a RE-PROJECTION of data zprime already computes and stores:
// the per-voucher duty numbers come from the same voucherGst() pipeline that
// feeds GSTR-1/3B (verified by R-01/R-05/R-23 regression blocks), and the
// master fields come straight from the companies/ledgers tables. Nothing here
// recalculates tax — it classifies and formats. Accounting math untouched.
//
// Scope discipline (approved Option A): GENERATE + DOWNLOAD only. zprime does
// not talk to the IRP/GSP network, holds no credentials, and accepts no
// callbacks. The operator uploads the JSON to their chosen IRP channel.
//
// Validation posture: STRICT and ALL-AT-ONCE. A payload is produced only when
// every mandatory field is present; otherwise the response lists every gap
// with the exact ledger/company field to fix. A half-formed payload that the
// IRP would reject is never handed to the operator.

import { db } from "../db/index.js";
import { companies, ledgers, vouchers, voucherTypes, voucherEntries, inventoryEntries, stockItems, units } from "../db/schema.js";
import { and, eq } from "drizzle-orm";
import { num, r2 } from "../lib/util.js";
import { voucherGst } from "./gst.js";

// NIC UQC (universal unit codes). zprime stores a free-text unit symbol;
// these are the symbols accepted as-is, the rest must be renamed by the
// operator (validation fails loudly rather than emitting an invalid code).
const UQC: Record<string, string> = {
  NOS: "NOS", PCS: "PCS", KGS: "KGS", GMS: "GMS", MTR: "MTR", CMTR: "CMTR",
  SQF: "SQF", SQM: "SQM", LTR: "LTR", MLT: "MLT", BAG: "BAG", BOX: "BOX",
  BDL: "BDL", BTL: "BTL", CTN: "CTN", DOZ: "DOZ", DRM: "DRM",
  MTN: "MTN", PAC: "PAC", PRS: "PRS",
  QTL: "QTL", ROL: "ROL", SET: "SET", TBS: "TBS", TGM: "TGM", THD: "THD",
  TON: "TON", UGS: "UGS", YDS: "YDS",
};

const STATE_CODES: Record<string, string> = {
  "Jammu & Kashmir": "01", "Himachal Pradesh": "02", Punjab: "03", Chandigarh: "04",
  Uttarakhand: "05", Haryana: "06", Delhi: "07", Rajasthan: "08", "Uttar Pradesh": "09",
  Bihar: "10", Sikkim: "11", "Arunachal Pradesh": "12", Nagaland: "13", Manipur: "14",
  Mizoram: "15", Tripura: "16", Meghalaya: "17", Assam: "18", "West Bengal": "19",
  Jharkhand: "20", Odisha: "21", Chhattisgarh: "22", "Madhya Pradesh": "23", Gujarat: "24",
  Maharashtra: "27", Karnataka: "29", Goa: "30", Lakshadweep: "31", Kerala: "32",
  "Tamil Nadu": "33", Puducherry: "34", "Andaman & Nicobar Islands": "35", Telangana: "36",
  "Andhra Pradesh": "37", Ladakh: "38",
};

export interface EinvoiceResult {
  /** true when the payload was generated; false when validation failed */
  ok: boolean;
  /** all-at-once list of every mandatory gap (empty when ok) */
  errors: string[];
  /** the NIC v1.01 JSON payload (present only when ok) */
  payload?: Record<string, unknown>;
}

/** Build the NIC v1.01 e-invoice JSON for one Sales/Credit Note voucher. */
export async function eInvoicePayload(companyId: number, voucherId: number): Promise<EinvoiceResult> {
  const errors: string[] = [];

  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!company) return { ok: false, errors: ["Company not found"] };

  const [row] = await db
    .select({ v: vouchers, typeName: voucherTypes.name, party: ledgers })
    .from(vouchers)
    .innerJoin(voucherTypes, eq(voucherTypes.id, vouchers.voucherTypeId))
    .leftJoin(ledgers, eq(ledgers.id, vouchers.partyLedgerId))
    .where(and(eq(vouchers.id, voucherId), eq(vouchers.companyId, companyId)));
  if (!row) return { ok: false, errors: ["Voucher not found"] };
  const v = row.v;

  // Scheme scope: e-invoicing applies to documents raised by the SUPPLIER.
  // Debit Notes belong to the recipient's side of a B2B exchange; NIC does
  // not accept DBN from the supplier for the approved scope.
  const typeMap: Record<string, string> = { "Sales": "INV", "Credit Note": "CRN" };
  const docType = typeMap[row.typeName];
  if (!docType) {
    return { ok: false, errors: [`E-invoice applies to Sales and Credit Note vouchers; this is a ${row.typeName}`] };
  }
  if (v.isCancelled) return { ok: false, errors: ["Cancelled vouchers cannot be e-invoiced"] };
  if (v.isRcm) return { ok: false, errors: ["Reverse-charge (RCM) vouchers are recipient-side supplies and cannot be e-invoiced by the supplier"] };

  const party = row.party;
  // B2B mandatory set: a registered buyer. Unregistered/consumer/composition
  // parties are B2C — out of the approved scope (B2CL large-value is later).
  if (!party) errors.push("Voucher has no party ledger — set a party before e-invoicing");
  else if (!party.gstin) errors.push(`Buyer GSTIN missing — set it on ledger "${party.name}"`);
  else if (party.gstRegistrationType !== "regular") {
    errors.push(`Buyer registration type is "${party.gstRegistrationType}" — e-invoice (B2B) requires a regular-registered buyer`);
  }
  if (party && !party.partyAddress) errors.push(`Buyer address missing — set Party Address on ledger "${party.name}"`);
  if (party && !party.partyPincode) errors.push(`Buyer PIN code missing — set Party PIN Code on ledger "${party.name}"`);
  if (party && !party.partyState) errors.push(`Buyer state missing — set Party State on ledger "${party.name}"`);

  // Seller (company) mandatory set.
  if (!company.gstin) errors.push("Seller GSTIN missing — set it in Company master");
  if (!company.address) errors.push("Seller address missing — set it in Company master");
  if (!company.pincode) errors.push("Seller PIN code missing — set it in Company master");
  const sellerState = company.stateCode ?? (company.gstin ? company.gstin.slice(0, 2) : null);
  if (!sellerState) errors.push("Seller state code missing — set State or GSTIN in Company master");

  if (errors.length > 0) return { ok: false, errors };

  // ---- Data verified present; build the payload ----
  const gst = (await voucherGst(companyId, v.date, v.date, "outward")).find((g) => g.voucherId === v.id);
  if (!gst) return { ok: false, errors: ["Voucher is not a GST-classified outward supply (Sales/Credit Note)"] };

  // Lines: goods from inventory_entries; service lines from voucher_entries
  // ONLY when the voucher carries no inventory (a pure service invoice — its
  // income-ledger line IS the supply). On a goods voucher the income line
  // duplicates the inventory amounts and must not be reported as a service.
  const goods = await db
    .select({
      qty: inventoryEntries.qty, rate: inventoryEntries.rate, amount: inventoryEntries.amount,
      hsnSac: inventoryEntries.hsnSac, gstRate: inventoryEntries.gstRate,
      itemHsn: stockItems.hsnSac, itemGstRate: stockItems.gstRate, unit: units.symbol,
      itemName: stockItems.name,
    })
    .from(inventoryEntries)
    .innerJoin(stockItems, eq(stockItems.id, inventoryEntries.itemId))
    .innerJoin(units, eq(units.id, stockItems.unitId))
    .where(eq(inventoryEntries.voucherId, v.id));

  let serviceLines: { amount: string; gstRate: string | null; hsnSac: string | null }[] = [];
  if (goods.length === 0) {
    serviceLines = await db
      .select({ amount: voucherEntries.amount, gstRate: voucherEntries.gstRate, hsnSac: voucherEntries.hsnSac })
      .from(voucherEntries)
      .innerJoin(ledgers, eq(ledgers.id, voucherEntries.ledgerId))
      .where(and(eq(voucherEntries.voucherId, v.id), eq(ledgers.taxability, "taxable")));
  }

  interface Line { hsn: string; qty: number; rate: number; taxable: number; ratePct: number; uqc: string; desc: string; }
  const lines: Line[] = [];
  for (const g of goods) {
    // Sales rows store stock-out as negative qty; e-invoice quantities are positive.
    const qty = Math.abs(num(g.qty));
    const hsn = g.hsnSac ?? g.itemHsn;
    if (!hsn) { errors.push(`Item "${g.itemName}" has no HSN/SAC — set it on the stock item or the voucher line`); continue; }
    const uqc = UQC[(g.unit ?? "").toUpperCase()];
    if (!uqc) { errors.push(`Unit "${g.unit}" is not a valid NIC UQC — rename the unit (e.g. NOS, PCS, KGS) on "${g.itemName}"`); continue; }
    const ratePct = g.gstRate != null ? num(g.gstRate) : num(g.itemGstRate ?? 0);
    lines.push({ hsn, qty, rate: num(g.rate), taxable: Math.abs(num(g.amount)), ratePct, uqc, desc: g.itemName });
  }
  for (const s of serviceLines) {
    if (!s.hsnSac) { errors.push(`A taxable service line has no HSN/SAC snapshot — re-enter the line with HSN/SAC`); continue; }
    lines.push({ hsn: s.hsnSac, qty: 1, rate: 0, taxable: Math.abs(num(s.amount)), ratePct: s.gstRate != null ? num(s.gstRate) : 0, uqc: "NOS", desc: "Services" });
  }
  if (lines.length === 0 && errors.length === 0) errors.push("No itemisable lines found on this voucher");
  if (errors.length > 0) return { ok: false, errors };

  // Cross-check the line sum against voucherGst's verified totals (defense in
  // depth: the payload must never disagree with the reports).
  const lineTaxable = r2(lines.reduce((s, l) => s + l.taxable, 0));
  if (Math.abs(lineTaxable - Math.abs(gst.taxable)) > 0.01) {
    return { ok: false, errors: [`Line taxable total ${lineTaxable} does not match the voucher's GST classification ${Math.abs(gst.taxable)} — the voucher needs correction before e-invoicing`] };
  }

  // Duty split per line: proportional share of the voucher-level classified
  // duty (same proportionality voucherGst itself uses for rate buckets).
  const dutyTotal = gst.igst + gst.cgst + gst.sgst + gst.cess;
  const share = (l: Line, duty: number) => (gst.taxable !== 0 ? r2(duty * (l.taxable / Math.abs(gst.taxable))) : 0);

  const itemList = lines.map((l, i) => {
    const lineIgst = share(l, gst.igst);
    const lineCgst = share(l, gst.cgst);
    const lineSgst = share(l, gst.sgst);
    return {
      SlNo: String(i + 1),
      PrdDesc: l.desc,
      HsnCd: l.hsn,
      Qty: l.qty,
      Unit: l.uqc,
      UnitPrice: l.rate,
      AssAmt: l.taxable,
      GstRt: l.ratePct,
      IgstAmt: lineIgst,
      CgstAmt: lineCgst,
      SgstAmt: lineSgst,
      TotItemAmt: r2(l.taxable + lineIgst + lineCgst + lineSgst),
    };
  });

  const posCode = gst.placeOfSupply ? STATE_CODES[gst.placeOfSupply] ?? (party?.gstin ? party.gstin.slice(0, 2) : null) : (party?.gstin ? party.gstin.slice(0, 2) : null);
  if (!posCode) return { ok: false, errors: [`Place of supply "${gst.placeOfSupply ?? "(none)"}" is not a recognised state — set Place of Supply or Party State on the voucher/ledger`] };

  const igstAmt = Math.abs(gst.igst);
  const cgstAmt = Math.abs(gst.cgst);
  const sgstAmt = Math.abs(gst.sgst);
  const total = r2(Math.abs(gst.taxable) + igstAmt + cgstAmt + sgstAmt + Math.abs(gst.cess));
  const declared = r2(Math.abs(gst.total));
  const roundOff = r2(total - declared);

  const payload = {
    Version: "1.01",
    TranDtls: { TaxScheme: "GST", SupTyp: "B2B" },
    DocDtls: { Typ: docType, No: v.number, Dt: v.date },
    SellerDtls: {
      Gstin: company.gstin, LglNm: company.mailingName ?? company.name,
      Addr1: company.address, Loc: company.city, Pin: Number(company.pincode), Stcd: sellerState,
    },
    BuyerDtls: {
      Gstin: party!.gstin, LglNm: party!.name,
      Addr1: party!.partyAddress, Pos: posCode, Stcd: posCode, Pin: Number(party!.partyPincode),
    },
    ItemList: itemList,
    ValDtls: {
      AssVal: Math.abs(gst.taxable), CgstVal: cgstAmt, SgstVal: sgstAmt, IgstVal: igstAmt,
      RndOffAmt: roundOff, TotInvVal: declared,
    },
  };

  return { ok: true, errors: [], payload };
}
