import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { useCompany } from "../store";
import { get } from "../lib/api";
import { num, r2, fmtDate } from "../lib/format";
import { amountWords } from "../lib/amountWords";
import { useCompanyLogo } from "../lib/useCompanyLogo";

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
 * R-68: when the voucher has an ACCEPTED e-invoice with an IRP-signed QR
 * (stored from NIC's GENIRN response), the face renders the IRN QR strip —
 * IRN, QR (SVG, crisp on paper), acknowledgement number + date. Pre-R-68
 * submissions, cancelled/rejected rows, and vouchers never submitted render
 * no strip — honest.
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
  const isSales = voucher.type?.name === "Sales";
  const isDN = voucher.type?.name === "Delivery Note";
  const docTitle = isSales ? "INVOICE" : "DELIVERY NOTE";
  // R-74: the seller header renders from the LIVE company record (the store
  // payload) — R-66's voucher.company read never had a data source, so the
  // seller block has rendered blank until now (suite-verified defect found
  // en-route). Same source carries the logo fact for the top-left print slot.
  const { company } = useCompany();
  const co: any = company ?? voucher.company ?? {};
  const { data: logoUrl } = useCompanyLogo(cid);
  // R-68: the accepted e-invoice for this voucher (if any) — carries the
  // IRP-signed QR stored at GENIRN-accept time.
  const { data: submissions } = useQuery({
    queryKey: ["einvoice-submissions", cid, voucherId],
    queryFn: () => get<any[]>(`/api/c/${cid}/reports/submissions?voucherId=${voucherId}`),
    enabled: !!cid && !!voucherId,
    staleTime: 60_000,
  });
  const einv = (submissions ?? []).find((s: any) => s.kind === "e-invoice" && s.status === "accepted" && s.signedQrCode);
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
  // R-83 (Option A, F-83-4): the voucher's own descriptive invoice details —
  // buyer address override, consignee ship-to, dispatch and order screens.
  // Everything renders ONLY when the voucher carries it: untouched vouchers
  // produce a byte-identical face (off-state contract, suite-pinned).
  const d = (voucher.invoiceDetails ?? {}) as any;
  const hasConsignee = !!(d.consigneeName || d.consigneeAddress);
  const dispatchRows: [string, any][] = [
    ["Dispatch Doc No.", d.dispatchDocNo], ["Dispatched Through", d.dispatchedThrough], ["Destination", d.destination],
    ["Carrier LR-RR No.", d.carrierLrRrNo], ["Vehicle No.", d.vehicleNo],
    ["Port of Loading", d.portOfLoading], ["Port of Discharge", d.portOfDischarge],
    ["Marks / Container No.", d.marksContainerNo], ["No. of Packages", d.numberOfPackages],
  ];
  const orderRows: [string, any][] = [
    ["Buyer Order No.", d.buyerOrderNo], ["Order Date", d.buyerOrderDate ? fmtDate(d.buyerOrderDate) : null],
    ["Mode / Terms of Payment", d.modeTermsOfPayment], ["Other References", d.otherReferences],
    ["Terms of Delivery", d.termsOfDelivery],
  ];
  const hasDetails = dispatchRows.some(([, v]) => v) || orderRows.some(([, v]) => v);

  return (
    <div className="border border-slate-700 rounded-lg w-[760px] bg-white text-slate-900 mx-auto">
      {/* header */}
      <div className="flex justify-between items-start border-b-2 border-slate-700 px-6 py-4">
        <div className="flex items-start gap-4">
          {logoUrl && (
            <img src={logoUrl} alt="" data-testid="invoice-logo" className="w-20 h-20 object-contain shrink-0" />
          )}
          <div>
            <div className="text-lg font-bold">{co.mailingName || co.name}</div>
            <div className="text-xs text-slate-600 leading-relaxed">
              {co.address ? <div>{co.address}</div> : null}
              {co.city || co.pincode ? (
                <div>{[co.city, co.pincode].filter(Boolean).join(" - ")}</div>
              ) : null}
              {co.gstin ? <div>GSTIN: <b>{co.gstin}</b></div> : null}
              {co.phone ? <div>Ph: {co.phone}</div> : null}
            </div>
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

      {/* party — R-83: the voucher's buyer-address override wins over the
          ledger master; a consignee adds Tally's Ship-to column. */}
      <div className={`grid ${hasConsignee ? "grid-cols-3" : "grid-cols-2"} border-b border-slate-400`}>
        <div className="px-6 py-3 border-r border-slate-400">
          <div className="text-[11px] uppercase tracking-wider text-slate-500">Billed to</div>
          <div className="font-semibold text-sm">{voucher.partyName || "—"}</div>
          {(d.buyerAddress ? [d.buyerAddress] : voucher.partyAddress ? [voucher.partyAddress] : []).map((l: string, i: number) => <div key={i} className="text-xs text-slate-600">{l}</div>)}
          {voucher.partyGstin ? <div className="text-xs text-slate-600">GSTIN: {voucher.partyGstin}</div> : null}
        </div>
        <div className={`px-6 py-3 ${hasConsignee ? "border-r border-slate-400" : ""}`}>
          <div className="text-[11px] uppercase tracking-wider text-slate-500">Place of supply</div>
          <div className="text-sm">{voucher.placeOfSupply || voucher.partyState || "—"}</div>
        </div>
        {hasConsignee && (
          <div className="px-6 py-3" data-testid="invoice-ship-to">
            <div className="text-[11px] uppercase tracking-wider text-slate-500">Ship to (consignee)</div>
            <div className="font-semibold text-sm">{d.consigneeName || voucher.partyName || "—"}</div>
            {(d.consigneeAddress ? [d.consigneeAddress] : []).map((l: string, i: number) => <div key={i} className="text-xs text-slate-600">{l}</div>)}
          </div>
        )}
      </div>

      {/* R-83: dispatch + order details — two columns, only the filled rows,
          only when the voucher carries any (Tally's face order: after the
          party block, before the inventory rows). */}
      {hasDetails && (
        <div className="grid grid-cols-2 border-b border-slate-400 text-xs" data-testid="invoice-details-face">
          <div className="px-6 py-2 border-r border-slate-400 space-y-0.5">
            {dispatchRows.filter(([, v]) => v).map(([k, v]) => (
              <div key={k}><span className="text-slate-500">{k}: </span><b>{v}</b></div>
            ))}
          </div>
          <div className="px-6 py-2 space-y-0.5">
            {orderRows.filter(([, v]) => v).map(([k, v]) => (
              <div key={k}><span className="text-slate-500">{k}: </span><b>{v}</b></div>
            ))}
          </div>
        </div>
      )}

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

      {/* R-68: IRN QR strip — present only with an accepted, QR-bearing e-invoice */}
      {einv && (
        <div className="border-t border-slate-400 px-6 py-3 text-xs flex items-center gap-4" data-testid="irn-qr-strip">
          <QRCodeSVG value={einv.signedQrCode} size={84} includeMargin={true} className="shrink-0" />
          <div className="leading-relaxed">
            <div className="text-[11px] uppercase tracking-wider text-slate-500">e-invoice registered (IRP)</div>
            <div>IRN: <b className="break-all font-mono text-[10px]">{einv.irn}</b></div>
            {einv.ackNo ? <div className="text-slate-600">Ack No: {einv.ackNo}{einv.ackDate ? ` · ${einv.ackDate}` : ""}</div> : null}
          </div>
        </div>
      )}

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
          <div className="text-slate-500">for {co.mailingName || co.name}</div>
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
