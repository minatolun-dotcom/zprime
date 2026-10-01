// R-84 (A1): Deposit Slips + Payment Advice — Tally's banking-print family
// (help.tallysolutions.com/deposit-slips). A REPORT over recorded bank legs,
// not new accounting: pick a bank, the list shows that bank's unreconciled
// deposit candidates (Receipt/Contra legs arriving — or, on the Payment
// Advice view, Payment legs leaving), multi-select rows, and print per-slip
// or consolidated faces. Printing stamps deposit_slip_printed_at (Tally's
// printed bookkeeping); the Incl Printed toggle re-lists stamped rows.
// Cash denominations are PRINT-ONLY (a print helper for the teller slip) —
// zprime records no cash-count facts, so nothing about them persists.
import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Shell from "../components/Shell";
import { Card, PageHead } from "../components/ui";
import { get, patch } from "../lib/api";
import { useCompany } from "../store";
import { num, fmtDate } from "../lib/format";
import { useCompanyLogo } from "../lib/useCompanyLogo";
import { amountWords } from "../lib/amountWords";

const DENOMS = [500, 200, 100, 50, 20, 10];

export default function DepositSlips() {
  const { cid } = useParams();
  const qc = useQueryClient();
  const { company } = useCompany();
  const { data: logoUrl } = useCompanyLogo(cid);
  const [kind, setKind] = useState<"deposit" | "payment-advice">("deposit");
  const [slipKind, setSlipKind] = useState<"cheque" | "cash" | "consolidated">("cheque");
  const [ledgerId, setLedgerId] = useState<string>("");
  const [inclPrinted, setInclPrinted] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [denoms, setDenoms] = useState<Record<number, string>>({});
  const [dateOfPrint, setDateOfPrint] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  // R-84 (A1): the picker lists the server's bank definition (Bank Accounts
  // group — never Cash) via /banks, the same source the candidate filter uses.
  const { data: banks } = useQuery({ queryKey: ["banks", cid], queryFn: () => get<any[]>(`/api/c/${cid}/banks`) });
  const bankList = useMemo(() => banks ?? [], [banks]);
  const bank = bankList.find((b: any) => String(b.id) === ledgerId) ?? bankList[0];

  const qs = new URLSearchParams({ kind });
  if (bank) qs.set("ledgerId", String(bank.id));
  if (inclPrinted) qs.set("includePrinted", "1");
  const { data: rows } = useQuery({
    queryKey: ["deposit-candidates", cid, kind, bank?.id, inclPrinted],
    queryFn: () => get<any[]>(`/api/c/${cid}/deposit-candidates?${qs.toString()}`),
    enabled: !!bank,
  });
  const list = rows ?? [];
  const selected = list.filter((r) => picked.has(r.voucherId));
  const total = selected.reduce((s, r) => s + num(r.amount), 0);

  const stamp = async (printed: boolean) => {
    if (!selected.length) return;
    setBusy(true);
    try {
      await patch(`/api/c/${cid}/deposit-slips/print`, { voucherIds: selected.map((r) => r.voucherId), printed });
      setPicked(new Set());
      qc.invalidateQueries({ queryKey: ["deposit-candidates"] });
    } finally {
      setBusy(false);
    }
  };

  const printSel = () => {
    if (!selected.length) return;
    document.body.setAttribute("data-print-mode", "slips");
    window.print();
    setTimeout(() => stamp(true), 400); // Tally marks slips printed when printed
  };

  const co = company ?? ({} as any);
  const bankBlock = (b: any) => [
    b?.bankLedger ?? "",
    b?.bankAccount ? `A/c No: ${b.bankAccount}` : "",
    co.name ?? "",
    [co.address, co.city].filter(Boolean).join(", "),
    [co.phone ? `Ph: ${co.phone}` : "", co.email ?? ""].filter(Boolean).join(" · "),
    co.gstin ? `GSTIN: ${co.gstin}` : "",
  ].filter(Boolean);

  return (
    <Shell title="Deposit Slips" breadcrumb={[{ label: "Gateway", to: `/company/${cid}` }, { label: "Deposit Slips" }]}>
      {/* print layer: one slip per selected voucher, or a consolidated slip */}
      <div className="hidden print:block fixed inset-0 bg-white text-slate-900 p-6 overflow-auto">
        {kind === "deposit" ? (
          slipKind === "consolidated" ? (
            <ConsolidatedSlip co={co} logoUrl={logoUrl ?? undefined} bank={bank} rows={selected} dateOfPrint={dateOfPrint} kind={kind} denoms={denoms} />
          ) : (
            selected.map((r) => (
              <div key={r.voucherId} className="break-after-page">
                <SlipFace co={co} logoUrl={logoUrl ?? undefined} bank={bank} row={r} dateOfPrint={dateOfPrint} slipKind={slipKind} denoms={denoms} />
              </div>
            ))
          )
        ) : (
          selected.map((r) => (
            <div key={r.voucherId} className="break-after-page">
              <AdviceFace co={co} logoUrl={logoUrl ?? undefined} bank={bank} row={r} dateOfPrint={dateOfPrint} />
            </div>
          ))
        )}
      </div>

      <div className="print:hidden">
        <PageHead
          title="Deposit Slips"
          sub="Print bank deposit slips / payment advice from recorded vouchers — printing marks them printed"
          actions={
            <div className="flex gap-2 items-center">
              <button className="btn-ghost" disabled={busy || !selected.length} onClick={() => stamp(false)}>Mark Unprinted</button>
              <button className="btn-primary" data-testid="print-slips" disabled={busy || !selected.length} onClick={printSel}>
                Print {selected.length ? `(${selected.length})` : ""}
              </button>
            </div>
          }
        />
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <select className="max-w-[180px]" data-testid="ds-kind" value={kind} onChange={(e) => { setKind(e.target.value as any); setPicked(new Set()); }}>
            <option value="deposit">Deposit Slips</option>
            <option value="payment-advice">Payment Advice</option>
          </select>
          <select className="max-w-[220px]" data-testid="ds-bank" value={bank?.id ?? ""} onChange={(e) => { setLedgerId(e.target.value); setPicked(new Set()); }}>
            {bankList.map((b: any) => <option key={b.id} value={b.id}>{b.bankLedger}</option>)}
          </select>
          {kind === "deposit" && (
            <select className="max-w-[160px]" data-testid="ds-slip-kind" value={slipKind} onChange={(e) => setSlipKind(e.target.value as any)}>
              <option value="cheque">Cheque Slip</option>
              <option value="cash">Cash Slip</option>
              <option value="consolidated">Consolidated</option>
            </select>
          )}
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input type="checkbox" data-testid="ds-incl-printed" checked={inclPrinted} onChange={(e) => setInclPrinted(e.target.checked)} />
            Incl printed
          </label>
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            Date of print
            <input type="date" value={dateOfPrint} onChange={(e) => setDateOfPrint(e.target.value)} />
          </label>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <Card>
            <table className="report-table">
              <thead><tr>
                <th className="w-8"></th>
                <th className="w-24">Date</th><th className="w-20">Type</th>
                <th className="w-28">{kind === "deposit" ? "Chq / Ref" : "Instrument"}</th>
                <th>Received From / Narration</th>
                <th className="w-28 text-right">Amount</th><th className="w-24">Printed</th>
              </tr></thead>
              <tbody>
                {list.map((r: any) => (
                  <tr key={r.voucherId} className={picked.has(r.voucherId) ? "bg-indigo-50/60" : ""}>
                    <td>
                      <input type="checkbox" data-testid={`ds-pick-${r.voucherId}`} checked={picked.has(r.voucherId)}
                        onChange={(e) => {
                          const next = new Set(picked);
                          if (e.target.checked) next.add(r.voucherId); else next.delete(r.voucherId);
                          setPicked(next);
                        }} />
                    </td>
                    <td className="cell-nowrap">{fmtDate(r.date)}</td>
                    <td className="cell-nowrap text-slate-500">{r.typeName}</td>
                    <td className="font-mono cell-nowrap">{r.chequeNumber || r.bankRefId || "—"}</td>
                    <td className="text-slate-500 min-w-[160px] [overflow-wrap:anywhere]">{r.receivedFrom || r.narration || "—"}</td>
                    <td className="num">{r.amount.toLocaleString("en-IN")}</td>
                    <td className="cell-nowrap">{r.printedAt ? <span data-testid="ds-printed-chip" className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-emerald-100 text-emerald-700">printed</span> : <span className="text-slate-400 text-xs">—</span>}</td>
                  </tr>
                ))}
                {list.length === 0 && (
                  <tr><td colSpan={7} className="text-center text-slate-400 py-6">
                    No {kind === "deposit" ? "unprinted deposits" : "unprinted payments"} for this bank — record Receipt/Payment vouchers with bank legs
                  </td></tr>
                )}
              </tbody>
            </table>
          </Card>

          <Card className="p-5">
            <div className="text-sm font-semibold mb-2.5">Preview {selected.length ? `· ${selected.length} slip${selected.length > 1 ? "s" : ""} · ₹${total.toLocaleString("en-IN")}` : ""}</div>
            {kind === "deposit" && slipKind === "cash" && (
              <div className="mb-3" data-testid="ds-denoms">
                <div className="text-xs text-slate-500 mb-1.5">Cash denominations (print-only — not recorded)</div>
                <div className="grid grid-cols-6 gap-2">
                  {DENOMS.map((d) => (
                    <label key={d} className="text-xs text-slate-600">
                      ×{d}
                      <input className="w-full mt-0.5" type="number" min="0" value={denoms[d] ?? ""} onChange={(e) => setDenoms({ ...denoms, [d]: e.target.value })} />
                    </label>
                  ))}
                </div>
              </div>
            )}
            {selected.length ? (
              kind === "deposit" ? (
                slipKind === "consolidated"
                  ? <ConsolidatedSlip co={co} logoUrl={logoUrl ?? undefined} bank={bank} rows={selected} dateOfPrint={dateOfPrint} kind={kind} denoms={denoms} />
                  : <SlipFace co={co} logoUrl={logoUrl ?? undefined} bank={bank} row={selected[0]} dateOfPrint={dateOfPrint} slipKind={slipKind} denoms={denoms} />
              ) : (
                <AdviceFace co={co} logoUrl={logoUrl ?? undefined} bank={bank} row={selected[0]} dateOfPrint={dateOfPrint} />
              )
            ) : (
              <p className="text-sm text-slate-400">Select rows to preview the {kind === "deposit" ? "slip" : "advice"} face.</p>
            )}
            <p className="text-xs text-slate-500 mt-3 leading-relaxed">
              Printing stamps the selected vouchers printed (Tally's deposit-slip bookkeeping) — "Incl printed" re-lists them.
            </p>
          </Card>
        </div>
      </div>
    </Shell>
  );
}

function CoHeader({ co, logoUrl, title, dateOfPrint }: { co: any; logoUrl?: string; title: string; dateOfPrint: string }) {
  return (
    <div className="flex items-start justify-between border-b-2 border-slate-800 pb-2 mb-3">
      <div className="flex items-start gap-3">
        {logoUrl && <img src={logoUrl} alt="" className="w-14 h-14 object-contain" />}
        <div>
          <div className="font-bold text-[15px]">{co.name ?? ""}</div>
          <div className="text-[11px] text-slate-600">{[co.address, co.city, co.state, co.pincode].filter(Boolean).join(", ")}</div>
          <div className="text-[11px] text-slate-600">{[co.phone ? `Ph: ${co.phone}` : "", co.email, co.gstin ? `GSTIN: ${co.gstin}` : ""].filter(Boolean).join(" · ")}</div>
        </div>
      </div>
      <div className="text-right">
        <div className="font-bold text-[13px] uppercase">{title}</div>
        <div className="text-[11px] text-slate-600">Date of print: {fmtDate(dateOfPrint)}</div>
      </div>
    </div>
  );
}

function SlipFace({ co, logoUrl, bank, row, dateOfPrint, slipKind, denoms }: { co: any; logoUrl?: string; bank: any; row: any; dateOfPrint: string; slipKind: string; denoms: Record<number, string> }) {
  const denomTotal = DENOMS.reduce((s, d) => s + (parseInt(denoms[d] ?? "0", 10) || 0) * d, 0);
  return (
    <div className="border-2 border-slate-800 rounded-lg p-4 w-[640px] bg-white text-slate-900">
      <CoHeader co={co} logoUrl={logoUrl} title={slipKind === "cash" ? "Cash Deposit Slip" : "Cheque Deposit Slip"} dateOfPrint={dateOfPrint} />
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] mb-3">
        <div><b>Deposited into:</b> {bank?.bankLedger ?? ""}{bank?.bankAccount ? ` · A/c ${bank.bankAccount}` : ""}</div>
        <div className="text-right"><b>Slip No.:</b> {row.typeName.slice(0, 3).toUpperCase()}-{row.number}</div>
        <div><b>Account holder:</b> {co.mailingName || co.name || ""}</div>
        <div className="text-right"><b>Voucher:</b> {row.typeName} #{row.number} · {fmtDate(row.date)}</div>
      </div>
      {slipKind === "cheque" ? (
        <table className="w-full text-[12px] border border-slate-400">
          <thead><tr className="bg-slate-100"><th className="border border-slate-300 px-2 py-1 text-left">Received From</th><th className="border border-slate-300 px-2 py-1">Cheque No.</th><th className="border border-slate-300 px-2 py-1">Cheque Date</th><th className="border border-slate-300 px-2 py-1 text-right">Amount (₹)</th></tr></thead>
          <tbody><tr>
            <td className="border border-slate-300 px-2 py-1">{row.receivedFrom || row.narration || "—"}</td>
            <td className="border border-slate-300 px-2 py-1 font-mono text-center">{row.chequeNumber || row.bankRefId || "—"}</td>
            <td className="border border-slate-300 px-2 py-1 text-center">{row.chequeDate ? fmtDate(row.chequeDate) : fmtDate(row.date)}</td>
            <td className="border border-slate-300 px-2 py-1 text-right num">{row.amount.toLocaleString("en-IN")}</td>
          </tr></tbody>
        </table>
      ) : (
        <table className="w-full text-[12px] border border-slate-400">
          <thead><tr className="bg-slate-100"><th className="border border-slate-300 px-2 py-1 text-left">Denomination (₹)</th><th className="border border-slate-300 px-2 py-1">Count</th><th className="border border-slate-300 px-2 py-1 text-right">Amount (₹)</th></tr></thead>
          <tbody>
            {DENOMS.filter((d) => parseInt(denoms[d] ?? "0", 10) > 0).map((d) => (
              <tr key={d}><td className="border border-slate-300 px-2 py-1">{d}</td><td className="border border-slate-300 px-2 py-1 text-center">{denoms[d]}</td><td className="border border-slate-300 px-2 py-1 text-right num">{((parseInt(denoms[d], 10) || 0) * d).toLocaleString("en-IN")}</td></tr>
            ))}
            <tr className="font-semibold bg-slate-50"><td className="border border-slate-300 px-2 py-1" colSpan={2}>Total cash</td><td className="border border-slate-300 px-2 py-1 text-right num">{(denomTotal || row.amount).toLocaleString("en-IN")}</td></tr>
          </tbody>
        </table>
      )}
      <div className="mt-3 text-[12px]"><b>Rupees {amountWords(row.amount)} only</b></div>
      <div className="mt-6 flex justify-between text-[11px] text-slate-600">
        <span>Depositor's signature: ____________________</span>
        <span>For the Bank: ____________________</span>
      </div>
    </div>
  );
}

function ConsolidatedSlip({ co, logoUrl, bank, rows, dateOfPrint, kind, denoms }: { co: any; logoUrl?: string; bank: any; rows: any[]; dateOfPrint: string; kind: string; denoms: Record<number, string> }) {
  const total = rows.reduce((s, r) => s + num(r.amount), 0);
  return (
    <div className="border-2 border-slate-800 rounded-lg p-4 w-[640px] bg-white text-slate-900">
      <CoHeader co={co} logoUrl={logoUrl} title="Consolidated Deposit Slip" dateOfPrint={dateOfPrint} />
      <div className="text-[12px] mb-2"><b>Deposited into:</b> {bank?.bankLedger ?? ""}{bank?.bankAccount ? ` · A/c ${bank.bankAccount}` : ""}</div>
      <table className="w-full text-[12px] border border-slate-400">
        <thead><tr className="bg-slate-100"><th className="border border-slate-300 px-2 py-1 text-left">Voucher</th><th className="border border-slate-300 px-2 py-1">Date</th><th className="border border-slate-300 px-2 py-1 text-left">Received From</th><th className="border border-slate-300 px-2 py-1">Instrument</th><th className="border border-slate-300 px-2 py-1 text-right">Amount (₹)</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.voucherId}>
              <td className="border border-slate-300 px-2 py-1">{r.typeName} #{r.number}</td>
              <td className="border border-slate-300 px-2 py-1 text-center">{fmtDate(r.date)}</td>
              <td className="border border-slate-300 px-2 py-1">{r.receivedFrom || r.narration || "—"}</td>
              <td className="border border-slate-300 px-2 py-1 font-mono text-center">{r.chequeNumber || r.bankRefId || "cash"}</td>
              <td className="border border-slate-300 px-2 py-1 text-right num">{r.amount.toLocaleString("en-IN")}</td>
            </tr>
          ))}
          <tr className="font-semibold bg-slate-50"><td className="border border-slate-300 px-2 py-1" colSpan={4}>Total ({rows.length} vouchers{kind === "deposit" && Object.values(denoms).some((v) => parseInt(v, 10) > 0) ? " · cash denominationed on teller slip" : ""})</td><td className="border border-slate-300 px-2 py-1 text-right num">{total.toLocaleString("en-IN")}</td></tr>
        </tbody>
      </table>
      <div className="mt-3 text-[12px]"><b>Rupees {amountWords(total)} only</b></div>
      <div className="mt-6 flex justify-between text-[11px] text-slate-600">
        <span>Depositor's signature: ____________________</span>
        <span>For the Bank: ____________________</span>
      </div>
    </div>
  );
}

