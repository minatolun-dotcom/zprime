import { useCompany } from "../store";
import { num, r2, fmtDate } from "../lib/format";
import { amountWords } from "../lib/amountWords";

/**
 * R-66: printable invoice face for Sales / Delivery Note vouchers (edit mode).
 *
 * Same proven pattern as ChequePrint: a fixed print-only layer renders ONLY
 * the invoice when window.print() fires; the on-screen preview lives inside a
 * print:hidden card. GST lines come from the voucher's own duty-head entries
 * (Input/Output CGST/SGST/IGST rate split as posted); inventory rows carry
 * HSN from the entry snapshot when present. Amount in words is the shared
 * Indian-system helper (same text as cheque printing).
 *
 * Zero accounting surface: this only renders what the books already hold.
 */

export default function InvoicePrint(props: {
  cid: string;
  voucherId: string;
  voucher: any;
}) {
  return (
    <>
      <PrintOnlyInvoice {...props} />
      <ScreenPreview {...props} />
    </>
  );
}

/** The paper artifact — fills a fixed print-only layer. */
function PrintOnlyInvoice({ cid, voucherId, voucher }: { cid: string; voucherId: string; voucher: any }) {
  return (
    <div className="hidden print:block fixed inset-0 bg-white p-8 overflow-auto">
      <InvoiceFace cid={cid} voucherId={voucherId} voucher={voucher} />
    </div>
  );
}

/** On-screen preview (hidden on paper) — one glance before printing. */
function ScreenPreview({ cid, voucherId, voucher }: { cid: string; voucherId: string; voucher: any }) {
  return (
    <div className="print:hidden card p-5 max-w-5xl mt-6">
      <div className="text-sm font-semibold mb-2.5">Invoice preview</div>
      <div className="overflow-x-auto">
        <div className="origin-top-left" style={{ transform: "scale(0.72)" }}>
          <InvoiceFace cid={cid} voucherId={voucherId} voucher={voucher} />
        </div>
      </div>
      <p className="text-xs text-slate-500 mt-2.5 leading-relaxed">
        Print on your letterhead or plain paper — the sheet prints alone, without app chrome.
      </p>
    </div>
  );
}

