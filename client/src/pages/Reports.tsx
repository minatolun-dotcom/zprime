import { useEffect, useMemo, useState } from "react";
import { Fragment } from "react";
import { useLocation } from "react-router-dom";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Shell, { FKeyButton } from "../components/Shell";
import { Card, ErrorBanner } from "../components/ui";
import { get } from "../lib/api";
import { useCompany } from "../store";
import { useHotkeys } from "../lib/hotkeys";
import { num, r2, today, fmtDate, fyStart, fyEnd, monthLabel } from "../lib/format";
import { csvDownload } from "../lib/csv";

export default function Reports() {
  const { cid, key } = useParams();
  const nav = useNavigate();
  const location = useLocation();
  const { company } = useCompany();
  const [from, setFrom] = useState(fyStart(today()));
  const [to, setTo] = useState(today());
  const [detailed, setDetailed] = useState(true);
  const [ledgerId, setLedgerId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [itemId, setItemId] = useState("");

  // Drill-down navigation targets (from other reports)
  useEffect(() => {
    const st: any = location.state ?? {};
    if (st.groupId) setGroupId(String(st.groupId));
    if (st.ledgerId) setLedgerId(String(st.ledgerId));
    if (st.itemId) setItemId(String(st.itemId));
  }, [location.state]);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (key !== "balance-sheet") { p.set("from", from); }
    p.set("to", to);
    if (key === "register-sales") p.set("typeName", "Sales");
    if (key === "register-purchase") p.set("typeName", "Purchase");
    if (key === "stock-summary" && itemId) p.set("itemId", itemId);
    return p.toString();
  }, [from, to, key, itemId]);

  const url = useMemo(() => {
    const endpoint = ENDPOINTS[key ?? ""] ?? "";
    if (!endpoint) return null;
    if (key === "ledger-vouchers" && ledgerId) return `/api/c/${cid}/reports/ledger-vouchers/${ledgerId}?${qs}`;
    if (key === "group-summary" && groupId) return `/api/c/${cid}/reports/group-summary/${groupId}?${qs}`;
    return `/api/c/${cid}/reports/${endpoint}?${qs}`;
  }, [key, cid, qs, ledgerId, groupId]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["report", key, cid, url],
    queryFn: () => get<any>(url!),
    enabled: Boolean(url),
  });

  const { data: ledgers } = useQuery({ queryKey: ["all-ledgers", cid], queryFn: () => get<any[]>(`/api/c/${cid}/ledgers`), enabled: key === "ledger-vouchers" });
  const { data: items } = useQuery({ queryKey: ["all-items", cid], queryFn: () => get<any[]>(`/api/c/${cid}/stock-items`), enabled: key === "stock-summary" });

  useHotkeys({
    Escape: () => nav(`/company/${cid}`),
    "Alt+F1": () => setDetailed(!detailed),
  }, [cid]);

  const fkeys: FKeyButton[] = [
    { key: "Alt+F1", label: detailed ? "Condensed" : "Detailed", onClick: () => setDetailed(!detailed) },
    { key: "Esc", label: "Back to Gateway", onClick: () => nav(`/company/${cid}`) },
  ];

  const title = TITLES[key ?? ""] ?? "Report";

  return (
    <Shell title={title} breadcrumb={[{ label: "Gateway", to: `/company/${cid}` }, { label: "Reports" }, { label: title }]} fkeys={fkeys} wide>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {key !== "balance-sheet" && (
          <>
            <span className="text-[12px] text-slate-500">Period</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span className="text-slate-400 text-[12px]">to</span>
          </>
        )}
        <span className="text-[12px] text-slate-500">{key === "balance-sheet" ? "as on" : "to"}</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />

        {key === "ledger-vouchers" && (
          <select value={ledgerId} onChange={(e) => setLedgerId(e.target.value)}>
            <option value="">— Select ledger —</option>
            {(ledgers ?? []).map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        )}
        {key === "group-summary" && <GroupPicker cid={cid!} value={groupId} onChange={setGroupId} />}
        {key === "stock-summary" && (
          <select value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">All items</option>
            {(items ?? []).map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        )}
        <span className="flex-1" />
        {key === "register-sales" && <Link to={`/company/${cid}/reports/register-purchase`} className="text-[12px] text-indigo-600 hover:underline">Purchase Register →</Link>}
        {key === "register-purchase" && <Link to={`/company/${cid}/reports/register-sales`} className="text-[12px] text-indigo-600 hover:underline">Sales Register →</Link>}
      </div>

      <ErrorBanner error={error} />
      {isLoading && <div className="text-slate-400 text-[13px]">Computing…</div>}

      {key === "balance-sheet" && data && <BalanceSheetView cid={cid!} data={data} detailed={detailed} />}
      {key === "profit-loss" && data && <PnlView cid={cid!} data={data} detailed={detailed} />}
      {key === "trial-balance" && data && <TrialBalanceView cid={cid!} data={data} onCsv={(h, r) => csvDownload("trial-balance", h, r)} />}
      {key === "ledger-vouchers" && data && <LedgerVouchersView data={data} />}
      {key === "group-summary" && data && <GroupSummaryView data={data} detailed={detailed} />}
      {key === "cash-bank" && data && <CashBankView cid={cid!} data={data} />}
      {(key === "register-sales" || key === "register-purchase") && data && (
        <RegisterView cid={cid!} data={data} onCsv={(h, r) => csvDownload(key, h, r)} />
      )}
      {key === "stock-summary" && data && <StockSummaryView data={data} single={Boolean(itemId)} />}
      {key === "receivables" && data && <OutstandingView data={data} title="Bills Receivable" />}
      {key === "payables" && data && <OutstandingView data={data} title="Bills Payable" />}
      {key === "gstr1" && data && <Gstr1View data={data} />}
      {key === "gstr3b" && data && <Gstr3bView data={data} />}
      {key === "tds" && data && <TdsView data={data} />}
      {key === "salary-register" && data && <SalaryRegisterView data={data} />}
      {key === "cheque-register" && data && <ChequeRegisterView data={data} />}
    </Shell>
  );
}

// ---------- shared bits ----------

function GroupPicker({ cid, value, onChange }: { cid: string; value: string; onChange: (v: string) => void }) {
  const { data: groups } = useQuery({ queryKey: ["groups", cid], queryFn: () => get<any[]>(`/api/c/${cid}/groups`) });
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— Select group —</option>
      {(groups ?? []).map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
    </select>
  );
}

function TreeRows({ nodes, onClick, level = 0 }: { nodes: any[]; onClick?: (n: any) => void; level?: number }) {
  return (
    <>
      {nodes.map((n) => {
        const isLeafGroup = (n.children ?? []).length === 0;
        return (
          <Fragment key={n.id}>
            <tr className={onClick ? "row-link" : ""} onClick={() => onClick?.(n)}>
              <td style={{ paddingLeft: `${8 + level * 16}px` }} className={level === 0 ? "font-semibold text-slate-800" : "text-slate-700"}>
                {n.name}
              </td>
              <td className="num">{n.closing >= 0 ? n.closing.toLocaleString("en-IN") : ""}</td>
              <td className="num">{n.closing < 0 ? Math.abs(n.closing).toLocaleString("en-IN") : ""}</td>
            </tr>
            {!isLeafGroup && <TreeRows nodes={n.children} onClick={onClick} level={level + 1} />}
          </Fragment>
        );
      })}
    </>
  );
}

// ---------- Balance Sheet ----------

function BalanceSheetView({ cid, data, detailed }: { cid: string; data: any; detailed: boolean }) {
  const nav = useNavigate();
  const openGroup = (id: number) => nav(`/company/${cid}/reports/group-summary`, { state: { groupId: id } });
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <Card className="p-0 overflow-hidden">
        <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-[13px] font-semibold text-slate-700">Liabilities</div>
        <table className="report-table">
          <thead><tr><th>Particulars</th><th className="w-32 text-right">Debit</th><th className="w-32 text-right">Credit</th></tr></thead>
          <tbody>
            <TreeRows nodes={data.liabilities} onClick={detailed ? (n) => openGroup(n.id) : undefined} />
            {data.profitLine && (
              <tr className="bg-indigo-50/50">
                <td className="font-medium text-indigo-700">Profit & Loss A/c</td>
                <td className="num">{data.netProfit < 0 ? Math.abs(data.netProfit).toLocaleString("en-IN") : ""}</td>
                <td className="num">{data.netProfit >= 0 ? data.netProfit.toLocaleString("en-IN") : ""}</td>
              </tr>
            )}
            <tr className="font-bold border-t-2 border-slate-300">
              <td>Total</td><td className="num" /><td className="num">{data.totalLiabilities.toLocaleString("en-IN")}</td>
            </tr>
          </tbody>
        </table>
      </Card>
      <Card className="p-0 overflow-hidden">
        <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-[13px] font-semibold text-slate-700">Assets</div>
        <table className="report-table">
          <thead><tr><th>Particulars</th><th className="w-32 text-right">Debit</th><th className="w-32 text-right">Credit</th></tr></thead>
          <tbody>
            <TreeRows nodes={data.assets} onClick={detailed ? (n) => openGroup(n.id) : undefined} />
            <tr className="font-bold border-t-2 border-slate-300">
              <td>Total</td><td className="num">{data.totalAssets.toLocaleString("en-IN")}</td><td className="num" />
            </tr>
          </tbody>
        </table>
      </Card>
      {Math.abs(data.difference) > 0.004 && (
        <div className="xl:col-span-2 text-[13px] rounded border border-amber-200 bg-amber-50 text-amber-800 px-3 py-2">
          Difference in books: {data.difference.toLocaleString("en-IN")} — check opening balances or unposted entries.
        </div>
      )}
    </div>
  );
}