function AdviceFace({ co, logoUrl, bank, row, dateOfPrint }: { co: any; logoUrl?: string; bank: any; row: any; dateOfPrint: string }) {
  return (
    <div className="border-2 border-slate-800 rounded-lg p-4 w-[640px] bg-white text-slate-900">
      <CoHeader co={co} logoUrl={logoUrl} title="Payment Advice" dateOfPrint={dateOfPrint} />
      <div className="text-[12px] space-y-1 mb-3">
        <div>To: The Manager, <b>{bank?.bankLedger ?? ""}</b>{bank?.bankAccount ? ` · A/c ${bank.bankAccount}` : ""}</div>
        <div>Re: Payment of <b>₹{row.amount.toLocaleString("en-IN")}</b> ({amountWords(row.amount)} only)</div>
      </div>
      <table className="w-full text-[12px] border border-slate-400">
        <thead><tr className="bg-slate-100"><th className="border border-slate-300 px-2 py-1 text-left">Particulars</th><th className="border border-slate-300 px-2 py-1">Instrument</th><th className="border border-slate-300 px-2 py-1">Dated</th><th className="border border-slate-300 px-2 py-1 text-right">Amount (₹)</th></tr></thead>
        <tbody><tr>
          <td className="border border-slate-300 px-2 py-1">{row.receivedFrom || row.narration || "Payment as per voucher"}</td>
          <td className="border border-slate-300 px-2 py-1 font-mono text-center">{row.chequeNumber || row.bankRefId || (row.txnType ?? "").toUpperCase() || "—"}</td>
          <td className="border border-slate-300 px-2 py-1 text-center">{row.chequeDate ? fmtDate(row.chequeDate) : fmtDate(row.date)}</td>
          <td className="border border-slate-300 px-2 py-1 text-right num">{row.amount.toLocaleString("en-IN")}</td>
        </tr></tbody>
      </table>
      <div className="mt-3 text-[12px] text-slate-700">Voucher: {row.typeName} #{row.number} · {fmtDate(row.date)}. Kindly credit the beneficiary and debit our account.</div>
      <div className="mt-6 flex justify-between text-[11px] text-slate-600">
        <span>Authorised signatory: ____________________</span>
        <span>For {co.name ?? ""}</span>
      </div>
    </div>
  );
}
