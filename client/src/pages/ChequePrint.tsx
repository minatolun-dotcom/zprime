import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Shell from "../components/Shell";
import { Card, PageHead } from "../components/ui";
import { get } from "../lib/api";
import { useCompany } from "../store";
import { num, today, fmtDate } from "../lib/format";

/** Amount in words (Indian system) for cheque printing. */
function words(n: number): string {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
    "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (x: number): string => (x < 20 ? ones[x] : `${tens[Math.floor(x / 10)]}${x % 10 ? " " + ones[x % 10] : ""}`);
  const three = (x: number): string => (x >= 100 ? `${ones[Math.floor(x / 100)]} Hundred${x % 100 ? " " + two(x % 100) : ""}` : two(x));
  if (n === 0) return "Zero";
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const thousand = Math.floor(n / 1e3); n %= 1e3;
  const parts: string[] = [];
  if (crore) parts.push(`${three(crore)} Crore`);
  if (lakh) parts.push(`${three(lakh)} Lakh`);
  if (thousand) parts.push(`${three(thousand)} Thousand`);
  if (n) parts.push(three(n));
  return parts.join(" ");
}

export default function ChequePrint() {
  const { cid } = useParams();
  const { company } = useCompany();
  const [selected, setSelected] = useState<any | null>(null);
  const [bankName, setBankName] = useState("");

  const { data: cheques } = useQuery({ queryKey: ["cheque-register", cid], queryFn: () => get<any[]>(`/api/c/${cid}/cheque-register`) });

  useEffect(() => {
    if (selected && !bankName) setBankName(selected.bankLedger ?? "");
  }, [selected, bankName]);



  const doPrint = () => window.print();

  return (
    <Shell title="Cheque Printing" breadcrumb={[{ label: "Gateway", to: `/company/${cid}` }, { label: "Cheque Printing" }]}>
      <div className="hidden print:block fixed inset-0 bg-white p-8">
        {selected && <ChequeFace company={company?.name ?? ""} bankName={bankName} cheque={selected} />}
      </div>

      <div className="print:hidden">
        <PageHead
          title="Cheque Printing"
          sub="Pick a recorded cheque to print on your bank's cheque leaf"
          actions={<button className="btn-primary" disabled={!selected} onClick={doPrint}>Print Cheque</button>}
        />
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <Card>
            <table className="report-table">
              <thead><tr><th className="w-24">Date</th><th className="w-24">Chq No.</th><th>Bank / Narration</th><th className="w-28 text-right">Amount</th><th className="w-16"></th></tr></thead>
              <tbody>
                {(cheques ?? []).map((c: any, i: number) => (
                  <tr key={i} className="row-link">
                    <td className="cell-nowrap">{fmtDate(c.date)}</td>
                    <td className="font-mono">{c.chequeNumber}</td>
                    <td className="text-slate-500 min-w-[180px] [overflow-wrap:anywhere]">{c.bankLedger} · {c.narration}</td>
                    <td className="num">{c.amount.toLocaleString("en-IN")}</td>
                    <td><button className="text-indigo-600 text-sm hover:underline" onClick={() => setSelected(c)}>Print</button></td>
                  </tr>
                ))}
                {(cheques ?? []).length === 0 && (
                  <tr><td colSpan={5} className="text-center text-slate-400 py-6">No cheques yet — record cheque numbers on Payment vouchers</td></tr>
                )}
              </tbody>
            </table>
          </Card>
          {selected && (
            <Card className="p-5">
              <div className="text-sm font-semibold mb-2.5">Preview</div>
              <ChequeFace company={company?.name ?? ""} bankName={bankName} cheque={selected} />
              <label className="block mt-4">
                <span className="text-xs text-slate-600">Bank name on cheque</span>
                <input className="w-full mt-1" value={bankName} onChange={(e) => setBankName(e.target.value)} />
              </label>
              <p className="text-xs text-slate-500 mt-2.5 leading-relaxed">Print on a real cheque leaf; align using your printer's envelope/cheque settings.</p>
            </Card>
          )}
        </div>
      </div>
    </Shell>
  );
}

function ChequeFace({ company, bankName, cheque }: { company: string; bankName: string; cheque: any }) {
  const amt = num(cheque.amount);
  const payee = (cheque.narration || "").replace(/^Being\s*/i, "").trim() || company;
  return (
    <div className="border-2 border-slate-800 rounded-lg p-4 w-[660px] bg-white text-slate-900 relative">
      <div className="flex justify-between text-[12px]">
        <div>
          <div className="font-bold text-[14px]">{bankName || "BANK"}</div>
          <div className="text-slate-500">Branch: ______________</div>
        </div>
        <div className="text-right">
          <div className="font-mono text-[13px]">Cheque No. {cheque.chequeNumber}</div>
          <div>{fmtDate(cheque.chequeDate || cheque.date)}</div>
        </div>
      </div>
      <div className="mt-3 text-[13px]">Pay <b>{payee}</b> or order the sum of</div>
      <div className="mt-1 border-b border-slate-800 pb-1 text-[13px]">Rupees <b>{words(Math.floor(amt))}</b>{amt % 1 ? ` and ${Math.round((amt % 1) * 100)} Paise` : ""} Only</div>
      <div className="mt-3 flex items-end justify-between">
        <div className="text-[12px]">₹ <span className="font-mono text-[15px]">{amt.toLocaleString("en-IN")}</span></div>
        <div className="text-[12px]">A/c Payee <span className="inline-block border border-slate-400 rounded px-1 py-0.5 text-[10px] ml-1">A/C PAYEE ONLY</span></div>
        <div className="text-right text-[11px] text-slate-500">
          <div>{company}</div>
          <div>Authorised Signatory</div>
        </div>
      </div>
    </div>
  );
}