// ---------- P&L ----------

function PnlView({ cid, data, detailed }: { cid: string; data: any; detailed: boolean }) {
  const nav = useNavigate();
  const money = (v: number) => (Math.abs(v) < 0.005 ? "" : v.toLocaleString("en-IN"));
  const DrCr = ({ v }: { v: number }) => (
    <>
      <td className="num">{v > 0 ? money(v) : ""}</td>
      <td className="num">{v < 0 ? money(-v) : ""}</td>
    </>
  );
  const CrOnly = ({ v }: { v: number }) => (
    <>
      <td className="num" />
      <td className="num">{v > 0 ? money(v) : ""}</td>
    </>
  );
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <Card className="p-0 overflow-hidden">
        <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-[13px] font-semibold text-slate-700">Expenses (Dr)</div>
        <table className="report-table">
          <tbody>
            <tr><td>Opening Stock</td><DrCr v={data.openingStock} /></tr>
            <tr className="row-link" onClick={() => nav(`/company/${cid}/reports/register-purchase`)}><td>Purchase Accounts</td><DrCr v={data.purchases} /></tr>
            {detailed && data.purchaseDetail.map((l: any) => (
              <tr key={l.ledgerId} className="row-link" onClick={() => nav(`/company/${cid}/reports/ledger-vouchers`, { state: { ledgerId: l.ledgerId } })}><td className="pl-6 text-slate-500">{l.name}</td><td /><td /></tr>
            ))}
            <tr className="row-link" onClick={() => nav(`/company/${cid}/reports/ledger-vouchers`)}><td>Direct Expenses</td><DrCr v={data.directExpenses} /></tr>
            {detailed && data.directExpensesDetail.map((l: any) => (
              <tr key={l.ledgerId}><td className="pl-6 text-slate-500">{l.name}</td><td /><td /></tr>
            ))}
            <tr className="font-semibold bg-slate-50 border-t border-slate-200"><td>Total</td><td className="num">{money(r2(data.purchases + data.openingStock + data.directExpenses))}</td><td /></tr>
          </tbody>
        </table>
      </Card>
      <Card className="p-0 overflow-hidden">
        <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-[13px] font-semibold text-slate-700">Income (Cr)</div>
        <table className="report-table">
          <tbody>
            <tr className="row-link" onClick={() => nav(`/company/${cid}/reports/register-sales`, { state: {} })}><td>Sales Accounts</td><CrOnly v={data.sales} /></tr>
            <tr><td>Closing Stock</td><CrOnly v={data.closingStock} /></tr>
            <tr><td>Direct Incomes</td><CrOnly v={data.directIncome} /></tr>
            {detailed && data.directIncomeDetail.map((l: any) => (
              <tr key={l.ledgerId}><td className="pl-6 text-slate-500">{l.name}</td><CrOnly v={l.amount} /></tr>
            ))}
            {data.grossProfit > 0 && <tr className="font-semibold text-green-700"><td>Gross Profit c/d</td><DrCr v={data.grossProfit} /></tr>}
            {data.grossProfit < 0 && <tr className="font-semibold text-red-700"><td>Gross Loss c/d</td><DrCr v={-data.grossProfit} /></tr>}
            <tr className="font-semibold bg-slate-50 border-t border-slate-200"><td>Total</td><td className="num">{money(r2(data.sales + data.closingStock + data.directIncome + Math.max(data.grossProfit, 0)))}</td><td className="num">{money(Math.max(-data.grossProfit, 0))}</td></tr>
          </tbody>
        </table>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-[13px] font-semibold text-slate-700">Indirect Expenses</div>
        <table className="report-table">
          <tbody>
            {detailed && data.indirectExpensesDetail.map((l: any) => (
              <tr key={l.ledgerId}><td>{l.name}</td><DrCr v={l.amount} /></tr>
            ))}
            <tr><td>Indirect Expenses</td><DrCr v={data.indirectExpenses} /></tr>
            {data.netProfit > 0 && <tr className="font-semibold text-green-700"><td>Net Profit</td><DrCr v={data.netProfit} /></tr>}
            {data.netProfit < 0 && <tr className="font-semibold text-red-700"><td>Net Loss</td><DrCr v={-data.netProfit} /></tr>}
          </tbody>
        </table>
      </Card>
      <Card className="p-0 overflow-hidden">
        <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-[13px] font-semibold text-slate-700">Indirect Incomes</div>
        <table className="report-table">
          <tbody>
            {detailed && data.indirectIncomeDetail.map((l: any) => (
              <tr key={l.ledgerId}><td>{l.name}</td><CrOnly v={l.amount} /></tr>
            ))}
            <tr><td>Indirect Incomes</td><CrOnly v={data.indirectIncome} /></tr>
            {data.grossProfit > 0 && <tr><td>Gross Profit b/f</td><CrOnly v={data.grossProfit} /></tr>}
            {data.grossProfit < 0 && <tr><td>Gross Loss b/f</td><CrOnly v={-data.grossProfit} /></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ---------- Trial Balance ----------
function TrialBalanceView({ cid, data, onCsv }: { cid: string; data: any; onCsv: (h: string[], r: (string | number)[][]) => void }) {
  const nav = useNavigate();
  return (
    <Card>
      <table className="report-table">
        <thead>
          <tr>
            <th>Ledger</th><th>Group</th>
            <th className="w-28 text-right">Opening Dr</th><th className="w-28 text-right">Opening Cr</th>
            <th className="w-28 text-right">Debit</th><th className="w-28 text-right">Credit</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r: any) => (
            <tr key={r.ledgerId} className="row-link" onClick={() => nav(`/company/${cid}/reports/ledger-vouchers`, { state: { ledgerId: r.ledgerId } })}>
              <td className="font-medium text-indigo-700">{r.name}</td>
              <td className="text-slate-500">{r.groupName}</td>
              <td className="num">{r.openingDebit ? r.openingDebit.toLocaleString("en-IN") : ""}</td>
              <td className="num">{r.openingCredit ? r.openingCredit.toLocaleString("en-IN") : ""}</td>
              <td className="num">{r.debit ? r.debit.toLocaleString("en-IN") : ""}</td>
              <td className="num">{r.credit ? r.credit.toLocaleString("en-IN") : ""}</td>
            </tr>
          ))}
          <tr className="font-bold bg-slate-50 border-t-2 border-slate-300">
            <td colSpan={4}>Totals</td>
            <td className="num">{data.totalDebit.toLocaleString("en-IN")}</td>
            <td className="num">{data.totalCredit.toLocaleString("en-IN")}</td>
          </tr>
        </tbody>
      </table>
      <div className="p-2">
        <button className="btn-ghost text-[12px]" onClick={() => onCsv(["Ledger", "Group", "Op Dr", "Op Cr", "Debit", "Credit"], data.rows.map((r: any) => [r.name, r.groupName, r.openingDebit, r.openingCredit, r.debit, r.credit]))}>
          Export CSV
        </button>
      </div>
    </Card>
  );
}