function InvoiceFace({ cid, voucherId, voucher }: { cid: string; voucherId: string; voucher: any }) {
  void cid; void voucherId;
  const isSales = voucher.type?.name === "Sales";
  const isDN = voucher.type?.name === "Delivery Note";
  const docTitle = isSales ? "INVOICE" : "DELIVERY NOTE";
  const amt = Math.abs(num(voucher.total ?? voucher.entries?.reduce((s: number, e: any) => s + Math.max(num(e.amount), 0), 0)));
  const partyRows = voucher.entries?.filter((e: any) => e.ledgerId === voucher.partyLedgerId) ?? [];
  const partyAmt = partyRows.reduce((s: number, e: any) => s + Math.abs(num(e.amount)), 0);
  const goods = voucher.entries?.filter((e: any) => e.ledgerId !== voucher.partyLedgerId && !isDuty(e)) ?? [];
  const duties = voucher.entries?.filter(isDuty) ?? [];
  const totalTax = duties.reduce((s: number, e: any) => s + Math.abs(num(e.amount)), 0);
  const taxable = r2(goods.reduce((s: number, e: any) => s + Math.abs(num(e.amount)), 0));
  const despatch = (voucher.inventoryEntries ?? []).map((i: any) => ({
    ...i, qtyAbs: Math.abs(num(i.qty)), amount: Math.abs(num(i.amount)),
  }));

  return (
    <div className="border border-slate-700 rounded-lg w-[760px] bg-white text-slate-900 mx-auto">
      {/* header */}
      <div className="flex justify-between items-start border-b-2 border-slate-700 px-6 py-4">
        <div>
          <div className="text-lg font-bold">{voucher.company?.mailingName || voucher.company?.name}</div>
          <div className="text-xs text-slate-600 leading-relaxed">
            {voucher.company?.address ? <div>{voucher.company.address}</div> : null}
            {voucher.company?.city || voucher.company?.pincode ? (
              <div>{[voucher.company?.city, voucher.company?.pincode].filter(Boolean).join(" - ")}</div>
            ) : null}
            {voucher.company?.gstin ? <div>GSTIN: <b>{voucher.company.gstin}</b></div> : null}
            {voucher.company?.phone ? <div>Ph: {voucher.company.phone}</div> : null}
          </div>
        </div>
        <div className="text-right">
          <div className="text-base font-bold tracking-wide">{docTitle}</div>
          <div className="text-xs text-slate-600 mt-1">No. <b>{voucher.number}</b></div>
          <div className="text-xs text-slate-600">Date: {fmtDate(voucher.date)}</div>
          {voucher.reference ? <div className="text-xs text-slate-600">Ref: {voucher.reference}</div> : null}
          {voucher.refDate ? <div className="text-xs text-slate-600">Ref date: {fmtDate(voucher.refDate)}</div> : null}
        </div>
      </div>

      {/* party */}
      <div className="grid grid-cols-2 border-b border-slate-400">
        <div className="px-6 py-3 border-r border-slate-400">
          <div className="text-[11px] uppercase tracking-wider text-slate-500">Billed to</div>
          <div className="font-semibold text-sm">{voucher.partyName || "—"}</div>
          {(voucher.partyAddress ? [voucher.partyAddress] : []).map((l: string, i: number) => <div key={i} className="text-xs text-slate-600">{l}</div>)}
          {voucher.partyGstin ? <div className="text-xs text-slate-600">GSTIN: {voucher.partyGstin}</div> : null}
        </div>
        <div className="px-6 py-3">
          <div className="text-[11px] uppercase tracking-wider text-slate-500">Place of supply</div>
          <div className="text-sm">{voucher.placeOfSupply || voucher.partyState || "—"}</div>
        </div>
      </div>

      {/* inventory rows (when the voucher carries stock movements) */}
      {despatch.length > 0 && (
        <table className="w-full text-xs border-b border-slate-400">
          <thead>
            <tr className="bg-slate-100">
              <th className="text-left px-6 py-1.5 font-semibold">Item</th>
              <th className="text-right px-3 py-1.5 font-semibold w-20">HSN</th>
              <th className="text-right px-3 py-1.5 font-semibold w-16">Qty</th>
              <th className="text-right px-3 py-1.5 font-semibold w-20">Rate</th>
              <th className="text-right px-6 py-1.5 font-semibold w-24">Amount</th>
            </tr>
          </thead>
          <tbody>
            {despatch.map((i: any, idx: number) => (
              <tr key={idx} className="border-t border-slate-200">
                <td className="px-6 py-1.5">{i.itemName ?? `#${i.itemId}`}</td>
                <td className="text-right px-3 py-1.5 font-mono">{i.hsnSac || "—"}</td>
                <td className="text-right px-3 py-1.5">{i.qtyAbs}</td>
                <td className="text-right px-3 py-1.5">{num(i.rate).toLocaleString("en-IN")}</td>
                <td className="text-right px-6 py-1.5">{i.amount.toLocaleString("en-IN")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* accounting lines */}
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-slate-100">
            <th className="text-left px-6 py-1.5 font-semibold">Particulars</th>
            <th className="text-right px-3 py-1.5 font-semibold w-20">HSN</th>
            <th className="text-right px-3 py-1.5 font-semibold w-20">Rate %</th>
            <th className="text-right px-6 py-1.5 font-semibold w-24">Amount</th>
          </tr>
        </thead>
        <tbody>
          {goods.map((e: any, idx: number) => (
            <tr key={idx} className="border-t border-slate-200">
              <td className="px-6 py-1.5">{e.ledgerName}</td>
              <td className="text-right px-3 py-1.5 font-mono">{e.hsnSac || "—"}</td>
              <td className="text-right px-3 py-1.5">{e.gstRate ? `${num(e.gstRate)}%` : "—"}</td>
              <td className="text-right px-6 py-1.5">{Math.abs(num(e.amount)).toLocaleString("en-IN")}</td>
            </tr>
          ))}
          {duties.map((e: any, idx: number) => (
            <tr key={`d${idx}`} className="border-t border-slate-200 text-slate-600">
              <td className="px-6 py-1.5 pl-10">{e.ledgerName}</td>
              <td className="text-right px-3 py-1.5">—</td>
              <td className="text-right px-3 py-1.5">{e.gstRate ? `${num(e.gstRate)}%` : "—"}</td>
              <td className="text-right px-6 py-1.5">{Math.abs(num(e.amount)).toLocaleString("en-IN")}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-slate-700 font-bold">
            <td className="px-6 py-2" colSpan={3}>Total</td>
            <td className="text-right px-6 py-2">{partyAmt.toLocaleString("en-IN")}</td>
          </tr>
        </tbody>
      </table>

      {/* tax summary + amount in words */}
      <div className="border-t border-slate-400 px-6 py-3 text-xs">
        {totalTax > 0 && (
          <div className="mb-2 text-slate-600">
            Taxable value <b>{taxable.toLocaleString("en-IN")}</b> · Total GST <b>{totalTax.toLocaleString("en-IN")}</b>
          </div>
        )}
        <div className="border border-slate-300 rounded px-3 py-2">
          <span className="text-slate-500">Amount in words: </span>
          <b>Rupees {amountWords(Math.floor(amt))}{amt % 1 ? ` and ${Math.round((amt % 1) * 100)} Paise` : ""} Only</b>
        </div>
      </div>

      {/* narration + signature */}
      <div className="border-t border-slate-400 px-6 py-3 text-xs flex justify-between items-end">
        <div className="max-w-[420px]">
          {voucher.narration ? (
            <>
              <div className="text-[11px] uppercase tracking-wider text-slate-500">Narration</div>
              <div className="text-slate-700 leading-relaxed">{String(voucher.narration).replace(/^Being\s*/i, "")}</div>
            </>
          ) : null}
        </div>
        <div className="text-right">
          <div className="text-slate-500">for {voucher.company?.mailingName || voucher.company?.name}</div>
          <div className="mt-8 border-t border-slate-400 pt-1 text-slate-600">Authorised Signatory</div>
        </div>
      </div>
    </div>
  );
}

/** Duty lines for the invoice tax block. Classified by the LEDGER's dutyHead
 *  when available (the R-66 standard — the ledger master declares IGST/CGST/
 *  SGST/RCM), falling back to the duty-ledger NAME shape so pre-classification
 *  payloads still render honestly. */
function isDuty(e: any): boolean {
  if (e.dutyHead && !["TDS", "TCS"].includes(e.dutyHead)) return true;
  return /(^|\s)(Output|Input)\s+(IGST|CGST|SGST|UTGST|CESS)$/i.test(e.ledgerName ?? "")
    || /^(IGST|CGST|SGST\/UTGST|CESS|RCM Payable)$/i.test((e.ledgerName ?? "").trim());
}
