import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Shell from "../components/Shell";
import { Card, ErrorBanner, PageHead } from "../components/ui";
import { get, post } from "../lib/api";
import { useHotkeys } from "../lib/hotkeys";
import { num, monthLabel, today } from "../lib/format";

export default function PayrollProcess() {
  const { cid } = useParams();
  const qc = useQueryClient();
  const [month, setMonth] = useState(today().slice(0, 7));
  const [error, setError] = useState("");
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const { data: employees } = useQuery({ queryKey: ["employees", cid], queryFn: () => get<any[]>(`/api/c/${cid}/employees`) });
  const { data: payHeads } = useQuery({ queryKey: ["pay-heads", cid], queryFn: () => get<any[]>(`/api/c/${cid}/pay-heads`) });
  const { data: history } = useQuery({ queryKey: ["salary-register", cid], queryFn: () => get<any[]>(`/api/c/${cid}/reports/salary-register`) });

  const process = async () => {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const res = await post(`/api/c/${cid}/payroll/process`, { month });
      setResult(res);
      qc.invalidateQueries({ queryKey: ["salary-register", cid] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payroll failed");
    } finally {
      setBusy(false);
    }
  };

  useHotkeys({ Escape: () => window.history.back() }, []);

  return (
    <Shell title="Process Payroll" breadcrumb={[{ label: "Gateway", to: `/company/${cid}` }, { label: "Process Payroll" }]}>
      <PageHead
        title="Payroll"
        sub="Set up pay heads and salary structures under Masters, then process monthly vouchers"
        actions={
          <div className="flex items-center gap-2">
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            <button className="btn-primary" disabled={busy} onClick={process}>{busy ? "Processing…" : `Process ${monthLabel(month)}`}</button>
          </div>
        }
      />
      <ErrorBanner error={error} />
      {result && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 text-green-800 text-sm px-4 py-2.5">
          Payroll posted for {monthLabel(month)} — {result.employees} employees, net ₹{num(result.total).toLocaleString("en-IN")} (voucher #{result.voucherId}).
          View it in the <b>Salary Register</b> report.
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Card className="p-5">
          <div className="text-sm font-semibold mb-2.5">Setup summary</div>
          <div className="text-sm text-slate-600 space-y-1.5">
            <div>Active employees: <b>{(employees ?? []).filter((e) => e.isActive).length}</b></div>
            <div>Pay heads defined: <b>{(payHeads ?? []).length}</b></div>
            <div className="text-xs text-slate-500 leading-relaxed mt-2.5">
              Each earning head posts to its ledger (Cr), deductions (Dr), and the net amount to <b>Salary Payable</b>.
              Create ledgers like “Salaries & Wages” (Indirect Expenses) and “PF Payable” (Current Liabilities) first.
            </div>
          </div>
        </Card>
        <Card>
          <div className="px-4 py-3 border-b border-slate-100 text-sm font-semibold">Recent payslips</div>
          <table className="report-table">
            <thead><tr><th>Month</th><th>Employee</th><th className="text-right">Net</th></tr></thead>
            <tbody>
              {(history ?? []).slice(0, 12).map((p: any) => (
                <tr key={p.id}><td>{monthLabel(p.month)}</td><td>{p.employeeName}</td><td className="num">{num(p.net).toLocaleString("en-IN")}</td></tr>
              ))}
              {(history ?? []).length === 0 && <tr><td colSpan={3} className="text-center text-slate-400 py-5">Nothing processed yet</td></tr>}
            </tbody>
          </table>
        </Card>
      </div>
    </Shell>
  );
}