// ---------- Ledger vouchers ----------
function LedgerVouchersView({ data }: { data: any }) {
  return (
    <Card>
      <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
        <div className="text-[14px] font-semibold text-slate-800">{data.ledger.name} — Account</div>
        <div className="text-[12px] text-slate-500">Opening: {data.opening.toLocaleString("en-IN")}</div>
      </div>
      <table className="report-table">
        <thead>
          <tr><th className="w-24">Date</th><th className="w-24">Vch Type</th><th className="w-24">Vch No.</th><th>Narration</th>
            <th className="w-28 text-right">Debit</th><th className="w-28 text-right">Credit</th><th className="w-28 text-right">Balance</th></tr>
        </thead>
        <tbody>
          {data.txns.map((t: any, i: number) => (
            <tr key={i}>
              <td>{fmtDate(t.date)}</td><td>{t.typeName}</td><td>{t.number}</td>
              <td className="text-slate-500 truncate max-w-[280px]">{t.narration}</td>
              <td className="num">{t.debit ? t.debit.toLocaleString("en-IN") : ""}</td>
              <td className="num">{t.credit ? t.credit.toLocaleString("en-IN") : ""}</td>
              <td className="num">{t.balance.toLocaleString("en-IN")}</td>
            </tr>
          ))}
          <tr className="font-bold bg-slate-50 border-t-2 border-slate-300">
            <td colSpan={4}>Closing</td>
            <td className="num">{data.totalDebit.toLocaleString("en-IN")}</td>
            <td className="num">{data.totalCredit.toLocaleString("en-IN")}</td>
            <td className="num">{data.closing.toLocaleString("en-IN")}</td>
          </tr>
        </tbody>
      </table>
    </Card>
  );
}

