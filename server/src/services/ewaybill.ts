// R-25: e-way bill payload generation (EWB-01, Part-A + optional Part-B).
//
// Companion to R-24's e-invoice service and built on the SAME discipline:
// a RE-PROJECTION of data zprime already computes (voucherGst() duty numbers,
// the shared supplyLines() projection, company/ledger masters). Nothing here
// recalculates tax. Accounting math untouched.
//
// Scope discipline (approved Option A): GENERATE + DOWNLOAD, STATELESS.
// Part-B transport details (vehicle, transporter, transit doc) are optional
// REQUEST PARAMETERS — zprime persists no EWB number and no transport state
// (there is nothing to update: without a stored EWB number the portal is the
// system of record). The operator uploads the JSON to the e-way portal/GSP.
//
// Validation posture: STRICT and ALL-AT-ONCE, identical to R-24. Warnings
// (advisories like the sub-₹50,000 threshold) never block generation.

import { db } from "../db/index.js";
import { companies, ledgers, vouchers, voucherTypes } from "../db/schema.js";
import { and, eq } from "drizzle-orm";
import { r2 } from "../lib/util.js";
import { voucherGst } from "./gst.js";
import { EINV_DOC_TYPES, supplyLines, stateCode } from "./einvoice.js";

export interface EwaybillResult {
  ok: boolean;
  errors: string[];
  /** non-blocking advisories (threshold, HSN depth) — present when ok */
  warnings?: string[];
  /** the EWB-01 JSON payload (present only when ok) */
  payload?: Record<string, unknown>;
}

export interface EwaybillParams {
  vehicleNo?: string | undefined;
  transMode?: string | undefined; // road | rail | air | ship
  transDocNo?: string | undefined;
  transDocDate?: string | undefined;
  transporterName?: string | undefined;
}

const TRANS_MODES: Record<string, string> = { road: "1", rail: "2", air: "3", ship: "4" };

