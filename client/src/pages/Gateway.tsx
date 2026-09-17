import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Shell from "../components/Shell";
import { useCompany } from "../store";
import { get } from "../lib/api";
import { useHotkeys } from "../lib/hotkeys";
import { today, fyStart, fyEnd } from "../lib/format";

interface VoucherTypeRow { id: number; name: string; category: string; functionKey: string | null; }

interface MenuItem { label: string; to: string; hint?: string; }
interface MenuSection { title: string; items: MenuItem[]; }

export default function Gateway() {
  const { cid } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { company } = useCompany();
  const { data: voucherTypes } = useQuery({
    queryKey: ["voucher-types", cid],
    queryFn: () => get<VoucherTypeRow[]>(`/api/c/${cid}/voucher-types`),
  });
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => get<{ username: string }>("/api/auth/me") });
  // R-14: TB health line — silent-degrade (renders nothing on error/absence),
  // same data the Trial Balance report already computes.
  const { data: tbHealth } = useQuery({
    queryKey: ["tb-health", cid],
    queryFn: () => get<{ totalDebit: number; totalCredit: number; difference: number }>(`/api/c/${cid}/reports/trial-balance`),
    retry: false,
  });

  const fyFrom = company ? fyStart(today()) : "";
  const fyTo = company ? fyEnd(today()) : "";

  const acct = useMemo(
    () => (voucherTypes ?? []).filter((v) => v.category === "Accounting" || v.category === "Inventory"),
    [voucherTypes]
  );

  const sections: MenuSection[] = [
    {
      title: "Masters",
      items: [
        { label: "Ledgers", to: `/company/${cid}/masters/ledgers`, hint: "Create / alter ledger accounts" },
        { label: "Groups", to: `/company/${cid}/masters/groups`, hint: "Account groups (28 pre-defined)" },
        { label: "Stock Items", to: `/company/${cid}/masters/stock-items`, hint: "Inventory items" },
        { label: "Units of Measure", to: `/company/${cid}/masters/units` },
        { label: "Stock Groups", to: `/company/${cid}/masters/stock-groups` },
        { label: "Godowns / Locations", to: `/company/${cid}/masters/godowns` },
        { label: "Voucher Types", to: `/company/${cid}/masters/voucher-types` },
        { label: "TDS Sections", to: `/company/${cid}/masters/tds-sections` },
        { label: "Employees & Payroll", to: `/company/${cid}/masters/employees` },
      ],
    },
    {
      title: "Transactions",
      items: [
        { label: "Day Book", to: `/company/${cid}/daybook`, hint: "All vouchers by date" },
        ...acct.map((v) => ({ label: v.name, to: `/company/${cid}/voucher/${v.id}/new`, hint: v.functionKey ?? "" })),
        { label: "Process Payroll", to: `/company/${cid}/payroll`, hint: "Monthly salary vouchers" },
      ],
    },
    {
      title: "Reports",
      items: [
        { label: "Balance Sheet", to: `/company/${cid}/reports/balance-sheet` },
        { label: "Profit & Loss A/c", to: `/company/${cid}/reports/profit-loss` },
        { label: "Trial Balance", to: `/company/${cid}/reports/trial-balance` },
        { label: "Cash / Bank Book", to: `/company/${cid}/reports/cash-bank` },
        { label: "Sales Register", to: `/company/${cid}/reports/register-sales` },
        { label: "Purchase Register", to: `/company/${cid}/reports/register-purchase` },
        { label: "Stock Summary", to: `/company/${cid}/reports/stock-summary` },
        { label: "Receivables (B/R)", to: `/company/${cid}/reports/receivables` },
        { label: "Payables (B/P)", to: `/company/${cid}/reports/payables` },
        { label: "GSTR-1", to: `/company/${cid}/reports/gstr1` },
        { label: "GSTR-3B", to: `/company/${cid}/reports/gstr3b` },
        { label: "TDS Report", to: `/company/${cid}/reports/tds` },
        { label: "Salary Register", to: `/company/${cid}/reports/salary-register` },
        { label: "Cheque Register", to: `/company/${cid}/reports/cheque-register` },
      ],
    },
    {
      title: "Utilities",
      items: [
        { label: "XML Import", to: `/company/${cid}/import`, hint: "Masters + vouchers" },
        { label: "Cheque Printing", to: `/company/${cid}/cheques` },
        { label: "Company Settings", to: `/company/${cid}/settings` },
      ],
    },
  ];

  const f5 = acct.find((v) => v.name === "Payment");
  const f8 = acct.find((v) => v.name === "Sales");
  const f9 = acct.find((v) => v.name === "Purchase");

  useHotkeys({
    F2: () => nav(`/company/${cid}/daybook`),
    F5: () => f5 && nav(`/company/${cid}/voucher/${f5.id}/new`),
    F8: () => f8 && nav(`/company/${cid}/voucher/${f8.id}/new`),
    F9: () => f9 && nav(`/company/${cid}/voucher/${f9.id}/new`),
  }, [cid, acct]);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    window.location.href = "/login";
  };

  return (
    <Shell
      title="Gateway"
      fkeys={[
        { key: "F2", label: "Day Book", onClick: () => nav(`/company/${cid}/daybook`) },
        ...(f5 ? [{ key: "F5", label: "Payment", onClick: () => nav(`/company/${cid}/voucher/${f5.id}/new`) }] : []),
        ...(f8 ? [{ key: "F8", label: "Sales", onClick: () => nav(`/company/${cid}/voucher/${f8.id}/new`) }] : []),
        ...(f9 ? [{ key: "F9", label: "Purchase", onClick: () => nav(`/company/${cid}/voucher/${f9.id}/new`) }] : []),
      ]}
    >
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sections.map((s) => (
            <div key={s.title} className="bg-white rounded-lg shadow-sm border border-slate-200">
              <div className="px-3 py-2 border-b border-slate-100 text-[12px] font-semibold uppercase tracking-wide text-indigo-600">
                {s.title}
              </div>
              <ul className="p-1.5">
                {s.items.map((it) => (
                  <li key={it.label}>
                    <Link
                      to={it.to}
                      className="flex items-center gap-2 px-2 py-1.5 rounded text-[13px] text-slate-700 hover:bg-indigo-50 hover:text-indigo-800"
                    >
                      <span className="flex-1">{it.label}</span>
                      {it.hint && <span className="fkey-chip">{it.hint}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <aside className="space-y-4">
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
            <div className="text-[12px] uppercase tracking-wide text-slate-400 font-semibold mb-2">Company</div>
            <div className="text-[15px] font-semibold text-slate-800">{company?.name ?? "…"}</div>
            <div className="text-[12px] text-slate-500 mt-1 space-y-0.5">
              {company?.gstin && <div>GSTIN: {company.gstin}</div>}
              {company?.state && <div>State: {company.state}</div>}
              <div>Current FY: {fyFrom} → {fyTo}</div>
            </div>
          </div>
          {tbHealth && (
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
              <div className="text-[12px] uppercase tracking-wide text-slate-400 font-semibold mb-2">Books Health</div>
              {Math.abs(tbHealth.difference ?? 0) <= 0.004 ? (
                <div className="text-[13px] text-green-700 font-medium">Trial Balance ✓ balanced</div>
              ) : (
                <div className="text-[13px] text-amber-700 font-medium">
                  Trial Balance ✗ out by {Math.abs(tbHealth.difference).toLocaleString("en-IN")}
                  <Link to={`/company/${cid}/reports/trial-balance`} className="ml-1 text-indigo-600 hover:underline font-normal">view</Link>
                </div>
              )}
            </div>
          )}
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
            <div className="text-[12px] uppercase tracking-wide text-slate-400 font-semibold mb-2">Shortcuts</div>
            <ul className="text-[12px] text-slate-600 space-y-1.5">
              <li><span className="fkey-chip">F2</span> change / open Day Book</li>
              <li><span className="fkey-chip">F5/F8/F9</span> Payment / Sales / Purchase</li>
              <li><span className="fkey-chip">Ctrl+A</span> accept (save) voucher</li>
              <li><span className="fkey-chip">Alt+F1</span> detailed / condensed</li>
              <li><span className="fkey-chip">Esc</span> back / cancel</li>
            </ul>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 text-[12px] text-slate-500">
            Signed in as <span className="font-medium text-slate-700">{me?.username}</span>
            <button onClick={logout} className="block mt-2 text-indigo-600 hover:underline">Logout</button>
          </div>
        </aside>
      </div>
    </Shell>
  );
}
