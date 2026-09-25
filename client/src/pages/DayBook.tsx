import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Shell, { FKeyButton } from "../components/Shell";
import { Card, ErrorBanner, PageHead } from "../components/ui";
import { get, del, cancelVoucher, uncancelVoucher } from "../lib/api";
import { useHotkeys } from "../lib/hotkeys";
import { num, today, fmtDate, fyStart, fyEnd, fyEndFromBegin, loadSessionPeriod } from "../lib/format";
import { useCompanyPeriod } from "../lib/period";
import { voucherKeyRank } from "../lib/gatewayMenu";
import { useCompany } from "../store";

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
  const { company } = useCompany();
  // R-56: default window = the session current period (Alt+F2, per company)
  // when set, else the company's STORED financial year (not hardcoded April —
  // F1 fix). A user change to the date inputs overrides both for the page.
  const session = loadSessionPeriod(cid);
  const { from, to, setFrom, setTo } = useCompanyPeriod(company, session);
  const [type, setType] = useState("");
  const [error, setError] = useState("");
  // R-56: one-shot amber surface for the server's date-window advisories
  // (pre-books-begin / future date). Set by VoucherScreen on save via
  // sessionStorage; shown here once, then cleared. Nothing blocks — the
  // voucher is already in the books.
  const [voucherWarn, setVoucherWarn] = useState<string[]>(() => {
    try {
      const raw = sessionStorage.getItem("zprime_voucher_warnings_last");
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  useEffect(() => {
    if (voucherWarn.length) {
      sessionStorage.removeItem("zprime_voucher_warnings_last");
      const t = setTimeout(() => setVoucherWarn([]), 15000);
      return () => clearTimeout(t);
    }
  }, [voucherWarn]);

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

  // R-65: the voucher map + rail are DATA-DRIVEN from the seeded types
  // (same pattern as the Gateway; R-64's global layer remains the floor).
  // The old hand-maintained list had drifted: F10 (Manufacturing Journal)
  // was missing — it only worked here via the global layer since v1.55.0,
  // and the rail never showed it. Order = shortcut class (voucherKeyRank).
  const fkeyMap = useMemo(() => {
    const m: Record<string, () => void> = {};
    const sorted = [...acctTypes].sort((a: any, b: any) => voucherKeyRank(a.functionKey) - voucherKeyRank(b.functionKey));
    for (const v of sorted) {
      const fk = (v.functionKey ?? "").trim();
      if (!fk || m[fk]) continue; // first type wins; duplicates ignored
      m[fk] = () => nav(`/company/${cid}/voucher/${v.id}/new`);
    }
    return m;
  }, [acctTypes, cid, nav]);

  useHotkeys({
    // R-53c: F2 = date/period (Tally); Esc-back is owned by Shell.
    F2: () => (document.querySelector('input[type="date"]') as HTMLInputElement | null)?.focus(),
    ...fkeyMap,
  }, [fkeyMap, byName, cid]);

  const fkeys: FKeyButton[] = useMemo(
    () =>
      Object.entries(fkeyMap).map(([key, onClick]) => ({
        key,
        label: acctTypes.find((v: any) => (v.functionKey ?? "").trim() === key)?.name ?? "",
        onClick,
      })),
    [fkeyMap, acctTypes]
  );

  return (
    <Shell title="Day Book" breadcrumb={[{ label: "Gateway", to: `/company/${cid}` }, { label: "Day Book" }]} fkeys={fkeys}>
      <PageHead
        title="Day Book"
        sub="Enter Enter on a voucher row to alter it"
        actions={
          <div className="flex items-center gap-2.5 flex-wrap justify-end">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span className="text-slate-400 text-sm">to</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">All types</option>
              {acctTypes.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        }
      />
      <ErrorBanner error={error} />
      {voucherWarn.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-sm px-4 py-2.5 leading-relaxed">
          {voucherWarn.map((w, i) => (<div key={i}>⚠ {w}</div>))}
        </div>
      )}

      <Card>
        <table className="report-table">
          <thead>
            <tr>
              <th className="w-24">Date</th>
              <th>Type</th>
              <th className="w-24">Vch No.</th>
              <th>Party / Ledger</th>
              <th className="w-32 text-right">Amount</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((v) => (
              <tr key={v.id} className={`row-link ${v.isCancelled ? "opacity-60" : ""}`} onClick={() => nav(`/company/${cid}/voucher/${v.id}/edit`)}>
                <td className="cell-nowrap">{fmtDate(v.date)}</td>
                <td className="cell-nowrap">
                  <span
                    className={`pill ${TYPE_COLORS[v.typeName] ?? "bg-slate-100 text-slate-600"}`}
                    title={[
                      v.createdByUsername ? `Posted by ${v.createdByUsername}` : null,
                      v.updatedByUsername && v.updatedByUsername !== v.createdByUsername ? `Last edited by ${v.updatedByUsername}` : null,
                    ].filter(Boolean).join(" · ") || undefined}
                  >
                    {v.typeName}
                  </span>
                  {v.isCancelled && (
                    <span className="pill ml-1.5 font-semibold bg-red-100 text-red-700" title="Cancelled — effects inactive; uncancel to restore">
                      Cancelled
                    </span>
                  )}
                  {v.isRcm && (
                    <span className="pill ml-1.5 font-semibold bg-amber-100 text-amber-700" title="Reverse charge — recipient self-accounted the GST (3B Table 4(A)(3))">
                      RCM
                    </span>
                  )}
                </td>
                <td className="font-medium cell-nowrap">{v.number}</td>
                <td className="text-slate-600 min-w-[200px] leading-snug">{v.partyName ?? v.narration}</td>
                <td className="num">{num(v.amount).toLocaleString("en-IN")}</td>
                <td className="text-right whitespace-nowrap">
                  {v.isCancelled ? (
                    <>
                      <button className="text-emerald-600 text-sm hover:underline mr-3" onClick={(e) => { e.preventDefault(); e.stopPropagation(); uncancel(v); }}>Uncancel</button>
                    </>
                  ) : (
                    <>
                      <Link to={`/company/${cid}/voucher/${v.id}/edit`} className="text-indigo-600 text-sm hover:underline mr-3">Alter</Link>
                      <button className="text-amber-600 text-sm hover:underline mr-3" onClick={(e) => { e.preventDefault(); e.stopPropagation(); cancel(v); }}>Cancel</button>
                      <button className="text-red-500 text-sm hover:underline" onClick={(e) => { e.preventDefault(); e.stopPropagation(); remove(v); }}>Del</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {rows && rows.length === 0 && (
              <tr><td colSpan={6} className="text-center text-slate-400 py-10 text-sm">
                {isLoading ? "Loading…" : "No vouchers in this period — press F8 for a new Sales voucher"}
              </td></tr>
            )}
          </tbody>
        </table>
      </Card>
      <p className="mt-3 text-xs text-slate-400">FY: {company?.financialYearStart ?? ""} → {company ? fyEndFromBegin(company.financialYearStart) : ""} · Esc returns to Gateway</p>
    </Shell>
  );
}