/** Build the EWB-01 JSON for one Sales/Credit Note voucher. */
export async function ewaybillPayload(companyId: number, voucherId: number, params: EwaybillParams = {}): Promise<EwaybillResult> {
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

  // EWB rides on the documents the SUPPLIER raises — same anchor set as R-24
  // (a Delivery Note is not a tax document; the e-way bill references the
  // tax invoice, so the tax invoice/credit note is what we generate from).
  const docType = EINV_DOC_TYPES[row.typeName];
  if (!docType) {
    return { ok: false, errors: [`E-way bill applies to Sales and Credit Note vouchers; this is a ${row.typeName}`] };
  }
  if (v.isCancelled) return { ok: false, errors: ["Cancelled vouchers cannot have an e-way bill"] };

  const party = row.party;
  if (!party) errors.push("Voucher has no party ledger — set a party before generating an e-way bill");
  else if (!party.gstin) errors.push(`Buyer GSTIN missing — set it on ledger "${party.name}"`);
  if (party && !party.partyState) errors.push(`Buyer state missing — set Party State on ledger "${party.name}"`);

  if (!company.gstin) errors.push("Seller GSTIN missing — set it in Company master");
  const sellerState = company.stateCode ?? (company.gstin ? company.gstin.slice(0, 2) : null);
  if (!sellerState) errors.push("Seller state code missing — set State or GSTIN in Company master");

  // Part-B sanity when supplied: mode needs a vehicle/doc context; a vehicle
  // number only applies to road.
  const mode = params.transMode ? TRANS_MODES[params.transMode.toLowerCase()] : undefined;
  if (params.transMode && !mode) errors.push(`transMode "${params.transMode}" is not valid — use road, rail, air or ship`);
  if (params.vehicleNo && params.transMode && params.transMode.toLowerCase() !== "road") {
    errors.push("vehicleNo applies only to road transport — drop it or set transMode=road");
  }

  if (errors.length > 0) return { ok: false, errors };

  // ---- Data verified present; build the payload ----
  const gst = (await voucherGst(companyId, v.date, v.date, "outward")).find((g) => g.voucherId === v.id);
  if (!gst) return { ok: false, errors: ["Voucher is not a GST-classified outward supply (Sales/Credit Note)"] };

  const lineErrors: string[] = [];
  const lines = await supplyLines(v.id, lineErrors);
  if (lines.length === 0) lineErrors.push("No itemisable lines found on this voucher");
  if (lineErrors.length > 0) return { ok: false, errors: lineErrors };

  // EWB wants meaningful commodity codes: fail loudly below 4 digits, advise
  // below 6 (6-digit HSN is the reporting standard for large taxpayers).
  const warnings: string[] = [];
  for (const l of lines) {
    if (l.hsn.replace(/\D/g, "").length < 4) {
      return { ok: false, errors: [`Item "${l.desc}" HSN "${l.hsn}" is too short for an e-way bill (min 4 digits) — fix the HSN/SAC`] };
    }
    if (l.hsn.replace(/\D/g, "").length < 6) warnings.push(`Item "${l.desc}" HSN "${l.hsn}" is under 6 digits — the portal may flag it`);
  }

  const posCode = stateCode(party!.partyState) ?? (party!.gstin ? party!.gstin.slice(0, 2) : null);
  if (!posCode) return { ok: false, errors: [`Buyer state "${party!.partyState}" is not a recognised state — set Party State (or a GSTIN) on the ledger`] };

  const taxable = Math.abs(gst.taxable);
  const igstAmt = Math.abs(gst.igst);
  const cgstAmt = Math.abs(gst.cgst);
  const sgstAmt = Math.abs(gst.sgst);
  const cessAmt = Math.abs(gst.cess);
  const totInvValue = r2(taxable + igstAmt + cgstAmt + sgstAmt + cessAmt);

  // Statutory consignment-value threshold: movement of goods below ₹50,000 is
  // generally e-way-exempt. zprime informs, never blocks (the portal enforces).
  if (totInvValue < 50000) warnings.push(`Consignment value ₹${totInvValue.toLocaleString("en-IN")} is below the ₹50,000 e-way threshold — an e-way bill may not be required`);

  // Line values: proportional duty share (same method as R-24 — the payload
  // must agree with the books because both derive from voucherGst()).
  const share = (l: { taxable: number }, duty: number) => (gst.taxable !== 0 ? r2(duty * (l.taxable / Math.abs(gst.taxable))) : 0);

  const itemList = lines.map((l, i) => ({
    SlNo: String(i + 1),
    PrdDesc: l.desc,
    HsnCd: l.hsn,
    Qty: l.qty,
    Unit: l.uqc,
    UnitPrice: l.rate,
    AssAmt: l.taxable,
    GstRt: l.ratePct,
    IgstAmt: share(l, gst.igst),
    CgstAmt: share(l, gst.cgst),
    SgstAmt: share(l, gst.sgst),
    CessAmt: share(l, gst.cess),
    TotItemAmt: r2(l.taxable + share(l, gst.igst) + share(l, gst.cgst) + share(l, gst.sgst) + share(l, gst.cess)),
  }));

  // from = dispatch (seller state in the single-godown model — godowns carry
  // no addresses in zprime; multi-godown dispatch belongs to deferred Option B).
  // actFrom/actTo = actual consigner/consignee (same parties in this scope).
  const payload: Record<string, unknown> = {
    userGstin: company.gstin,
    supplyType: "O",
    subType: "Supply",
    docType,
    docNo: v.number,
    docDate: v.date,
    fromGstin: company.gstin,
    fromTrdName: company.mailingName ?? company.name,
    fromState: sellerState,
    actFromState: sellerState,
    toGstin: party!.gstin,
    toTrdName: party!.name,
    toState: posCode,
    actToState: posCode,
    totalValue: r2(taxable),
    cgstValue: cgstAmt,
    sgstValue: sgstAmt,
    igstValue: igstAmt,
    cessValue: cessAmt,
    totInvValue,
    itemList,
  };

  // Part-B: included only when transport details were supplied on the request.
  if (params.vehicleNo || params.transDocNo || params.transporterName || mode) {
    payload.vehicleList = [
      {
        vehicleNo: params.vehicleNo ?? undefined,
        transMode: mode ?? "1",
        transDocNo: params.transDocNo ?? undefined,
        transDocDate: params.transDocDate ?? undefined,
      },
    ];
    if (params.transporterName) payload.transporterName = params.transporterName;
  }

  return { ok: true, errors: [], warnings, payload };
}