// ---------- Group summary ----------
function GroupSummaryView({ data, detailed }: { data: any; detailed: boolean }) {
  const money = (v: number) => (Math.abs(v) < 0.005 ? "" : v.toLocaleString("en-IN"));
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <Card>
        <div className="px-3 py-2 border-b border-slate-100 text-[14px] font-semibold">{data.group.name} — Group Summary</div>
        <table className="report-table">
          <thead><tr><th>Ledger</th><th className="w-28 text-right">Debit</th><th className="w-28 text-right">Credit</th></tr></thead>
          <tbody>
            {data.ledgers.filter((l: any) => detailed || Math.abs(l.closing) > 0.004).map((l: any) => (
              <tr key={l.ledgerId}>
                <td>{l.name}</td>
                <td className="num">{money(l.closing > 0 ? l.closing : 0)}</td>
                <td className="num">{money(l.closing < 0 ? -l.closing : 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {detailed && (
        <Card>
          <div className="px-3 py-2 border-b border-slate-100 text-[14px] font-semibold">Sub-groups</div>
          <table className="report-table">
            <tbody>
              <TreeRows nodes={data.groups} />
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

// ---------- Cash / bank ----------
function CashBankView({ cid, data }: { cid: string; data: any }) {
  const nav = useNavigate();
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      {data.map((b: any) => (
        <Card key={b.ledgerId} className="p-0 overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-100 flex justify-between items-center">
            <span className="font-semibold text-[14px]">{b.name}</span>
            <span className="text-[12px] text-slate-500">Closing: {b.closing.toLocaleString("en-IN")}</span>
          </div>
          <table className="report-table">
            <thead><tr><th className="w-24">Period Dr</th><th className="w-24">Period Cr</th><th></th></tr></thead>
            <tbody>
              <tr className="row-link" onClick={() => nav(`/company/${cid}/reports/ledger-vouchers`, { state: { ledgerId: b.ledgerId } })}>
                <td className="num">{b.debit.toLocaleString("en-IN")}</td>
                <td className="num">{b.credit.toLocaleString("en-IN")}</td>
                <td className="text-[12px] text-indigo-600">View ledger →</td>
              </tr>
            </tbody>
          </table>
        </Card>
      ))}
    </div>
  );
}

// ---------- Sales / purchase register ----------
function RegisterView({ cid, data, onCsv }: { cid: string; data: any; onCsv: (h: string[], r: (string | number)[][]) => void }) {
  const nav = useNavigate();
  return (
    <Card>
      <table className="report-table">
        <thead>
          <tr><th className="w-24">Date</th><th className="w-24">Vch No.</th><th>Party</th>
            <th className="w-28 text-right">Amount</th><th className="w-24 text-right">GST</th></tr>
        </thead>
        <tbody>
          {data.rows.map((r: any) => (
            <tr key={r.voucherId} className="row-link" onClick={() => nav(`/company/${cid}/voucher/${r.voucherId}/edit`)}>
              <td>{fmtDate(r.date)}</td><td>{r.number}</td><td>{r.partyName ?? "—"}</td>
              <td className="num">{r.amount.toLocaleString("en-IN")}</td>
              <td className="num">{r.gst ? r.gst.toLocaleString("en-IN") : ""}</td>
            </tr>
          ))}
          <tr className="font-bold bg-slate-50 border-t-2 border-slate-300">
            <td colSpan={3}>Total</td><td className="num">{data.total.toLocaleString("en-IN")}</td><td />
          </tr>
        </tbody>
      </table>
      <div className="p-2">
        <button className="btn-ghost text-[12px]" onClick={() => onCsv(["Date", "No", "Party", "Amount", "GST"], data.rows.map((r: any) => [r.date, r.number, r.partyName ?? "", r.amount, r.gst]))}>Export CSV</button>
      </div>
    </Card>
  );
}

// ---------- Stock summary ----------
function StockSummaryView({ data, single }: { data: any; single: boolean }) {
  const money = (v: number) => (Math.abs(v) < 0.005 ? "" : v.toLocaleString("en-IN"));
  const qty = (v: number) => (Math.abs(v) < 1e-9 ? "" : v.toLocaleString("en-IN", { maximumFractionDigits: 3 }));
  if (single) {
    const it = data[0];
    if (!it) return <Card className="p-4 text-slate-400 text-[13px]">No movements.</Card>;
    return (
      <Card>
        <div className="px-3 py-2 border-b border-slate-100 text-[14px] font-semibold">{it.name} ({it.unit}) — Stock Item</div>
        <table className="report-table">
          <thead><tr><th></th><th className="w-28 text-right">Qty</th><th className="w-32 text-right">Value</th></tr></thead>
          <tbody>
            <tr><td>Opening</td><td className="num">{qty(it.openingQty)}</td><td className="num">{money(it.openingValue)}</td></tr>
            <tr><td>Inwards</td><td className="num">{qty(it.inQty)}</td><td className="num">{money(it.inValue)}</td></tr>
            <tr><td>Outwards</td><td className="num">{qty(it.outQty)}</td><td className="num">{money(it.outValue)}</td></tr>
            <tr className="font-bold bg-slate-50"><td>Closing</td><td className="num">{qty(it.closingQty)}</td><td className="num">{money(it.closingValue)}</td></tr>
          </tbody>
        </table>
      </Card>
    );
  }
  return (
    <Card>
      <table className="report-table">
        <thead>
          <tr><th>Item</th><th className="w-16">Unit</th>
            <th className="w-24 text-right">In Qty</th><th className="w-28 text-right">Out Qty</th>
            <th className="w-24 text-right">Closing Qty</th><th className="w-32 text-right">Closing Value</th></tr>
        </thead>
        <tbody>
          {data.map((it: any) => (
            <tr key={it.itemId}>
              <td className="font-medium">{it.name}{it.minQty > 0 && it.closingQty <= it.minQty ? <span className="ml-2 text-[10px] px-1 rounded bg-red-100 text-red-600">LOW</span> : null}</td>
              <td>{it.unit}</td>
              <td className="num">{qty(it.inQty)}</td>
              <td className="num">{qty(it.outQty)}</td>
              <td className="num">{qty(it.closingQty)}</td>
              <td className="num">{money(it.closingValue)}</td>
            </tr>
          ))}
          <tr className="font-bold bg-slate-50 border-t-2 border-slate-300">
            <td colSpan={5}>Total Stock Value</td>
            <td className="num">{r2(data.reduce((s: number, it: any) => s + it.closingValue, 0)).toLocaleString("en-IN")}</td>
          </tr>
        </tbody>
      </table>
    </Card>
  );
}

// ---------- Outstanding ----------
function OutstandingView({ data, title }: { data: any; title: string }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      {data.parties.map((p: any) => (
        <Card key={p.ledgerId} className="p-0 overflow-hidden">
          <button className="w-full px-3 py-2 flex justify-between items-center hover:bg-slate-50" onClick={() => setOpen(open === String(p.ledgerId) ? null : String(p.ledgerId))}>
            <span className="font-semibold text-[14px]">{p.ledgerName}</span>
            <span className={`num text-[14px] ${p.total > 0 ? "text-slate-800" : "text-amber-600"}`}>{p.total.toLocaleString("en-IN")}</span>
          </button>
          {open === String(p.ledgerId) && (
            <table className="report-table">
              <thead><tr><th className="w-24">Date</th><th>Bill</th><th className="w-28 text-right">Amount</th><th className="w-24">Due</th></tr></thead>
              <tbody>
                {p.bills.map((b: any, i: number) => (
                  <tr key={i}>
                    <td>{fmtDate(b.date)}</td><td>{b.billName}</td>
                    <td className={`num ${b.amount < 0 ? "text-amber-600" : ""}`}>{b.amount.toLocaleString("en-IN")}</td>
                    <td>{b.dueDate ? fmtDate(b.dueDate) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ))}
      {data.parties.length === 0 && <Card className="p-6 text-center text-slate-400 text-[13px]">No open bills. {title} is clear 🎉</Card>}
    </div>
  );
}

// ---------- GSTR-1 ----------
function Gstr1View({ data }: { data: any }) {
  const money = (v: number) => (Math.abs(v) < 0.005 ? "" : v.toLocaleString("en-IN"));
  return (
    <div className="space-y-4">
      <Card>
        <div className="px-3 py-2 border-b border-slate-100 font-semibold text-[14px]">B2B Invoices (registered purchasers)</div>
        <table className="report-table">
          <thead>
            <tr><th className="w-24">Date</th><th className="w-24">Invoice</th><th>Party</th><th className="w-32">GSTIN</th>
              <th className="w-28 text-right">Taxable</th><th className="w-24 text-right">IGST</th><th className="w-24 text-right">CGST</th><th className="w-24 text-right">SGST</th></tr>
          </thead>
          <tbody>
            {data.b2b.map((v: any) => (
              <tr key={v.voucherId}>
                <td>{fmtDate(v.date)}</td><td>{v.number}</td><td>{v.partyName}</td><td className="text-slate-500">{v.partyGstin}</td>
                <td className="num">{money(v.taxable)}</td><td className="num">{money(v.igst)}</td><td className="num">{money(v.cgst)}</td><td className="num">{money(v.sgst)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card>
        <div className="px-3 py-2 border-b border-slate-100 font-semibold text-[14px]">B2C (unregistered consumers)</div>
        <table className="report-table">
          <thead><tr><th className="w-24">Date</th><th className="w-24">Invoice</th><th>Party</th>
            <th className="w-28 text-right">Taxable</th><th className="w-24 text-right">IGST</th><th className="w-24 text-right">CGST</th><th className="w-24 text-right">SGST</th></tr></thead>
          <tbody>
            {data.b2c.map((v: any) => (
              <tr key={v.voucherId}>
                <td>{fmtDate(v.date)}</td><td>{v.number}</td><td>{v.partyName ?? "—"}</td>
                <td className="num">{money(v.taxable)}</td><td className="num">{money(v.igst)}</td><td className="num">{money(v.cgst)}</td><td className="num">{money(v.sgst)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card>
        <div className="px-3 py-2 border-b border-slate-100 font-semibold text-[14px]">HSN Summary</div>
        <table className="report-table">
          <thead><tr><th className="w-32">HSN</th><th className="w-28 text-right">Qty</th><th className="w-28 text-right">Taxable</th><th className="w-24 text-right">Rate %</th></tr></thead>
          <tbody>
            {data.hsn.map((h: any, i: number) => (
              <tr key={i}><td>{h.hsn}</td><td className="num">{h.qty.toLocaleString("en-IN")}</td><td className="num">{money(h.taxable)}</td><td className="num">{h.rate}</td></tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ---------- GSTR-3B ----------
function Gstr3bView({ data }: { data: any }) {
  const money = (v: number) => v.toLocaleString("en-IN");
  const Row = ({ label, a, b, c, d, e }: any) => (
    <tr><td>{label}</td><td className="num">{money(a)}</td><td className="num">{money(b)}</td><td className="num">{money(c)}</td><td className="num">{money(d)}</td><td className="num">{money(e)}</td></tr>
  );
  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <Card className="p-0 overflow-hidden xl:col-span-2">
        <div className="px-3 py-2 border-b border-slate-100 font-semibold text-[14px]">3.1 Outward taxable supplies</div>
        <table className="report-table">
          <thead><tr><th></th><th className="w-28 text-right">Taxable</th><th className="w-24 text-right">IGST</th><th className="w-24 text-right">CGST</th><th className="w-24 text-right">SGST</th><th className="w-20 text-right">Cess</th></tr></thead>
          <tbody>
            <Row label="Outward supplies" a={data.outward.taxable} b={data.outward.igst} c={data.outward.cgst} d={data.outward.sgst} e={data.outward.cess} />
          </tbody>
        </table>
        <div className="px-3 py-2 border-b border-slate-100 font-semibold text-[14px]">4. Eligible ITC</div>
        <table className="report-table">
          <tbody><Row label="ITC available" a={0} b={data.itc.igst} c={data.itc.cgst} d={data.itc.sgst} e={data.itc.cess} /></tbody>
        </table>
      </Card>
      <Card className="p-0 overflow-hidden">
        <div className="px-3 py-2 border-b border-slate-100 font-semibold text-[14px]">Net Tax Payable</div>
        <table className="report-table">
          <tbody>
            <tr><td>IGST</td><td className="num">{money(data.net.igst)}</td></tr>
            <tr><td>CGST</td><td className="num">{money(data.net.cgst)}</td></tr>
            <tr><td>SGST</td><td className="num">{money(data.net.sgst)}</td></tr>
            <tr><td>Cess</td><td className="num">{money(data.net.cess)}</td></tr>
            <tr className="font-bold bg-slate-50"><td>Total</td><td className="num">{money(data.net.total)}</td></tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ---------- TDS ----------
function TdsView({ data }: { data: any }) {
  const money = (v: number) => (Math.abs(v) < 0.005 ? "" : v.toLocaleString("en-IN"));
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <Card className="p-0 overflow-hidden">
        <div className="px-3 py-2 border-b border-slate-100 font-semibold text-[14px]">Deductions by Section</div>
        <table className="report-table">
          <thead><tr><th>Section</th><th className="w-20 text-right">Entries</th><th className="w-32 text-right">Amount</th></tr></thead>
          <tbody>
            {data.sections.map((s: any) => (
              <tr key={s.sectionId}><td>{s.section}</td><td className="num">{s.count}</td><td className="num">{money(s.amount)}</td></tr>
            ))}
            {data.sections.length === 0 && <tr><td colSpan={3} className="text-center text-slate-400 py-4">No TDS deducted in period</td></tr>}
          </tbody>
        </table>
      </Card>
      <div className="space-y-4">
        <Card className="p-0 overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-100 font-semibold text-[14px]">Remittances in Period</div>
          <table className="report-table">
            <thead><tr><th>Date</th><th>Voucher</th><th className="w-32 text-right">Amount</th></tr></thead>
            <tbody>
              {data.remittances.map((r2: any, i: number) => (
                <tr key={i}><td>{fmtDate(r2.date)}</td><td>{r2.number || "—"}</td><td className="num">{money(r2.amount)}</td></tr>
              ))}
              {data.remittances.length === 0 && <tr><td colSpan={3} className="text-center text-slate-400 py-4">No TDS remitted in period</td></tr>}
            </tbody>
          </table>
        </Card>
        <Card className="p-0 overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-100 font-semibold text-[14px]">TDS Payable Balance (Outstanding)</div>
          <table className="report-table">
            <tbody>
              {data.payableLedgers.map((l: any) => (
                <tr key={l.id}><td>{l.name}</td><td className="num">{money(num(l.closing))}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}

// ---------- Salary register ----------
function SalaryRegisterView({ data }: { data: any }) {
  const money = (v: any) => num(v).toLocaleString("en-IN");
  return (
    <Card>
      <table className="report-table">
        <thead><tr><th className="w-24">Month</th><th>Employee</th><th className="w-28 text-right">Gross</th><th className="w-28 text-right">Deductions</th><th className="w-28 text-right">Net</th></tr></thead>
        <tbody>
          {data.map((p: any) => (
            <tr key={p.id}>
              <td>{monthLabel(p.month)}</td><td>{p.employeeName}</td>
              <td className="num">{money(p.gross)}</td><td className="num">{money(p.deductions)}</td>
              <td className="num font-semibold">{money(p.net)}</td>
            </tr>
          ))}
          {data.length === 0 && <tr><td colSpan={5} className="text-center text-slate-400 py-4">No payroll processed yet — run it from Gateway → Process Payroll</td></tr>}
        </tbody>
      </table>
    </Card>
  );
}

// ---------- Cheque register ----------
function ChequeRegisterView({ data }: { data: any }) {
  return (
    <Card>
      <table className="report-table">
        <thead><tr><th className="w-24">Date</th><th className="w-24">Cheque No.</th><th>Bank</th><th>Party / Narration</th>
          <th className="w-28 text-right">Amount</th><th className="w-24">Direction</th></tr></thead>
        <tbody>
          {data.map((c: any, i: number) => (
            <tr key={i}>
              <td>{fmtDate(c.date)}</td><td className="font-mono">{c.chequeNumber}</td>
              <td>{c.bankLedger}</td><td className="text-slate-500 truncate max-w-[240px]">{c.narration}</td>
              <td className="num">{c.amount.toLocaleString("en-IN")}</td>
              <td>{c.direction}</td>
            </tr>
          ))}
          {data.length === 0 && <tr><td colSpan={6} className="text-center text-slate-400 py-4">No cheques recorded — enter cheque numbers on Payment/Receipt vouchers</td></tr>}
        </tbody>
      </table>
    </Card>
  );
}

// ---------- registry ----------
const ENDPOINTS: Record<string, string> = {
  "balance-sheet": "balance-sheet",
  "profit-loss": "profit-loss",
  "trial-balance": "trial-balance",
  "ledger-vouchers": "ledger-vouchers",
  "group-summary": "group-summary",
  "cash-bank": "cash-bank",
  "register-sales": "register",
  "register-purchase": "register",
  "stock-summary": "stock-summary",
  receivables: "receivables",
  payables: "payables",
  gstr1: "gstr1",
  gstr3b: "gstr3b",
  tds: "tds",
  "salary-register": "salary-register",
  "cheque-register": "cheque-register",
};

const TITLES: Record<string, string> = {
  "balance-sheet": "Balance Sheet",
  "profit-loss": "Profit & Loss A/c",
  "trial-balance": "Trial Balance",
  "ledger-vouchers": "Ledger Vouchers",
  "group-summary": "Group Summary",
  "cash-bank": "Cash / Bank Book",
  "register-sales": "Sales Register",
  "register-purchase": "Purchase Register",
  "stock-summary": "Stock Summary",
  receivables: "Bills Receivable",
  payables: "Bills Payable",
  gstr1: "GSTR-1",
  gstr3b: "GSTR-3B",
  tds: "TDS Report",
  "salary-register": "Salary Register",
  "cheque-register": "Cheque Register",
};
