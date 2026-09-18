import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Shell, { FKeyButton } from "../components/Shell";
import { Card, ErrorBanner, PageHead } from "../components/ui";
import { get, del, cancelVoucher, uncancelVoucher } from "../lib/api";
import { useHotkeys } from "../lib/hotkeys";
import { num, today, fmtDate, fyStart, fyEnd } from "../lib/format";

const TYPE_COLORS: Record<string, string> = {
  Sales: "bg-green-100 text-green-700",
  Purchase: "bg-orange-100 text-orange-700",
  Payment: "bg-red-100 text-red-600",
  Receipt: "bg-blue-100 text-blue-700",
  Journal: "bg-slate-200 text-slate-600",
  Contra: "bg-violet-100 text-violet-700",
  "Credit Note": "bg-teal-100 text-teal-700",
  "Debit Note": "bg-amber-100 text-amber-700",
};

export default function DayBook() {
  const { cid } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [from, setFrom] = useState(fyStart(today()));
  const [to, setTo] = useState(today());
  const [type, setType] = useState("");
  const [error, setError] = useState("");

  const { data: voucherTypes } = useQuery({ queryKey: ["voucher-types", cid], queryFn: () => get<any[]>(`/api/c/${cid}/voucher-types`) });
  const { data: rows, isLoading } = useQuery({
    queryKey: ["daybook", cid, from, to, type],
    queryFn: () => get<any[]>(`/api/c/${cid}/vouchers?from=${from}&to=${to}${type ? `&type=${type}` : ""}`),
  });

  const acctTypes = useMemo(() => (voucherTypes ?? []).filter((v: any) => v.category !== "Payroll"), [voucherTypes]);
  const byName = useMemo(() => {
    const m = new Map<string, any>();
    for (const v of acctTypes) m.set(v.name, v);
    return m;
  }, [acctTypes]);

  const open = (name: string) => {
    const t = byName.get(name);
    if (t) nav(`/company/${cid}/voucher/${t.id}/new`);
  };

  const remove = async (row: any) => {
    if (!confirm(`Delete voucher ${row.typeName} ${row.number} dated ${fmtDate(row.date)}?`)) return;
    try {
      await del(`/api/c/${cid}/vouchers/${row.id}`);
      qc.invalidateQueries({ queryKey: ["daybook"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  // R-02 voucher cancellation: preserves the voucher, its number and its body
  // rows; active reports exclude it while cancelled. Optional reason.
  const cancel = async (row: any) => {
    const reason = prompt(`Cancel voucher ${row.typeName} ${row.number}? Its accounting, inventory and GST effects become inactive. Optional reason:`, "");
    if (reason === null) return; // user aborted the confirm dialog
    try {
      await cancelVoucher(cid!, row.id, reason.trim() || undefined);
      qc.invalidateQueries({ queryKey: ["daybook"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel failed");
    }
  };

  const uncancel = async (row: any) => {
    if (!confirm(`Uncancel (restore) voucher ${row.typeName} ${row.number}? Its effects become active again.`)) return;
    try {
      await uncancelVoucher(cid!, row.id);
      qc.invalidateQueries({ queryKey: ["daybook"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Uncancel failed");
    }
  };

  useHotkeys({
    Escape: () => nav(`/company/${cid}`),
    F5: () => open("Payment"),
    F8: () => open("Sales"),
    F9: () => open("Purchase"),
    F4: () => open("Contra"),
    F6: () => open("Receipt"),
    F7: () => open("Journal"),
  }, [byName, cid]);

  const fkeys: FKeyButton[] = [
    { key: "F4", label: "Contra", onClick: () => open("Contra") },
    { key: "F5", label: "Payment", onClick: () => open("Payment") },
    { key: "F6", label: "Receipt", onClick: () => open("Receipt") },
    { key: "F7", label: "Journal", onClick: () => open("Journal") },
    { key: "F8", label: "Sales", onClick: () => open("Sales") },
    { key: "F9", label: "Purchase", onClick: () => open("Purchase") },
    { key: "Alt+F5", label: "Debit Note", onClick: () => open("Debit Note") },
    { key: "Alt+F6", label: "Credit Note", onClick: () => open("Credit Note") },
    { key: "Alt+F7", label: "Stock Journal", onClick: () => open("Stock Journal") },
    { key: "Alt+F8", label: "Delivery Note", onClick: () => open("Delivery Note") },
    { key: "Alt+F9", label: "Receipt Note", onClick: () => open("Receipt Note") },
    { key: "Ctrl+F7", label: "Physical Stock", onClick: () => open("Physical Stock") },
  ];

  return (
    <Shell title="Day Book" breadcrumb={[{ label: "Gateway", to: `/company/${cid}` }, { label: "Day Book" }]} fkeys={fkeys}>
      <PageHead
        title="Day Book"
        sub="Enter Enter on a voucher row to alter it"
        actions={
          <div className="flex items-center gap-2">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span className="text-slate-400 text-[12px]">to</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">All types</option>
              {acctTypes.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        }
      />
      <ErrorBanner error={error} />

      <Card>
        <table className="report-table">
          <thead>
            <tr>
              <th className="w-24">Date</th>
              <th className="w-28">Type</th>
              <th className="w-24">Vch No.</th>
              <th>Party / Ledger</th>
              <th className="w-32 text-right">Amount</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((v) => (
              <tr key={v.id} className={`row-link ${v.isCancelled ? "opacity-60" : ""}`}>
                <td>{fmtDate(v.date)}</td>
                <td>
                  <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${TYPE_COLORS[v.typeName] ?? "bg-slate-100 text-slate-600"}`}>
                    {v.typeName}
                  </span>
                  {v.isCancelled && (
                    <span className="ml-1 px-1.5 py-0.5 rounded text-[11px] font-semibold bg-red-100 text-red-700" title="Cancelled — effects inactive; uncancel to restore">
                      Cancelled
                    </span>
                  )}
                  {v.isRcm && (
                    <span className="ml-1 px-1.5 py-0.5 rounded text-[11px] font-semibold bg-amber-100 text-amber-700" title="Reverse charge — recipient self-accounted the GST (3B Table 4(A)(3))">
                      RCM
                    </span>
                  )}
                </td>
                <td className="font-medium">{v.number}</td>
                <td className="text-slate-600 truncate max-w-[300px]">{v.partyName ?? v.narration}</td>
                <td className="num">{num(v.amount).toLocaleString("en-IN")}</td>
                <td className="text-right whitespace-nowrap">
                  {v.isCancelled ? (
                    <>
                      <button className="text-emerald-600 text-[12px] hover:underline mr-2" onClick={(e) => { e.preventDefault(); uncancel(v); }}>Uncancel</button>
                    </>
                  ) : (
                    <>
                      <Link to={`/company/${cid}/voucher/${v.id}/edit`} className="text-indigo-600 text-[12px] hover:underline mr-2">Alter</Link>
                      <button className="text-amber-600 text-[12px] hover:underline mr-2" onClick={(e) => { e.preventDefault(); cancel(v); }}>Cancel</button>
                      <button className="text-red-500 text-[12px] hover:underline" onClick={(e) => { e.preventDefault(); remove(v); }}>Del</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {rows && rows.length === 0 && (
              <tr><td colSpan={6} className="text-center text-slate-400 py-6">
                {isLoading ? "Loading…" : "No vouchers in this period — press F8 for a new Sales voucher"}
              </td></tr>
            )}
          </tbody>
        </table>
      </Card>
      <p className="mt-2 text-[11px] text-slate-400">FY: {fyStart(today())} → {fyEnd(today())} · Esc returns to Gateway</p>
    </Shell>
  );
}
