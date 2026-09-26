import { useEffect, useMemo, useState } from "react";
import { Fragment } from "react";
import { useLocation } from "react-router-dom";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Shell, { FKeyButton } from "../components/Shell";
import { Card, ErrorBanner } from "../components/ui";
import { get, post } from "../lib/api";
import { useCompany } from "../store";
import { useHotkeys } from "../lib/hotkeys";
import { num, r2, today, fmtDate, fyStart, fyEnd, monthLabel, loadSessionPeriod, drCr } from "../lib/format";
import { useCompanyPeriod } from "../lib/period";
import { csvDownload, textDownload } from "../lib/csv";

export default function Reports() {
  const { cid, key } = useParams();
  const nav = useNavigate();
  const location = useLocation();
  const { company } = useCompany();
  // R-56: default window = the session current period (Alt+F2, per company)
  // when set, else the company's STORED financial year (F1 fix — no hardcoded
  // April). User changes (date inputs, +/− stepping) override for the page.
  const { from, to, setFrom, setTo } = useCompanyPeriod(company, loadSessionPeriod(cid));
  const [detailed, setDetailed] = useState(true);
  // R-60: cross-FY comparison (Tally F12 "previous year") — one toggle for
  // the three headline statements; the server composes the prior window.
  const COMPARE_KEYS = new Set(["profit-loss", "balance-sheet", "trial-balance"]);
  const [compare, setCompare] = useState(false);
  const compareOn = compare && COMPARE_KEYS.has(key ?? "");
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
    if (compareOn) p.set("compare", "1"); // R-60
    if (key === "register-sales") p.set("typeName", "Sales");
    if (key === "register-purchase") p.set("typeName", "Purchase");
    if (key === "stock-summary" && itemId) p.set("itemId", itemId);
    return p.toString();
  }, [from, to, key, itemId, compareOn]);

  const url = useMemo(() => {
    const endpoint = ENDPOINTS[key ?? ""] ?? "";
    if (!endpoint) return null;
    if (key === "ledger-vouchers" && ledgerId) return `/api/c/${cid}/reports/ledger-vouchers/${ledgerId}?${qs}`;
    if (key === "group-summary" && groupId) return `/api/c/${cid}/reports/group-summary/${groupId}?${qs}`;
    // R-66 (found via the export suite): the cheque register is a BANKING-surface
    // endpoint mounted at /api/c/:cid/cheque-register — never under /reports,
    // where the registry's generic prefix was sending it (the view could never
    // render its data).
    if (key === "cheque-register") return `/api/c/${cid}/cheque-register?${qs}`;
    return `/api/c/${cid}/reports/${endpoint}?${qs}`;
  }, [key, cid, qs, ledgerId, groupId]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["report", key, cid, url],
    queryFn: () => get<any>(url!),
    enabled: Boolean(url),
  });

  const { data: ledgers } = useQuery({ queryKey: ["all-ledgers", cid], queryFn: () => get<any[]>(`/api/c/${cid}/ledgers`), enabled: key === "ledger-vouchers" });
  const { data: items } = useQuery({ queryKey: ["all-items", cid], queryFn: () => get<any[]>(`/api/c/${cid}/stock-items`), enabled: key === "stock-summary" });

  // R-54 Option A (Tally reports): +/- steps the period by one day, keeping
  // the range length. Inert while typing in an input (engine ignores those).
  const stepPeriod = (dir: number) => {
    const DAY = 86400000;
    const f = new Date(`${from}T00:00:00Z`).getTime() + dir * DAY;
    const t = new Date(`${to}T00:00:00Z`).getTime() + dir * DAY;
    setFrom(new Date(f).toISOString().slice(0, 10));
    setTo(new Date(t).toISOString().slice(0, 10));
  };

  useHotkeys({
    // R-53c: F2 = date/period (Tally); Esc-back is owned by Shell.
    F2: () => (document.querySelector('input[type="date"]') as HTMLInputElement | null)?.focus(),
    "Alt+F1": () => setDetailed(!detailed),
    "+": () => stepPeriod(1),
    "-": () => stepPeriod(-1),
    // R-60: F12 = previous-year columns (Tally's own slot), on the big three only.
    ...(COMPARE_KEYS.has(key ?? "") ? { F12: () => setCompare(!compare) } : {}),
  }, [cid, from, to, key, compare]);

  const fkeys: FKeyButton[] = [
    { key: "Alt+F1", label: detailed ? "Condensed" : "Detailed", onClick: () => setDetailed(!detailed) },
    { key: "F2", label: "Date", onClick: () => (document.querySelector('input[type="date"]') as HTMLInputElement | null)?.focus() },
    ...(COMPARE_KEYS.has(key ?? "") ? [{ key: "F12", label: compareOn ? "Hide Prev Year" : "Prev Year", onClick: () => setCompare(!compare) } as FKeyButton] : []),
  ];

  const title = TITLES[key ?? ""] ?? "Report";

  // R-66: provenance for exports and paper — the same two rows sit above
  // every CSV table and render as the print-only header line.
  const meta: string[][] = [
    [company?.name ?? "", company?.gstin ? `GSTIN ${company.gstin}` : ""],
    [title, key === "balance-sheet" ? `as on ${fmtDate(to)}` : `${fmtDate(from)} to ${fmtDate(to)}`],
  ];

  return (
    <Shell title={title} breadcrumb={[{ label: "Gateway", to: `/company/${cid}` }, { label: "Reports" }, { label: title }]} fkeys={fkeys} wide>
      <div className="flex items-center gap-3 mb-5 flex-wrap card px-4 py-3 print:hidden">
        {key !== "balance-sheet" && (
          <>
            <span className="text-sm text-slate-500">Period</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span className="text-slate-400 text-sm">to</span>
          </>
        )}
        <span className="text-sm text-slate-500">{key === "balance-sheet" ? "as on" : "to"}</span>
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
        {COMPARE_KEYS.has(key ?? "") && (
          <label className="flex items-center gap-2 text-sm text-slate-700 select-none cursor-pointer" title="Tally F12: show the previous year beside this period (the same-length window one year back)">
            <input type="checkbox" checked={compareOn} onChange={(e) => setCompare(e.target.checked)} />
            Prev Year
          </label>
        )}
        {key === "register-sales" && <Link to={`/company/${cid}/reports/register-purchase`} className="text-sm text-indigo-600 hover:underline">Purchase Register →</Link>}
        {key === "register-purchase" && <Link to={`/company/${cid}/reports/register-sales`} className="text-sm text-indigo-600 hover:underline">Sales Register →</Link>}
      </div>

      <ErrorBanner error={error} />
      <PrintHead meta={meta} />
      {isLoading && <div className="text-slate-400 text-sm">Computing…</div>}

      {key === "balance-sheet" && data && <BalanceSheetView cid={cid!} data={data} detailed={detailed} meta={meta} />}
      {key === "chart-of-accounts" && data && <ChartOfAccountsView cid={cid!} data={data} meta={meta} />}
      {key === "profit-loss" && data && <PnlView cid={cid!} data={data} detailed={detailed} compare={compareOn} meta={meta} />}
      {key === "trial-balance" && data && <TrialBalanceView cid={cid!} data={data} compare={compareOn} meta={meta} />}
      {key === "ledger-vouchers" && data && <LedgerVouchersView data={data} meta={meta} />}
      {key === "group-summary" && data && <GroupSummaryView data={data} detailed={detailed} meta={meta} />}
      {key === "cash-bank" && data && <CashBankView cid={cid!} data={data} meta={meta} />}
      {(key === "register-sales" || key === "register-purchase") && data && (
        <RegisterView cid={cid!} data={data} meta={meta} />
      )}
      {key === "stock-summary" && data && <StockSummaryView data={data} single={Boolean(itemId)} meta={meta} />}
      {key === "receivables" && data && <OutstandingView data={data} title="Bills Receivable" meta={meta} />}
      {key === "payables" && data && <OutstandingView data={data} title="Bills Payable" meta={meta} />}
      {key === "gstr1" && data && <Gstr1View data={data} cid={cid} meta={meta} />}
      {key === "gstr3b" && data && <Gstr3bView data={data} meta={meta} />}
      {key === "gstr9" && data && <Gstr9View data={data} meta={meta} />}
      {key === "tds" && data && <TdsView data={data} meta={meta} />}
      {key === "tcs" && data && <TcsView data={data} meta={meta} />}
      {key === "salary-register" && data && <SalaryRegisterView data={data} meta={meta} />}
      {key === "cheque-register" && data && <ChequeRegisterView data={data} meta={meta} />}
    </Shell>
  );
}

// ---------- shared bits ----------

// ---------- R-66: shared export/print bits ----------

/** Print-only provenance header — company, report, period — from the same
 *  meta rows the CSV export writes. Never visible on screen. */
function PrintHead({ meta }: { meta: string[][] }) {
  const [co, gstin] = meta[0];
  const [what, period] = meta[1];
  return (
    <div className="hidden print:block mb-4">
      <div className="text-lg font-semibold text-slate-900">{co}{gstin ? ` · ${gstin}` : ""}</div>
      <div className="text-sm text-slate-600">{what} · {period}</div>
    </div>
  );
}

/** The per-report action row: Export CSV + Print. Hidden on paper. Rows are
 *  built lazily — the thunk runs only when the operator clicks Export CSV. */
function ReportActions({ name, meta, headers, rows }: {
  name: string; meta: string[][]; headers: string[];
  rows: () => (string | number | null | undefined)[][];
}) {
  return (
    <div className="flex items-center justify-end gap-2 mb-2 print:hidden" data-testid="report-actions">
      <button className="btn-ghost text-sm" data-testid="export-csv" onClick={() => csvDownload(name, headers, rows(), meta)}>Export CSV</button>
      <button className="btn-ghost text-sm" data-testid="print-report" onClick={() => window.print()}>Print</button>
    </div>
  );
}

function GroupPicker({ cid, value, onChange }: { cid: string; value: string; onChange: (v: string) => void }) {
  const { data: groups } = useQuery({ queryKey: ["groups", cid], queryFn: () => get<any[]>(`/api/c/${cid}/groups`) });
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— Select group —</option>
      {(groups ?? []).map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
    </select>
  );
}

function TreeRows({ nodes, onClick, level = 0, prev = false }: { nodes: any[]; onClick?: (n: any) => void; level?: number; prev?: boolean }) {
  return (
    <>
      {nodes.map((n) => {
        const isLeafGroup = (n.children ?? []).length === 0;
        const prevNode = prev ? (n.prevClosing ?? null) : null; // null = no prior data → dash
        return (
          <Fragment key={n.id}>
            <tr className={onClick ? "row-link" : ""} onClick={() => onClick?.(n)}>
              <td style={{ paddingLeft: `${8 + level * 16}px` }} className={level === 0 ? "font-semibold text-slate-800" : "text-slate-700"}>
                {n.name}
                {/* R-66: export provenance — the tree depth rides in the DOM so
                    a flattened CSV can carry an explicit Level column. */}
                <span className="sr-only print-keep" data-level={level} aria-hidden></span>
              </td>
              <td className="num">{n.closing >= 0 ? n.closing.toLocaleString("en-IN") : ""}</td>
              <td className="num">{n.closing < 0 ? Math.abs(n.closing).toLocaleString("en-IN") : ""}</td>
              {prev && <td className="num text-slate-500">{prevNode == null ? "—" : (prevNode !== 0 ? prevNode.toLocaleString("en-IN") : "")}</td>}
            </tr>
            {!isLeafGroup && <TreeRows nodes={n.children} onClick={onClick} level={level + 1} prev={prev} />}
          </Fragment>
        );
      })}
    </>
  );
}

// ---------- Balance Sheet ----------

/** R-60: flatten a balance-sheet tree for the prior-year index. R-66: carries
 *  each node's depth for the Level column of the flattened CSV export. */
function collectNodes(nodes: any[], out: any[] = [], depth = 0): any[] {
  for (const n of nodes) {
    out.push({ ...n, _depth: depth });
    if (n.children?.length) collectNodes(n.children, out, depth + 1);
  }
  return out;
}

/** R-66: CSV name for a tree row — indented (2 spaces per level) + the level
 *  surfaced separately, mirroring Tally's exported tree look (operator pick). */
const treeIndent = (name: string, level: number) => "  ".repeat(level) + name;

function BalanceSheetView({ cid, data, detailed, meta }: { cid: string; data: any; detailed: boolean; meta: string[][] }) {
  const nav = useNavigate();
  const openGroup = (id: number) => nav(`/company/${cid}/reports/group-summary`, { state: { groupId: id } });
  // R-60: prior-year column — the server's `previous` payload re-shaped into
  // the current tree by group id (a group that exists only in the current
  // books has no prior node → dash, never a fabricated zero).
  const prev = data.previous as any | null;
  const prevIndex = new Map<number, any>(
    prev ? [...collectNodes(prev.liabilities), ...collectNodes(prev.assets)].map((n: any) => [n.id, n]) : [],
  );
  const tagPrev = (nodes: any[]): any[] =>
    nodes.map((n) => ({ ...n, prevClosing: prevIndex.get(n.id)?.closing ?? null, children: tagPrev(n.children ?? []) }));
  const liabilities = prev ? tagPrev(data.liabilities) : data.liabilities;
  const assets = prev ? tagPrev(data.assets) : data.assets;
  return (
    <>
    <ReportActions
      name="balance-sheet"
      meta={meta}
      headers={prev ? ["Level", "Particulars", "Debit", "Credit", "Prev Closing"] : ["Level", "Particulars", "Debit", "Credit"]}
      rows={() => {
        const flat = [...collectNodes(liabilities), ...collectNodes(assets)];
        const rows: (string | number)[][] = flat.map((n: any) => prev
          ? [n._depth, treeIndent(n.name, n._depth), n.closing >= 0 ? r2(n.closing) : "", n.closing < 0 ? r2(-n.closing) : "", n.prevClosing ?? ""]
          : [n._depth, treeIndent(n.name, n._depth), n.closing >= 0 ? r2(n.closing) : "", n.closing < 0 ? r2(-n.closing) : ""]);
        rows.push(["", "TOTAL LIABILITIES", "", r2(data.totalLiabilities)]);
        rows.push(["", "TOTAL ASSETS", r2(data.totalAssets), ""]);
        return rows;
      }}
    />
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-sm font-semibold text-slate-700 tracking-wide">Liabilities</div>
        <table className="report-table">
          <thead><tr><th>Particulars</th><th className="w-32 text-right">Debit</th><th className="w-32 text-right">Credit</th>{prev && <th className="w-24 text-right" title={data.previousWindow ? `As on ${fmtDate(data.previousWindow.to)}` : undefined}>Prev</th>}<th className="w-32 text-right">Debit</th><th className="w-32 text-right">Credit</th></tr></thead>
          <tbody>
            <TreeRows nodes={liabilities} onClick={detailed ? (n) => openGroup(n.id) : undefined} prev={!!prev} />
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
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-sm font-semibold text-slate-700 tracking-wide">Assets</div>
        <table className="report-table">
          <thead><tr><th>Particulars</th><th className="w-32 text-right">Debit</th><th className="w-32 text-right">Credit</th>{prev && <th className="w-24 text-right" title={data.previousWindow ? `As on ${fmtDate(data.previousWindow.to)}` : undefined}>Prev</th>}<th className="w-32 text-right">Debit</th><th className="w-32 text-right">Credit</th></tr></thead>
          <tbody>
            <TreeRows nodes={assets} onClick={detailed ? (n) => openGroup(n.id) : undefined} prev={!!prev} />
            <tr className="font-bold border-t-2 border-slate-300">
              <td>Total</td><td className="num">{data.totalAssets.toLocaleString("en-IN")}</td><td className="num" />
            </tr>
          </tbody>
        </table>
      </Card>
      {Math.abs(data.difference) > 0.004 && (
        <div className="xl:col-span-2 text-sm rounded-lg border border-amber-200 bg-amber-50 text-amber-800 px-4 py-2.5 leading-relaxed">
          Difference in books: {data.difference.toLocaleString("en-IN")} — check opening balances or unposted entries.
        </div>
      )}
    </div>
    </>
  );
}

// ---------- P&L ----------

function PnlView({ cid, data, detailed, compare, meta }: { cid: string; data: any; detailed: boolean; compare: boolean; meta: string[][] }) {
  // R-66: one unified statement export — sections labelled, Dr/Cr columns.
  const onCsv = () => {
    csvDownload(
      "profit-loss",
      ["Particulars", "Debit", "Credit"],
      [
        ["Opening Stock", data.openingStock > 0 ? r2(data.openingStock) : "", ""],
        ["Purchase Accounts", data.purchases > 0 ? r2(data.purchases) : "", ""],
        ["Direct Expenses", data.directExpenses > 0 ? r2(data.directExpenses) : "", ""],
        ...data.purchaseDetail.map((l: any) => [treeIndent(l.name, 1), l.amount > 0 ? r2(l.amount) : "", ""]),
        ...data.directExpensesDetail.map((l: any) => [treeIndent(l.name, 1), l.amount > 0 ? r2(l.amount) : "", ""]),
        ["Total (Dr side)", r2(data.purchases + data.openingStock + data.directExpenses), ""],
        ["Sales Accounts", "", data.sales > 0 ? r2(data.sales) : ""],
        ["Closing Stock", "", data.closingStock > 0 ? r2(data.closingStock) : ""],
        ["Direct Incomes", "", data.directIncome > 0 ? r2(data.directIncome) : ""],
        ...data.directIncomeDetail.map((l: any) => [treeIndent(l.name, 1), "", l.amount > 0 ? r2(l.amount) : ""]),
        ["Gross Profit c/d", data.grossProfit > 0 ? r2(data.grossProfit) : "", ""],
        ["Indirect Expenses", data.indirectExpenses > 0 ? r2(data.indirectExpenses) : "", ""],
        ...data.indirectExpensesDetail.map((l: any) => [treeIndent(l.name, 1), l.amount > 0 ? r2(l.amount) : "", ""]),
        ["Indirect Incomes", "", data.indirectIncome > 0 ? r2(data.indirectIncome) : ""],
        ...data.indirectIncomeDetail.map((l: any) => [treeIndent(l.name, 1), "", l.amount > 0 ? r2(l.amount) : ""]),
        ["Gross Profit b/f", "", data.grossProfit > 0 ? r2(data.grossProfit) : ""],
        [data.netProfit >= 0 ? "Net Profit" : "Net Loss", "", r2(Math.abs(data.netProfit))],
      ],
      meta,
    );
  };
  const nav = useNavigate();
  const p = compare ? (data.previous as any | null) : null;
  const labels = data.compareLabels as { current: string; previous: string } | undefined;
  const money = (v: number) => (Math.abs(v) < 0.005 ? "" : v.toLocaleString("en-IN"));
  const DrCr = ({ v, pv }: { v: number; pv?: number | null }) => (
    <>
      <td className="num">{v > 0 ? money(v) : ""}</td>
      <td className="num">{v < 0 ? money(-v) : ""}</td>
      {p && <td className="num text-slate-500">{pv == null ? "—" : pv !== 0 ? pv.toLocaleString("en-IN") : ""}</td>}
    </>
  );
  const CrOnly = ({ v, pv }: { v: number; pv?: number | null }) => (
    <>
      <td className="num" />
      <td className="num">{v > 0 ? money(v) : ""}</td>
      {p && <td className="num text-slate-500">{pv == null ? "—" : pv !== 0 ? pv.toLocaleString("en-IN") : ""}</td>}
    </>
  );
  return (
    <>
    <ReportActions name="profit-loss" meta={meta} headers={["Particulars", "Debit", "Credit"]} rows={() => { onCsv(); return []; }} />
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-sm font-semibold text-slate-700 tracking-wide">Expenses (Dr){p && labels && <span className="ml-2 font-normal text-xs text-slate-400">{labels.current} vs {labels.previous}</span>}</div>
        <table className="report-table">
          <tbody>
            <tr><td>Opening Stock</td><DrCr v={data.openingStock} pv={p?.openingStock} /></tr>
            <tr className="row-link" onClick={() => nav(`/company/${cid}/reports/register-purchase`)}><td>Purchase Accounts</td><DrCr v={data.purchases} pv={p?.purchases} /></tr>
            {detailed && data.purchaseDetail.map((l: any) => (
              <tr key={l.ledgerId} className="row-link" onClick={() => nav(`/company/${cid}/reports/ledger-vouchers`, { state: { ledgerId: l.ledgerId } })}><td className="pl-6 text-slate-500">{l.name}</td><td /><td />{p && <td className="num text-slate-500">—</td>}</tr>
            ))}
            <tr className="row-link" onClick={() => nav(`/company/${cid}/reports/ledger-vouchers`)}><td>Direct Expenses</td><DrCr v={data.directExpenses} pv={p?.directExpenses} /></tr>
            {detailed && data.directExpensesDetail.map((l: any) => (
              <tr key={l.ledgerId}><td className="pl-6 text-slate-500">{l.name}</td><td /><td />{p && <td className="num text-slate-500">—</td>}</tr>
            ))}
            <tr className="font-semibold bg-slate-50 border-t border-slate-200"><td>Total</td><td className="num">{money(r2(data.purchases + data.openingStock + data.directExpenses))}</td><td />{p && <td className="num text-slate-500">{money(r2((p.purchases ?? 0) + (p.openingStock ?? 0) + (p.directExpenses ?? 0)))}</td>}</tr>
          </tbody>
        </table>
      </Card>
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-sm font-semibold text-slate-700 tracking-wide">Income (Cr){p && labels && <span className="ml-2 font-normal text-xs text-slate-400">{labels.current} vs {labels.previous}</span>}</div>
        <table className="report-table">
          <tbody>
            <tr className="row-link" onClick={() => nav(`/company/${cid}/reports/register-sales`, { state: {} })}><td>Sales Accounts</td><CrOnly v={data.sales} pv={p?.sales} /></tr>
            <tr><td>Closing Stock</td><CrOnly v={data.closingStock} pv={p?.closingStock} /></tr>
            <tr><td>Direct Incomes</td><CrOnly v={data.directIncome} pv={p?.directIncome} /></tr>
            {detailed && data.directIncomeDetail.map((l: any) => (
              <tr key={l.ledgerId}><td className="pl-6 text-slate-500">{l.name}</td><CrOnly v={l.amount} /></tr>
            ))}
            {data.grossProfit > 0 && <tr className="font-semibold text-green-700"><td>Gross Profit c/d</td><DrCr v={data.grossProfit} pv={p?.grossProfit} /></tr>}
            {data.grossProfit < 0 && <tr className="font-semibold text-red-700"><td>Gross Loss c/d</td><DrCr v={-data.grossProfit} pv={p ? -(p.grossProfit ?? 0) : null} /></tr>}
            <tr className="font-semibold bg-slate-50 border-t border-slate-200"><td>Total</td><td className="num">{money(r2(data.sales + data.closingStock + data.directIncome + Math.max(data.grossProfit, 0)))}</td><td className="num">{money(Math.max(-data.grossProfit, 0))}</td>{p && <td className="num text-slate-500">{money(r2((p.sales ?? 0) + (p.closingStock ?? 0) + (p.directIncome ?? 0) + Math.max(p.grossProfit ?? 0, 0)))}</td>}{p && <td className="num text-slate-500">{money(Math.max(-(p.grossProfit ?? 0), 0))}</td>}</tr>
          </tbody>
        </table>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-sm font-semibold text-slate-700 tracking-wide">Indirect Expenses{p && labels && <span className="ml-2 font-normal text-xs text-slate-400">{labels.current} vs {labels.previous}</span>}</div>
        <table className="report-table">
          <tbody>
            {detailed && data.indirectExpensesDetail.map((l: any) => (
              <tr key={l.ledgerId}><td>{l.name}</td><DrCr v={l.amount} /></tr>
            ))}
            <tr><td>Indirect Expenses</td><DrCr v={data.indirectExpenses} pv={p?.indirectExpenses} /></tr>
            {data.netProfit > 0 && <tr className="font-semibold text-green-700"><td>Net Profit</td><DrCr v={data.netProfit} pv={p?.netProfit} /></tr>}
            {data.netProfit < 0 && <tr className="font-semibold text-red-700"><td>Net Loss</td><DrCr v={-data.netProfit} pv={p ? -(p.netProfit ?? 0) : null} /></tr>}
          </tbody>
        </table>
      </Card>
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-sm font-semibold text-slate-700 tracking-wide">Indirect Incomes{p && labels && <span className="ml-2 font-normal text-xs text-slate-400">{labels.current} vs {labels.previous}</span>}</div>
        <table className="report-table">
          <tbody>
            {detailed && data.indirectIncomeDetail.map((l: any) => (
              <tr key={l.ledgerId}><td>{l.name}</td><CrOnly v={l.amount} /></tr>
            ))}
            <tr><td>Indirect Incomes</td><CrOnly v={data.indirectIncome} pv={p?.indirectIncome} /></tr>
            {data.grossProfit > 0 && <tr><td>Gross Profit b/f</td><CrOnly v={data.grossProfit} pv={p?.grossProfit} /></tr>}
            {data.grossProfit < 0 && <tr><td>Gross Loss b/f</td><CrOnly v={-data.grossProfit} pv={p ? -(p.grossProfit ?? 0) : null} /></tr>}
          </tbody>
        </table>
      </Card>
    </div>
    </>
  );
}

// ---------- Trial Balance ----------
function TrialBalanceView({ cid, data, compare, meta }: { cid: string; data: any; compare: boolean; meta: string[][] }) {
  const nav = useNavigate();
  // R-60: prior-year column — rows joined on ledgerId; a ledger that exists
  // only today (no prior row, or a zero prior closing) renders a dash.
  const p = compare ? (data.previous as any | null) : null;
  const prevBy = new Map<number, any>((p?.rows ?? []).map((r: any) => [r.ledgerId, r]));
  const prevOf = (r: any) => {
    const pr = prevBy.get(r.ledgerId);
    if (!pr) return null; // ledger did not exist in the prior window
    const pc = r2((pr.openingDebit ?? 0) - (pr.openingCredit ?? 0) + (pr.debit ?? 0) - (pr.credit ?? 0));
    return pc === 0 && (pr.debit ?? 0) === 0 && (pr.credit ?? 0) === 0 && (pr.openingDebit ?? 0) === 0 && (pr.openingCredit ?? 0) === 0 ? null : pc;
  };
  const prevLabel: string = data.compareLabels?.previous ?? "Prev";
  return (
    <>
    <ReportActions
      name="trial-balance"
      meta={meta}
      headers={p ? ["Ledger", "Group", "Op Dr", "Op Cr", "Debit", "Credit", "Prev Closing"] : ["Ledger", "Group", "Op Dr", "Op Cr", "Debit", "Credit"]}
      rows={() => [
        ...data.rows.map((r: any) => (p ? [r.name, r.groupName, r.openingDebit, r.openingCredit, r.debit, r.credit, prevOf(r) ?? ""] : [r.name, r.groupName, r.openingDebit, r.openingCredit, r.debit, r.credit])),
        ["Totals", "", "", "", data.totalDebit, data.totalCredit],
      ]}
    />
    <Card>
      <table className="report-table">
        <thead>
          <tr>
            <th>Ledger</th><th>Group</th>
            <th className="w-28 text-right">Opening Dr</th><th className="w-28 text-right">Opening Cr</th>
            <th className="w-28 text-right">Debit</th><th className="w-28 text-right">Credit</th>
            {p && <th className="w-28 text-right" title={data.previousWindow ? `${fmtDate(data.previousWindow.from)} → ${fmtDate(data.previousWindow.to)}` : undefined}>{`Prev ${prevLabel}`}</th>}
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
              {p && (() => { const pv = prevOf(r); return <td className="num text-slate-500">{pv == null ? "—" : Math.abs(pv) < 0.005 ? "" : pv.toLocaleString("en-IN")}</td>; })()}
            </tr>
          ))}
          <tr className="font-bold bg-slate-50 border-t-2 border-slate-300">
            <td colSpan={4}>Totals</td>
            <td className="num">{data.totalDebit.toLocaleString("en-IN")}</td>
            <td className="num">{data.totalCredit.toLocaleString("en-IN")}</td>
            {p && <td className="num text-slate-500">{r2((p.totalDebit ?? 0) - (p.totalCredit ?? 0)).toLocaleString("en-IN")}</td>}
          </tr>
        </tbody>
      </table>
      {Math.abs(data.difference ?? 0) > 0.004 && (
        <div className="text-sm rounded-lg border border-amber-200 bg-amber-50 text-amber-800 px-4 py-2.5 m-3 leading-relaxed">
          Difference in books: {data.difference.toLocaleString("en-IN")} — check opening balances or unposted entries.
        </div>
      )}
    </Card>
    </>
  );
}

// ---------- Ledger vouchers ----------
function LedgerVouchersView({ data, meta }: { data: any; meta: string[][] }) {
  return (
    <>
    <ReportActions
      name="ledger-vouchers"
      meta={meta}
      headers={["Date", "Vch Type", "Vch No.", "Narration", "Debit", "Credit", "Balance"]}
      rows={() => [
        ...data.txns.map((t: any) => [fmtDate(t.date), t.typeName, t.number, t.narration ?? "", t.debit || "", t.credit || "", t.balance]),
        ["Closing", "", "", "", data.totalDebit, data.totalCredit, data.closing],
      ]}
    />
    <Card>
      <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
        <div className="text-base font-semibold text-slate-800">{data.ledger.name} — Account</div>
        <div className="text-sm text-slate-500">Opening: {data.opening.toLocaleString("en-IN")}</div>
      </div>
      <table className="report-table">
        <thead>
          <tr><th className="w-24">Date</th><th className="w-24">Vch Type</th><th className="w-24">Vch No.</th><th>Narration</th>
            <th className="w-28 text-right">Debit</th><th className="w-28 text-right">Credit</th><th className="w-28 text-right">Balance</th></tr>
        </thead>
        <tbody>
          {data.txns.map((t: any, i: number) => (
            <tr key={i}>
              <td className="cell-nowrap">{fmtDate(t.date)}</td><td>{t.typeName}</td><td className="cell-nowrap">{t.number}</td>
              <td className="text-slate-500 min-w-[200px] line-clamp-2 leading-snug">{t.narration}</td>
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
    </>
  );
}

// ---------- Group summary ----------
function GroupSummaryView({ data, detailed, meta }: { data: any; detailed: boolean; meta: string[][] }) {
  const money = (v: number) => (Math.abs(v) < 0.005 ? "" : v.toLocaleString("en-IN"));
  return (
    <>
    <ReportActions
      name="group-summary"
      meta={meta}
      headers={["Ledger", "Debit", "Credit"]}
      rows={() => data.ledgers.map((l: any) => [l.name, l.closing > 0 ? r2(l.closing) : "", l.closing < 0 ? r2(-l.closing) : ""])}
    />
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <Card>
        <div className="px-4 py-3 border-b border-slate-100 font-semibold text-base text-slate-800">{data.group.name} — Group Summary</div>
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
          <div className="px-4 py-3 border-b border-slate-100 font-semibold text-base text-slate-800">Sub-groups</div>
          <table className="report-table">
            <tbody>
              <TreeRows nodes={data.groups} />
            </tbody>
          </table>
        </Card>
      )}
    </div>
    </>
  );
}

// ---------- Cash / bank ----------
function CashBankView({ cid, data, meta }: { cid: string; data: any; meta: string[][] }) {
  const nav = useNavigate();
  return (
    <>
    <ReportActions
      name="cash-bank"
      meta={meta}
      headers={["Ledger", "Period Dr", "Period Cr", "Closing"]}
      rows={() => data.map((b: any) => [b.name, b.debit, b.credit, b.closing])}
    />
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      {data.map((b: any) => (
        <Card key={b.ledgerId} className="p-0 overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-100 flex justify-between items-center">
            <span className="text-base font-semibold">{b.name}</span>
            <span className="text-sm text-slate-500">Closing: {b.closing.toLocaleString("en-IN")}</span>
          </div>
          <table className="report-table">
            <thead><tr><th className="w-24 cell-nowrap">Period Dr</th><th className="w-24 cell-nowrap">Period Cr</th><th></th></tr></thead>
            <tbody>
              <tr className="row-link" onClick={() => nav(`/company/${cid}/reports/ledger-vouchers`, { state: { ledgerId: b.ledgerId } })}>
                <td className="num">{b.debit.toLocaleString("en-IN")}</td>
                <td className="num">{b.credit.toLocaleString("en-IN")}</td>
                <td className="text-sm text-indigo-600">View ledger →</td>
              </tr>
            </tbody>
          </table>
        </Card>
      ))}
    </div>
    </>
  );
}

// ---------- Sales / purchase register ----------
function RegisterView({ cid, data, meta }: { cid: string; data: any; meta: string[][] }) {
  const nav = useNavigate();
  return (
    <>
    <ReportActions
      name="register"
      meta={meta}
      headers={["Date", "No", "Party", "Amount", "GST"]}
      rows={() => data.rows.map((r: any) => [fmtDate(r.date), r.number, r.partyName ?? "", r.amount, r.gst || ""])}
    />
    <Card>
      <table className="report-table">
        <thead>
          <tr><th className="w-24">Date</th><th className="w-24">Vch No.</th><th>Party</th>
            <th className="w-28 text-right">Amount</th><th className="w-24 text-right">GST</th></tr>
        </thead>
        <tbody>
          {data.rows.map((r: any) => (
            <tr key={r.voucherId} className="row-link" onClick={() => nav(`/company/${cid}/voucher/${r.voucherId}/edit`)}>
              <td className="cell-nowrap">{fmtDate(r.date)}</td><td className="cell-nowrap">{r.number}</td><td>{r.partyName ?? "—"}</td>
              <td className="num">{r.amount.toLocaleString("en-IN")}</td>
              <td className="num">{r.gst ? r.gst.toLocaleString("en-IN") : ""}</td>
            </tr>
          ))}
          <tr className="font-bold bg-slate-50 border-t-2 border-slate-300">
            <td colSpan={3}>Total</td><td className="num">{data.total.toLocaleString("en-IN")}</td><td />
          </tr>
        </tbody>
      </table>
    </Card>
    </>
  );
}

// ---------- Stock summary ----------
function StockSummaryView({ data, single, meta }: { data: any; single: boolean; meta: string[][] }) {
  const money = (v: number) => (Math.abs(v) < 0.005 ? "" : v.toLocaleString("en-IN"));
  const qty = (v: number) => (Math.abs(v) < 1e-9 ? "" : v.toLocaleString("en-IN", { maximumFractionDigits: 3 }));
  if (single) {
    const it = data[0];
    if (!it) return <Card className="p-6 text-slate-400 text-sm">No movements.</Card>;
    return (
      <>
      <ReportActions
        name="stock-summary"
        meta={meta}
        headers={["Stage", "Qty", "Value"]}
        rows={() => [["Opening", it.openingQty || "", it.openingValue], ["Inwards", it.inQty || "", it.inValue], ["Outwards", it.outQty || "", it.outValue], ["Closing", it.closingQty, it.closingValue]]}
      />
      <Card>
        <div className="px-4 py-3 border-b border-slate-100 font-semibold text-base text-slate-800">{it.name} ({it.unit}) — Stock Item</div>
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
      </>
    );
  }
  return (
    <>
    <ReportActions
      name="stock-summary"
      meta={meta}
      headers={["Item", "Unit", "In Qty", "Out Qty", "Closing Qty", "Closing Value"]}
      rows={() => [
        ...data.map((it: any) => [it.name, it.unit, it.inQty || "", it.outQty || "", it.closingQty, it.closingValue]),
        ["Total Stock Value", "", "", "", "", r2(data.reduce((s: number, it: any) => s + it.closingValue, 0))],
      ]}
    />
    <Card>
      <table className="report-table">
        <thead>
          <tr><th>Item</th><th className="w-16">Unit</th>
            <th className="w-24 text-right">In Qty</th><th className="w-28 text-right">Out Qty</th>
            <th className="cell-nowrap text-right">Closing Qty</th><th className="w-32 text-right">Closing Value</th></tr>
        </thead>
        <tbody>
          {data.map((it: any) => (
            <tr key={it.itemId}>
              <td className="font-medium">{it.name}{it.minQty > 0 && it.closingQty <= it.minQty ? <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-600 font-semibold align-middle">LOW</span> : null}</td>
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
    </>
  );
}

// ---------- Outstanding ----------
function OutstandingView({ data, title, meta }: { data: any; title: string; meta: string[][] }) {
  // R-70: bills render PER BILL by default (Tally's bill-wise Outstanding) —
  // party rows are expanded unless the operator collapses them. Previously the
  // bill table only appeared after clicking each party, so "On Account" /
  // named-bill labels were invisible until drilled (and never printed).
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const toggle = (id: string) => {
    const next = new Set(closed);
    if (next.has(id)) next.delete(id); else next.add(id);
    setClosed(next);
  };
  return (
    <>
    <ReportActions
      name="bills-outstanding"
      meta={meta}
      headers={["Party", "Bill Date", "Bill", "Amount", "Due Date"]}
      rows={() => data.parties.flatMap((p: any) => p.bills.map((b: any) => [p.ledgerName, fmtDate(b.date), b.billName, b.amount, b.dueDate ? fmtDate(b.dueDate) : ""]))}
    />
    <div className="space-y-3">
      {data.parties.map((p: any) => (
        <Card key={p.ledgerId} className="p-0 overflow-hidden">
          <button className="print-keep w-full px-3 py-2 flex justify-between items-center hover:bg-slate-50" onClick={() => toggle(String(p.ledgerId))} title={closed.has(String(p.ledgerId)) ? "Show bills" : "Hide bills"}>
            <span className="text-base font-semibold">{p.ledgerName}</span>
            <span className={`num text-base ${p.total > 0 ? "text-slate-800" : "text-amber-600"}`}>{p.total.toLocaleString("en-IN")}</span>
          </button>
          {!closed.has(String(p.ledgerId)) && (
            <table className="report-table">
              <thead><tr><th className="w-24">Date</th><th>Bill</th><th className="w-28 text-right">Amount</th><th className="w-24">Due</th></tr></thead>
              <tbody>
                {p.bills.map((b: any, i: number) => (
                  <tr key={i}>
                    <td className="cell-nowrap">{fmtDate(b.date)}</td>
                    <td>{b.billType === "on_account" || b.billType === "opening"
                      ? <span className="italic text-slate-500">{b.billName}</span>
                      : b.billName}</td>
                    <td className={`num ${b.amount < 0 ? "text-amber-600" : ""}`}>{b.amount.toLocaleString("en-IN")}</td>
                    <td className="cell-nowrap">{b.dueDate ? fmtDate(b.dueDate) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ))}
      {data.parties.length === 0 && <Card className="p-10 text-center text-slate-400 text-sm">No open bills. {title} is clear 🎉</Card>}
    </div>
    </>
  );
}

// ---------- GSTR-1 ----------
function Gstr1View({ data, cid, meta }: { data: any; cid?: string; meta: string[][] }) {
  const money = (v: number) => (Math.abs(v) < 0.005 ? "" : v.toLocaleString("en-IN"));
  const t = data.totals ?? {};
  const hasNotes = (data.cdnr?.length ?? 0) + (data.cdnur?.length ?? 0) > 0;
  const [einvMsg, setEinvMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // R-66: the B2B table exports (the filing accountants' working sheet); per-voucher
  // e-inv/e-way JSON downloads remain the statutory-format surface.
  const gstr1Csv = () =>
    data.b2b.map((v: any) => [fmtDate(v.date), v.number, v.partyName ?? "", v.partyGstin ?? "", v.taxable, v.igst, v.cgst, v.sgst]);
  // R-24/R-25: generate + download compliance payloads for one voucher. The
  // server validates strictly; validation failures surface every gap at once;
  // non-blocking advisories (e-way threshold, HSN depth) show as warnings.
  const downloadPayload = async (kind: "einvoice" | "ewaybill", voucherId: number, number: string) => {
    setEinvMsg(null);
    try {
      const res = await get<{ ok: boolean; errors: string[]; warnings?: string[]; payload?: unknown }>(
        `/api/c/${cid}/reports/${kind}/${voucherId}`,
      );
      if (!res.ok) {
        setEinvMsg({ ok: false, text: res.errors.join(" · ") });
        return;
      }
      textDownload(`${kind}-${number.replace(/[^A-Za-z0-9_-]/g, "_")}.json`, JSON.stringify(res.payload, null, 2));
      const warn = res.warnings?.length ? ` ⚠ ${res.warnings.join(" · ")}` : "";
      setEinvMsg({ ok: true, text: `${kind === "einvoice" ? "e-invoice" : "e-way bill"} JSON downloaded for ${number} — upload it to your portal${warn}` });
    } catch (e: any) {
      setEinvMsg({ ok: false, text: e?.message ?? "payload generation failed" });
    }
  };
  // R-28: submit the stored payload to the IRP (opt-in — requires credentials
  // in Company Settings). Outcome surfaces verbatim: IRN/ack on success,
  // the IRP's own error list on rejection, a duplicate notice (409) when the
  // voucher was already accepted/pending — never a second network call.
  const submitPayload = async (kind: "e-invoice" | "ewaybill", voucherId: number, number: string) => {
    setEinvMsg(null);
    try {
      const res: any = await post(
        `/api/c/${cid}/reports/${kind === "e-invoice" ? "einvoice" : "ewaybill"}/${voucherId}/submit`,
        {},
      );
      if (res.ok && res.submission) {
        const s = res.submission;
        setEinvMsg({ ok: true, text: `${kind === "e-invoice" ? "e-invoice" : "e-way bill"} accepted for ${number}` + (s.irn ? ` — IRN ${s.irn}` : s.ewbNo ? ` — EWB ${s.ewbNo}` : "") });
      }
    } catch (e: any) {
      // Non-2xx: the server's `error` message is human-readable (validation
      // gaps, duplicate refusal, IRP ErrorDetails, unreachable endpoint).
      setEinvMsg({ ok: false, text: e?.message ?? "submission failed" });
    }
  };
  // R-30: DIRECT e-way bill birth (no IRN — B2C). Vehicle is the one
  // operator-known input; leaving it empty births the EWB Part-B-empty and
  // the vehicle attaches later through the lifecycle action. Errors surface
  // verbatim: address/pincode gaps as readable 422s, duplicate refusals,
  // portal ErrorDetails on rejection.
  const ewbDirect = async (voucherId: number, number: string) => {
    setEinvMsg(null);
    const vehicleNo = window.prompt(`Vehicle number for the e-way bill on ${number} (optional — leave empty to attach it later):`, "");
    try {
      const q = vehicleNo ? `?vehicleNo=${encodeURIComponent(vehicleNo)}` : "";
      const res: any = await post(`/api/c/${cid}/reports/ewaybill/${voucherId}/generate-direct${q}`, {});
      if (res.ok && res.submission) {
        const s = res.submission;
        setEinvMsg({ ok: true, text: `e-way bill (direct) accepted for ${number}` + (s.ewbNo ? ` — EWB ${s.ewbNo}` : "") });
      }
    } catch (e: any) {
      setEinvMsg({ ok: false, text: e?.message ?? "direct generation failed" });
    }
  };
  // R-29: EWB lifecycle ops against the ACCEPTED e-way bill (opt-in, same
  // credentials as R-28). Every outcome surfaces verbatim on the banner —
  // NIC rejections included; eager guards (extend-once, 24h cancel window)
  // come back as readable 422s before any wire call.
  const ewbOp = async (op: "vehicle" | "extend" | "cancel", voucherId: number, number: string, body: Record<string, unknown>) => {
    setEinvMsg(null);
    try {
      const res: any = await post(`/api/c/${cid}/reports/ewaybill/${voucherId}/${op}`, body);
      if (res.ok) {
        const s = res.submission ?? {};
        setEinvMsg({ ok: true, text: `EWB ${op === "vehicle" ? "vehicle updated" : op === "extend" ? "validity extended" : "cancelled"} for ${number}` + (s.ewbNo ? ` — EWB ${s.ewbNo}` : "") + (op === "extend" && s.ewbValidUntil ? ` — valid until ${s.ewbValidUntil}` : "") });
      }
    } catch (e: any) {
      setEinvMsg({ ok: false, text: e?.message ?? "operation failed" });
    }
  };
  const askEwbOp = (op: "vehicle" | "extend" | "cancel", voucherId: number, number: string) => {
    if (op === "vehicle") {
      const vehicleNo = window.prompt(`New vehicle number for ${number} (e.g. MH14CD5678):`);
      if (!vehicleNo) return;
      const fromPlace = window.prompt("Current place of the vehicle (fromPlace):", "");
      const fromState = window.prompt("Current state code (fromState, e.g. 27):", "");
      void ewbOp("vehicle", voucherId, number, { vehicleNo, fromPlace, fromState });
    } else if (op === "extend") {
      const reasonCode = window.prompt("Reason (vehicle_breakdown | law_and_order | accident | natural_calamity | transshipment | others):", "transshipment");
      if (!reasonCode) return;
      const remainFrom = window.prompt("Vehicle is currently at (place):", "");
      const remainFromState = window.prompt("Current state code (e.g. 27):", "");
      const remainingDistance = window.prompt("Remaining distance in km:", "");
      void ewbOp("extend", voucherId, number, { reasonCode, remainFrom, remainFromState, remainingDistance: Number(remainingDistance) });
    } else {
      const reasonCode = window.prompt("Cancel reason (duplicate | data_entry_mistake | order_cancelled | others):", "data_entry_mistake");
      if (!reasonCode) return;
      const remark = window.prompt("Remark (required):", "");
      if (!remark) return;
      void ewbOp("cancel", voucherId, number, { reasonCode, remark });
    }
  };
  const einvCell = (v: any) =>
    cid ? (
      <td className="w-56 whitespace-nowrap">
        <button className="link text-sm" onClick={() => downloadPayload("einvoice", v.voucherId, v.number)} title="Generate NIC v1.01 e-invoice JSON">e-inv</button>
        {" "}
        <button className="link text-sm" onClick={() => downloadPayload("ewaybill", v.voucherId, v.number)} title="Generate EWB-01 e-way bill JSON">e-way</button>
        {" "}
      <button className="link text-sm" onClick={() => submitPayload("e-invoice", v.voucherId, v.number)} title="Submit the e-invoice to the IRP (requires Company Settings → IRP Connectivity)">submit</button>
      {" "}
      <button className="link text-sm" onClick={() => submitPayload("ewaybill", v.voucherId, v.number)} title="Generate an e-way bill from the registered IRN (requires the e-invoice to be submitted first)">ewb-gen</button>
      {" "}
      <button className="link text-sm" onClick={() => askEwbOp("vehicle", v.voucherId, v.number)} title="Update the vehicle (Part-B) on the accepted e-way bill">ewb-veh</button>
        {" "}
        <button className="link text-sm" onClick={() => askEwbOp("extend", v.voucherId, v.number)} title="Extend e-way bill validity (once per EWB; 8h window applies)">ewb-ext</button>
        {" "}
        <button className="link text-sm" onClick={() => askEwbOp("cancel", v.voucherId, v.number)} title="Cancel the e-way bill (24h window; re-generate afterwards)">ewb-can</button>
      </td>
    ) : null;
  // R-30: B2C rows carry the direct-birth action until an EWB exists, then
  // the same lifecycle actions as B2B rows (the ops are row-shaped).
  const b2cCell = (v: any) =>
    cid ? (
      <td className="w-56 whitespace-nowrap">
        {v.ewbNo ? (
          <>
            <span className="text-sm text-slate-500" title="Accepted e-way bill">EWB {v.ewbNo}</span>{" "}
            <button className="link text-sm" onClick={() => askEwbOp("vehicle", v.voucherId, v.number)} title="Update the vehicle (Part-B) on the accepted e-way bill">veh</button>
            {" "}
            <button className="link text-sm" onClick={() => askEwbOp("extend", v.voucherId, v.number)} title="Extend e-way bill validity (once per EWB; 8h window applies)">ext</button>
            {" "}
            <button className="link text-sm" onClick={() => askEwbOp("cancel", v.voucherId, v.number)} title="Cancel the e-way bill (24h window; re-generate afterwards)">can</button>
          </>
        ) : (
          <button className="link text-sm" onClick={() => ewbDirect(v.voucherId, v.number)} title="Generate an e-way bill directly from this invoice (no IRN — requires Company Settings → EWB portal credentials)">ewb</button>
        )}
      </td>
    ) : null;
  const NoteTable = ({ rows, gstin }: { rows: any[]; gstin: boolean }) => (
    <table className="report-table">
      <thead>
        <tr><th className="w-24">Date</th><th className="w-24">Note</th><th>Party</th>{gstin && <th className="w-32">GSTIN</th>}
          <th className="w-28 text-right">Taxable</th><th className="w-24 text-right">IGST</th><th className="w-24 text-right">CGST</th><th className="w-24 text-right">SGST</th></tr>
      </thead>
      <tbody>
        {rows.map((v: any) => (
          <tr key={v.voucherId}>
            <td className="cell-nowrap">{fmtDate(v.date)}</td><td className="cell-nowrap">{v.number}</td><td>{v.partyName ?? "—"}</td>{gstin && <td className="text-slate-500">{v.partyGstin}</td>}
            <td className="num">{money(v.taxable)}</td><td className="num">{money(v.igst)}</td><td className="num">{money(v.cgst)}</td><td className="num">{money(v.sgst)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <div className="space-y-4">
      <ReportActions name="gstr1" meta={meta} headers={["Date", "Invoice", "Party", "GSTIN", "Taxable", "IGST", "CGST", "SGST"]} rows={gstr1Csv} />
      {einvMsg && (
        <div className={`px-3 py-2 rounded text-sm ${einvMsg.ok ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-amber-50 text-amber-900 border border-amber-200"}`} role="status">
          {einvMsg.text}
        </div>
      )}
      {hasNotes && (
        <Card>
          <div className="px-4 py-3 border-b border-slate-100 font-semibold text-base text-slate-800">Net outward supplies (Table 9 net of notes)</div>
          <table className="report-table">
            <thead><tr><th></th><th className="w-28 text-right">Taxable</th><th className="w-24 text-right">IGST</th><th className="w-24 text-right">CGST</th><th className="w-24 text-right">SGST</th></tr></thead>
            <tbody>
              <tr><td>Net</td><td className="num font-semibold">{money(t.netTaxable)}</td><td className="num">{money(t.netIgst)}</td><td className="num">{money(t.netCgst)}</td><td className="num">{money(t.netSgst)}</td></tr>
            </tbody>
          </table>
        </Card>
      )}
      <Card>
        <div className="px-4 py-3 border-b border-slate-100 font-semibold text-base text-slate-800">B2B Invoices (registered purchasers)</div>
        <table className="report-table">
          <thead>
            <tr><th className="w-24">Date</th><th className="w-24">Invoice</th><th>Party</th><th className="w-32">GSTIN</th>
              <th className="w-28 text-right">Taxable</th><th className="w-24 text-right">IGST</th><th className="w-24 text-right">CGST</th><th className="w-24 text-right">SGST</th></tr>
          </thead>
          <tbody>
            {data.b2b.map((v: any) => (
              <tr key={v.voucherId}>
                <td className="cell-nowrap">{fmtDate(v.date)}</td><td className="cell-nowrap">{v.number}</td><td className="cell-nowrap">{v.partyName}</td><td className="text-slate-500 cell-nowrap">{v.partyGstin}</td>
                <td className="num">{money(v.taxable)}</td><td className="num">{money(v.igst)}</td><td className="num">{money(v.cgst)}</td><td className="num">{money(v.sgst)}</td>
                {einvCell(v)}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card>
        <div className="px-4 py-3 border-b border-slate-100 font-semibold text-base text-slate-800">B2C (unregistered consumers)</div>
        <table className="report-table">
          <thead><tr><th className="w-24">Date</th><th className="w-24">Invoice</th><th>Party</th>
            <th className="w-28 text-right">Taxable</th><th className="w-24 text-right">IGST</th><th className="w-24 text-right">CGST</th><th className="w-24 text-right">SGST</th><th className="w-56">E-way bill</th></tr></thead>
          <tbody>
            {data.b2c.map((v: any) => (
              <tr key={v.voucherId}>
                <td className="cell-nowrap">{fmtDate(v.date)}</td><td className="cell-nowrap">{v.number}</td><td>{v.partyName ?? "—"}</td>
                <td className="num">{money(v.taxable)}</td><td className="num">{money(v.igst)}</td><td className="num">{money(v.cgst)}</td><td className="num">{money(v.sgst)}</td>
                {b2cCell(v)}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {hasNotes && (
        <Card>
          <div className="px-4 py-3 border-b border-slate-100 font-semibold text-base text-slate-800">CDNR — Credit Notes, registered parties (Table 9B)</div>
          <NoteTable rows={data.cdnr} gstin={true} />
        </Card>
      )}
      {hasNotes && (
        <Card>
          <div className="px-4 py-3 border-b border-slate-100 font-semibold text-base text-slate-800">CDNUR — Credit Notes, unregistered (Table 9B)</div>
          <NoteTable rows={data.cdnur} gstin={false} />
        </Card>
      )}
      <Card>
        <div className="px-4 py-3 border-b border-slate-100 font-semibold text-base text-slate-800">HSN Summary</div>
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
function Gstr3bView({ data, meta }: { data: any; meta: string[][] }) {
  const money = (v: number) => v.toLocaleString("en-IN");
  const Row = ({ label, a, b, c, d, e }: any) => (
    <tr><td>{label}</td><td className="num">{money(a)}</td><td className="num">{money(b)}</td><td className="num">{money(c)}</td><td className="num">{money(d)}</td><td className="num">{money(e)}</td></tr>
  );
  return (
    <>
    <ReportActions
      name="gstr-3b"
      meta={meta}
      headers={["Section", "Taxable", "IGST", "CGST", "SGST", "Cess"]}
      rows={() => [
        ["3.1 Outward supplies", data.outward.taxable, data.outward.igst, data.outward.cgst, data.outward.sgst, data.outward.cess],
        ...(data.inwardRcm ? [["3.1.1 Inward supplies (RCM)", data.inwardRcm.taxable, data.inwardRcm.igst, data.inwardRcm.cgst, data.inwardRcm.sgst, data.inwardRcm.cess]] : []),
        ["4 ITC available", 0, data.itc.igst, data.itc.cgst, data.itc.sgst, data.itc.cess],
        ...(data.rcmItc ? [["ITC claimed on RCM", 0, data.rcmItc.igst, data.rcmItc.cgst, data.rcmItc.sgst, data.rcmItc.cess]] : []),
        ["Net IGST payable", "", "", "", "", data.net.igst],
        ["Net CGST payable", "", "", "", "", data.net.cgst],
        ["Net SGST payable", "", "", "", "", data.net.sgst],
        ["Net Cess payable", "", "", "", "", data.net.cess],
        ["Net Tax Payable", "", "", "", "", data.net.total],
      ]}
    />
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <Card className="p-0 overflow-hidden xl:col-span-2">
        <div className="px-4 py-3 border-b border-slate-100 font-semibold text-base text-slate-800">3.1 Outward taxable supplies</div>
        <table className="report-table">
          <thead><tr><th></th><th className="w-28 text-right">Taxable</th><th className="w-24 text-right">IGST</th><th className="w-24 text-right">CGST</th><th className="w-24 text-right">SGST</th><th className="w-20 text-right">Cess</th></tr></thead>
          <tbody>
            <Row label="Outward supplies" a={data.outward.taxable} b={data.outward.igst} c={data.outward.cgst} d={data.outward.sgst} e={data.outward.cess} />
          </tbody>
        </table>
        <div className="px-4 py-3 border-b border-slate-100 font-semibold text-base text-slate-800">4. Eligible ITC</div>
        <table className="report-table">
          <tbody><Row label="ITC available (other than RCM)" a={0} b={data.itc.igst} c={data.itc.cgst} d={data.itc.sgst} e={data.itc.cess} /></tbody>
        </table>
        {/* R-23: reverse charge — Table 4(A)(3) liability + the ITC claimed on it.
            Hidden when all-zero (non-RCM books keep the classic compact view). */}
        {(data.inwardRcm?.taxable || data.inwardRcm?.igst || data.inwardRcm?.cgst || data.inwardRcm?.sgst || data.inwardRcm?.cess
          || data.rcmItc?.igst || data.rcmItc?.cgst || data.rcmItc?.sgst || data.rcmItc?.cess) ? (
          <>
            <div className="px-4 py-3 border-b border-slate-100 font-semibold text-base text-slate-800">3.1.1 Supplies attracting reverse charge — 4(A)(3)</div>
            <table className="report-table">
              <thead><tr><th></th><th className="w-28 text-right">Taxable</th><th className="w-24 text-right">IGST</th><th className="w-24 text-right">CGST</th><th className="w-24 text-right">SGST</th><th className="w-20 text-right">Cess</th></tr></thead>
              <tbody>
                <Row label="Inward supplies (RCM)" a={data.inwardRcm.taxable} b={data.inwardRcm.igst} c={data.inwardRcm.cgst} d={data.inwardRcm.sgst} e={data.inwardRcm.cess} />
              </tbody>
            </table>
            <div className="px-4 py-3 border-b border-slate-100 font-semibold text-base text-slate-800">ITC claimed on reverse charge</div>
            <table className="report-table">
              <tbody><Row label="RCM ITC claimed" a={0} b={data.rcmItc.igst} c={data.rcmItc.cgst} d={data.rcmItc.sgst} e={data.rcmItc.cess} /></tbody>
            </table>
          </>
        ) : null}
      </Card>
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 font-semibold text-base text-slate-800">Net Tax Payable</div>
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
    </>
  );
}

// ---------- TDS ----------
function TdsView({ data, meta }: { data: any; meta: string[][] }) {
  const money = (v: number) => (Math.abs(v) < 0.005 ? "" : v.toLocaleString("en-IN"));
  return (
    <div className="space-y-4">
      <ReportActions
        name="tds"
        meta={meta}
        headers={["Section", "Entries", "Amount"]}
        rows={() => data.sections.map((s: any) => [s.section, s.count, s.amount])}
      />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 font-semibold text-base text-slate-800">Deductions by Section</div>
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
          <div className="px-4 py-3 border-b border-slate-100 font-semibold text-base text-slate-800">Remittances in Period</div>
          <table className="report-table">
            <thead><tr><th>Date</th><th>Voucher</th><th className="w-32 text-right">Amount</th></tr></thead>
            <tbody>
              {data.remittances.map((r2: any, i: number) => (
                <tr key={i}><td className="cell-nowrap">{fmtDate(r2.date)}</td><td className="cell-nowrap">{r2.number || "—"}</td><td className="num">{money(r2.amount)}</td></tr>
              ))}
              {data.remittances.length === 0 && <tr><td colSpan={3} className="text-center text-slate-400 py-4">No TDS remitted in period</td></tr>}
            </tbody>
          </table>
        </Card>
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 font-semibold text-base text-slate-800">TDS Payable Balance (Outstanding)</div>
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
      <FyPayeeThresholdCard fyAggregates={data.fyAggregates} dutyHead="TDS" />
    </div>
  );
}

// ---------- R-38: FY threshold status, per payee (R-37 data, report surface) ----------
// Renders the fyAggregates the TDS/TCS report payloads already carry (R-33/
// R-37): one block per section, one row per payee. Status math MIRRORS the
// server's advisory formula exactly (aggregate mode compares the payee FY
// base; single mode the payee's largest single payment; near = 80% band).
// Advisory-only: the card informs; nothing is withheld or blocked.
function FyPayeeThresholdCard({ fyAggregates, dutyHead }: { fyAggregates: any[] | undefined; dutyHead: "TDS" | "TCS" }) {
  const money = (v: number) => (Math.abs(v) < 0.005 ? "" : v.toLocaleString("en-IN"));
  const secs = Array.isArray(fyAggregates) ? fyAggregates : [];
  const base = dutyHead === "TCS" ? "collection" : "payment";
  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 font-semibold text-base text-slate-800">FY Threshold Status (per payee)</div>
      {secs.length === 0 && (
        <div className="px-3 py-4 text-center text-slate-400 text-sm">No section declarations with FY {base} activity</div>
      )}
      {secs.map((s: any) => {
        const mode = s.thresholdMode ?? "aggregate";
        const compareOf = (p: any) => (mode === "single" ? p.maxSingle : p.fyAmount);
        const statusOf = (p: any): { label: string; cls: string } => {
          if (s.threshold <= 0) return { label: "no threshold recorded — confirm applicability manually", cls: "text-slate-500" };
          const cmp = compareOf(p);
          if (cmp >= s.threshold) return { label: "OVER — TDS/TCS due on further payments", cls: "text-amber-700 bg-amber-50 border border-amber-200" };
          if (cmp > 0 && cmp >= s.threshold * 0.8) return { label: "near threshold", cls: "text-amber-600" };
          return { label: "under threshold", cls: "text-slate-500" };
        };
        return (
          <div key={s.sectionId} className="px-3 py-2.5 border-b border-slate-100 last:border-b-0">
            <div className="text-sm font-medium text-slate-600 mb-1">
              Section {s.section} · threshold {s.threshold > 0 ? `₹${s.threshold.toLocaleString("en-IN")}` : "not recorded"} · {mode === "single" ? "per-payment threshold" : `FY ${base} aggregate`} · FY-to-date {money(s.fyAmount)}
            </div>
            <table className="report-table">
              <thead>
                <tr><th>Payee</th><th className="w-24">PAN</th><th className="w-28 text-right">This FY</th><th className="w-32 text-right">Largest single</th><th className="w-72">Status</th></tr>
              </thead>
              <tbody>
                {(s.payees ?? []).map((p: any) => {
                  const st = statusOf(p);
                  return (
                    <tr key={p.ledgerId}>
                      <td>{p.ledgerName}</td>
                      <td className={p.hasPan ? "text-slate-500" : "text-slate-400"}>{p.hasPan ? "on file" : "not recorded"}</td>
                      <td className="num">{money(p.fyAmount)}</td>
                      <td className="num">{money(p.maxSingle)}</td>
                      <td><span className={`text-sm px-2 py-0.5 rounded ${st.cls}`}>{st.label}</span></td>
                    </tr>
                  );
                })}
                {(s.payees ?? []).length === 0 && (
                  <tr><td colSpan={5} className="text-center text-slate-400 py-3">No payee-level {base} activity this FY</td></tr>
                )}
              </tbody>
            </table>
            {(s.payees ?? []).length > 1 && (
              <div className="text-xs text-slate-400 mt-1">Section total ₹{s.fyAmount.toLocaleString("en-IN")} across payees — the statutory threshold binds per payee, not on this sum.</div>
            )}
            {s.threshold <= 0 && (
              <div className="text-xs text-slate-400 mt-1">No threshold recorded for this section — confirm applicability manually.</div>
            )}
          </div>
        );
      })}
      <div className="px-3 py-2 bg-slate-50 border-t border-slate-100 text-xs text-slate-500">
        FY-to-date informational thresholds — nothing is withheld or blocked; TDS/TCS judgment remains the operator's.
      </div>
    </Card>
  );
}

// ---------- TCS (R-27) — collection-side mirror of the TDS view ----------
function TcsView({ data, meta }: { data: any; meta: string[][] }) {
  const money = (v: number) => (Math.abs(v) < 0.005 ? "" : v.toLocaleString("en-IN"));
  return (
    <div className="space-y-4">
      <ReportActions
        name="tcs"
        meta={meta}
        headers={["Section", "Entries", "Rate %", "Amount"]}
        rows={() => data.sections.map((s: any) => [s.section, s.count, s.rate ?? "", s.amount])}
      />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 font-semibold text-base text-slate-800">Collections by Section</div>
        <table className="report-table">
          <thead><tr><th>Section</th><th className="w-20 text-right">Entries</th><th className="w-24 text-right">Rate</th><th className="w-32 text-right">Amount</th></tr></thead>
          <tbody>
            {data.sections.map((s: any) => (
              <tr key={s.sectionId}><td>{s.section}</td><td className="num">{s.count}</td><td className="num">{s.rate ? `${s.rate}%` : "—"}</td><td className="num">{money(s.amount)}</td></tr>
            ))}
            {data.sections.length === 0 && <tr><td colSpan={4} className="text-center text-slate-400 py-4">No TCS collected in period</td></tr>}
          </tbody>
        </table>
      </Card>
      <div className="space-y-4">
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 font-semibold text-base text-slate-800">Remittances in Period</div>
          <table className="report-table">
            <thead><tr><th>Date</th><th>Voucher</th><th className="w-32 text-right">Amount</th></tr></thead>
            <tbody>
              {data.remittances.map((r2: any, i: number) => (
                <tr key={i}><td className="cell-nowrap">{fmtDate(r2.date)}</td><td className="cell-nowrap">{r2.number || "—"}</td><td className="num">{money(r2.amount)}</td></tr>
              ))}
              {data.remittances.length === 0 && <tr><td colSpan={3} className="text-center text-slate-400 py-4">No TCS remitted in period</td></tr>}
            </tbody>
          </table>
        </Card>
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 font-semibold text-base text-slate-800">TCS Payable Balance (Outstanding)</div>
          <table className="report-table">
            <tbody>
              {data.payableLedgers.map((l: any) => (
                <tr key={l.id}><td>{l.name}</td><td className="num">{money(num(l.closing))}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card className="p-3">
          <div className="flex justify-between text-sm"><span className="text-slate-600">Collected in period</span><span className="num font-semibold">{money(data.totals.collected)}</span></div>
          <div className="flex justify-between text-sm"><span className="text-slate-600">Remitted in period</span><span className="num font-semibold">{money(data.totals.remitted)}</span></div>
          <div className="flex justify-between text-sm border-t border-slate-200 mt-1 pt-1"><span className="text-slate-600 font-medium">Outstanding (collected − remitted)</span><span className="num font-semibold">{money(data.totals.outstanding)}</span></div>
        </Card>
      </div>
      </div>
      <FyPayeeThresholdCard fyAggregates={data.fyAggregates} dutyHead="TCS" />
    </div>
  );
}

// ---------- Salary register ----------
function SalaryRegisterView({ data, meta }: { data: any; meta: string[][] }) {
  const money = (v: any) => num(v).toLocaleString("en-IN");
  return (
    <>
    <ReportActions
      name="salary-register"
      meta={meta}
      headers={["Month", "Employee", "Gross", "Deductions", "Net"]}
      rows={() => data.map((p: any) => [monthLabel(p.month), p.employeeName, num(p.gross), num(p.deductions), num(p.net)])}
    />
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
    </>
  );
}

// ---------- Cheque register ----------
function ChequeRegisterView({ data, meta }: { data: any; meta: string[][] }) {
  return (
    <>
    <ReportActions
      name="cheque-register"
      meta={meta}
      headers={["Date", "Cheque No.", "Bank", "Party / Narration", "Amount", "Direction"]}
      rows={() => data.map((c: any) => [fmtDate(c.date), c.chequeNumber, c.bankLedger, c.narration ?? "", c.amount, c.direction])}
    />
    <Card>
      <table className="report-table">
        <thead><tr><th className="w-24">Date</th><th className="w-24">Cheque No.</th><th>Bank</th><th>Party / Narration</th>
          <th className="w-28 text-right">Amount</th><th className="w-24">Direction</th></tr></thead>
        <tbody>
          {data.map((c: any, i: number) => (
            <tr key={i}>
              <td className="cell-nowrap">{fmtDate(c.date)}</td><td className="font-mono cell-nowrap">{c.chequeNumber}</td>
              <td>{c.bankLedger}</td><td className="text-slate-500 min-w-[180px] line-clamp-2 leading-snug">{c.narration}</td>
              <td className="num">{c.amount.toLocaleString("en-IN")}</td>
              <td>{c.direction}</td>
            </tr>
          ))}
          {data.length === 0 && <tr><td colSpan={6} className="text-center text-slate-400 py-4">No cheques recorded — enter cheque numbers on Payment/Receipt vouchers</td></tr>}
        </tbody>
      </table>
    </Card>
    </>
  );
}

// ---------- GSTR-9 (annual) ----------
function Gstr9View({ data, meta }: { data: any; meta: string[][] }) {
  const money = (v: number) => (Math.abs(v) < 0.005 ? "" : v.toLocaleString("en-IN"));
  // R-66: the duty-head tables flatten into one long (Section, IGST, CGST, SGST,
  // Cess) sheet — the annual return's working copy.
  const gstr9Csv = () => {
    const t4 = data.table4, t8 = data.table8, t9 = data.table9, con = data.consistency;
    const duty = (label: string, v: any) => [label, v.igst, v.cgst, v.sgst, v.cess ?? 0];
    return [
      duty("Table 4 A(5) — supplier-charged ITC", t4.currentYearRegular),
      duty("Table 4 A(3) — reverse-charge ITC", t4.currentYearRcm),
      duty("Table 8 Opening credit balance", t8.opening),
      duty("Table 8 ITC claimed this FY", t8.claimed),
      duty("Table 8 Computed closing", t8.computedClosing),
      duty("Table 8 Actual duty-ledger closing", t8.ledgerClosing),
      duty("Table 8 Difference", t8.difference),
      ["Table 9 B2B", t9.b2b.taxable, t9.b2b.igst, t9.b2b.cgst, t9.b2b.sgst],
      ["Table 9 B2C", t9.b2c.taxable, t9.b2c.igst, t9.b2c.cgst, t9.b2c.sgst],
      ["Table 9 CDNR", t9.cdnr.taxable, t9.cdnr.igst, t9.cdnr.cgst, t9.cdnr.sgst],
      ["Table 9 CDNUR", t9.cdnur.taxable, t9.cdnur.igst, t9.cdnur.cgst, t9.cdnur.sgst],
      ["Table 9 Net", t9.net.taxable, t9.net.igst, t9.net.cgst, t9.net.sgst],
      ["Check: Table 9 net − 3B outward", con.table9Vs3bOutward.taxable, con.table9Vs3bOutward.igst, con.table9Vs3bOutward.cgst, con.table9Vs3bOutward.sgst],
      ...data.table12.map((h: any) => [`Table 12 HSN ${h.hsn} @${h.rate}%`, "", "", "", ""]),
    ];
  };
  const DutyRow = ({ label, v, tol = 0.005 }: { label: string; v: { igst: number; cgst: number; sgst: number; cess?: number }; tol?: number }) => (
    <tr className={Math.abs(v.igst) + Math.abs(v.cgst) + Math.abs(v.sgst) + Math.abs(v.cess ?? 0) > tol ? "bg-amber-50" : ""}>
      <td>{label}</td><td className="num">{money(v.igst)}</td><td className="num">{money(v.cgst)}</td><td className="num">{money(v.sgst)}</td><td className="num">{money(v.cess ?? 0)}</td>
    </tr>
  );
  const dutyHead = (<tr><th></th><th className="w-28 text-right">IGST</th><th className="w-28 text-right">CGST</th><th className="w-28 text-right">SGST</th><th className="w-28 text-right">CESS</th></tr>);
  const t4 = data.table4, t8 = data.table8, t9 = data.table9, con = data.consistency;
  return (
    <>
    <ReportActions name="gstr-9" meta={meta} headers={["Section", "IGST", "CGST", "SGST", "CESS"]} rows={gstr9Csv} />
    <div className="space-y-4">
      <Card>
        <div className="px-4 py-3 border-b border-slate-100 font-semibold text-base text-slate-800">Table 4 — Eligible ITC (current year)</div>
        <table className="report-table">
          <thead>{dutyHead}</thead>
          <tbody>
            <DutyRow label="A(5) — supplier-charged (all regular ITC)" v={t4.currentYearRegular} />
            <DutyRow label="A(3) — reverse charge (RCM ITC claimed)" v={t4.currentYearRcm} />
          </tbody>
        </table>
      </Card>
      <Card>
        <div className="px-4 py-3 border-b border-slate-100 font-semibold text-base text-slate-800">Table 5 — ITC reversals</div>
        <div className="px-4 py-2.5 text-sm text-slate-500 leading-relaxed">Total: {money(data.table5.total)} — {data.table5.note}</div>
      </Card>
      <Card>
        <div className="px-4 py-3 border-b border-slate-100 font-semibold text-base text-slate-800">Tables 6/7 — inward RCM & outward supplies</div>
        <table className="report-table">
          <thead><tr><th></th><th className="w-28 text-right">Taxable</th><th className="w-28 text-right">IGST</th><th className="w-28 text-right">CGST</th><th className="w-28 text-right">SGST</th><th className="w-28 text-right">CESS</th></tr></thead>
          <tbody>
            <tr><td>Inward liable to reverse charge (4(A)(3))</td><td className="num">{money(data.table6_7.inwardRcm.taxable)}</td><td className="num">{money(data.table6_7.inwardRcm.igst)}</td><td className="num">{money(data.table6_7.inwardRcm.cgst)}</td><td className="num">{money(data.table6_7.inwardRcm.sgst)}</td><td className="num">{money(data.table6_7.inwardRcm.cess)}</td></tr>
            <tr><td>Outward supplies (3B outward)</td><td className="num">{money(data.table6_7.outward.taxable)}</td><td className="num">{money(data.table6_7.outward.igst)}</td><td className="num">{money(data.table6_7.outward.cgst)}</td><td className="num">{money(data.table6_7.outward.sgst)}</td><td className="num">{money(data.table6_7.outward.cess)}</td></tr>
          </tbody>
        </table>
      </Card>
      <Card>
        <div className="px-4 py-3 border-b border-slate-100 font-semibold text-base text-slate-800">Table 8 — ITC reconciliation (duty ledgers)</div>
        <table className="report-table">
          <thead>{dutyHead}</thead>
          <tbody>
            <DutyRow label="Opening credit balance (FY start)" v={t8.opening} />
            <DutyRow label="+ ITC claimed this FY (Table 4 A(5))" v={t8.claimed} />
            <DutyRow label="= Computed closing" v={t8.computedClosing} />
            <DutyRow label="Actual duty-ledger closing" v={t8.ledgerClosing} />
            <DutyRow label="Difference (non-zero = unclaimed/unposted)" v={t8.difference} />
          </tbody>
        </table>
        <div className="px-4 py-2.5 text-sm text-slate-500 leading-relaxed">{t8.note}</div>
      </Card>
      <Card>
        <div className="px-4 py-3 border-b border-slate-100 font-semibold text-base text-slate-800">Table 9 — supplies declared</div>
        <table className="report-table">
          <thead><tr><th></th><th className="w-28 text-right">Taxable</th><th className="w-28 text-right">IGST</th><th className="w-28 text-right">CGST</th><th className="w-28 text-right">SGST</th></tr></thead>
          <tbody>
            <tr><td>B2B</td><td className="num">{money(t9.b2b.taxable)}</td><td className="num">{money(t9.b2b.igst)}</td><td className="num">{money(t9.b2b.cgst)}</td><td className="num">{money(t9.b2b.sgst)}</td></tr>
            <tr><td>B2C</td><td className="num">{money(t9.b2c.taxable)}</td><td className="num">{money(t9.b2c.igst)}</td><td className="num">{money(t9.b2c.cgst)}</td><td className="num">{money(t9.b2c.sgst)}</td></tr>
            <tr><td>CDNR (registered notes)</td><td className="num">{money(t9.cdnr.taxable)}</td><td className="num">{money(t9.cdnr.igst)}</td><td className="num">{money(t9.cdnr.cgst)}</td><td className="num">{money(t9.cdnr.sgst)}</td></tr>
            <tr><td>CDNUR (unregistered notes)</td><td className="num">{money(t9.cdnur.taxable)}</td><td className="num">{money(t9.cdnur.igst)}</td><td className="num">{money(t9.cdnur.cgst)}</td><td className="num">{money(t9.cdnur.sgst)}</td></tr>
            <tr className="font-semibold"><td>Net</td><td className="num">{money(t9.net.taxable)}</td><td className="num">{money(t9.net.igst)}</td><td className="num">{money(t9.net.cgst)}</td><td className="num">{money(t9.net.sgst)}</td></tr>
          </tbody>
        </table>
      </Card>
      <Card>
        <div className="px-4 py-3 border-b border-slate-100 font-semibold text-base text-slate-800">Consistency checks</div>
        <table className="report-table">
          <thead><tr><th></th><th className="w-28 text-right">Taxable</th><th className="w-28 text-right">IGST</th><th className="w-28 text-right">CGST</th><th className="w-28 text-right">SGST</th></tr></thead>
          <tbody>
            <tr className={(Math.abs(con.table9Vs3bOutward.taxable) + Math.abs(con.table9Vs3bOutward.igst) + Math.abs(con.table9Vs3bOutward.cgst) + Math.abs(con.table9Vs3bOutward.sgst)) > 0.005 ? "bg-amber-50" : ""}>
              <td>Table 9 net − GSTR-3B outward (must be 0)</td><td className="num">{money(con.table9Vs3bOutward.taxable)}</td><td className="num">{money(con.table9Vs3bOutward.igst)}</td><td className="num">{money(con.table9Vs3bOutward.cgst)}</td><td className="num">{money(con.table9Vs3bOutward.sgst)}</td>
            </tr>
          </tbody>
        </table>
      </Card>
      <Card>
        <div className="px-4 py-3 border-b border-slate-100 font-semibold text-base text-slate-800">Table 12 — annual HSN (outward supplies)</div>
        <table className="report-table">
          <thead><tr><th className="w-24">HSN</th><th className="w-20 text-right">Rate %</th><th className="w-28 text-right">Qty</th><th className="w-32 text-right">Taxable</th></tr></thead>
          <tbody>
            {data.table12.map((h: any) => (
              <tr key={h.hsn}><td className="font-mono">{h.hsn}</td><td className="num">{h.rate}</td><td className="num">{h.qty}</td><td className="num">{money(h.taxable)}</td></tr>
            ))}
            {data.table12.length === 0 && <tr><td colSpan={4} className="text-center text-slate-400 py-4">No outward HSN data for the period</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
    </>
  );
}


// ---------- registry ----------
const ENDPOINTS: Record<string, string> = {
  "balance-sheet": "balance-sheet",
  "chart-of-accounts": "chart-of-accounts",
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
  gstr9: "gstr9",
  tds: "tds",
  tcs: "tcs",
  "salary-register": "salary-register",
  "cheque-register": "cheque-register",
};

const TITLES: Record<string, string> = {
  "balance-sheet": "Balance Sheet",
  "chart-of-accounts": "Chart of Accounts",
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
  gstr9: "GSTR-9 (Annual)",
  tds: "TDS Report",
  tcs: "TCS Report",
  "salary-register": "Salary Register",
  "cheque-register": "Cheque Register",
};

// ---------- Chart of Accounts (R-63 — Tally's COA explorer) ----------

/** The whole chart in one expandable tree: every group (full structure, even
 *  zero-activity) and every ledger leaf — the click-through view of what the
 *  Balance Sheet and P&L roll up. Read-only; click a ledger for its vouchers,
 *  a group for Group Summary. Type-to-filter narrows the tree, keeping every
 *  ancestor of a match. */
function ChartOfAccountsView({ cid, data, meta }: { cid: string; data: any; meta: string[][] }) {
  const nav = useNavigate();
  const [filter, setFilter] = useState("");
  const q = filter.trim().toLowerCase();

  // R-66: full-chart export — every group row (indented + Level) followed by
  // its ledger leaves, mirroring the on-screen tree regardless of expansion.
  const coaCsv = () => {
    const rows: (string | number)[][] = [];
    const walk = (nodes: any[], depth: number) => {
      for (const n of nodes) {
        rows.push([depth, treeIndent(n.name, depth), n.opening, n.debit, n.credit, n.closing]);
        for (const l of (byGroup.get(n.id) ?? []).filter((l) => matches(l.name)).sort((a, b) => a.name.localeCompare(b.name))) {
          rows.push([depth + 1, treeIndent(l.name, depth + 1), l.opening, l.debit, l.credit, l.closing]);
        }
        if (n.children?.length) walk(n.children, depth + 1);
      }
    };
    walk(data.groups ?? [], 0);
    return rows;
  };

  // Expanded one level deep at rest (roots + their children); expansion state
  // persists across refetches (ids are stable). While filtering, every branch
  // with a match is forced open.
  const [expanded, setExpanded] = useState<Set<number>>(() => {
    const s = new Set<number>();
    const walk = (nodes: any[], depth: number) => {
      for (const n of nodes) {
        s.add(n.id);
        if (depth > 0 && n.children?.length) walk(n.children, depth - 1);
      }
    };
    walk(data.groups ?? [], 1);
    return s;
  });

  const byGroup = new Map<number, any[]>();
  for (const l of data.ledgers ?? []) {
    const list = byGroup.get(l.groupId) ?? [];
    list.push(l);
    byGroup.set(l.groupId, list);
  }

  const matches = (name: string) => !q || name.toLowerCase().includes(q);
  const groupHasHit = (n: any): boolean =>
    !q || matches(n.name) || (byGroup.get(n.id) ?? []).some((l) => matches(l.name)) || (n.children ?? []).some(groupHasHit);

  const renderRows = (nodes: any[], depth: number) =>
    nodes.map((n) => {
      if (q && !groupHasHit(n)) return null;
      const open = q.length > 0 || expanded.has(n.id);
      const kids = (n.children ?? []).filter((c: any) => !q || groupHasHit(c));
      const ledgers = (byGroup.get(n.id) ?? []).filter((l) => matches(l.name)).sort((a, b) => a.name.localeCompare(b.name));
      const toggle = () =>
        setExpanded((prev) => {
          const s = new Set(prev);
          if (s.has(n.id)) s.delete(n.id);
          else s.add(n.id);
          return s;
        });
      return (
        <Fragment key={n.id}>
          <tr data-testid="coa-group" className="row-link" onClick={() => nav(`/company/${cid}/reports/group-summary`, { state: { groupId: n.id } })}>
            <td>
              <span className="inline-flex items-center gap-1.5" style={{ paddingLeft: depth * 16 }}>
                <button
                  className={`w-4 shrink-0 text-slate-400 hover:text-slate-700 ${kids.length || ledgers.length ? "" : "invisible"}`}
                  onClick={(e) => { e.stopPropagation(); toggle(); }}
                  aria-label={open ? "Collapse" : "Expand"}
                >
                  {open ? "▾" : "▸"}
                </button>
                <span className={`font-medium ${depth === 0 ? "text-slate-800" : "text-slate-700"}`}>{n.name}</span>
              </span>
            </td>
            <td className="num">{drCr(n.opening)}</td>
            <td className="num">{drCr(n.debit)}</td>
            <td className="num">{drCr(n.credit)}</td>
            <td className="num font-medium">{drCr(n.closing)}</td>
          </tr>
          {open &&
            ledgers.map((l) => (
              <tr
                key={`l${l.ledgerId}`}
                data-testid="coa-ledger"
                className="row-link text-slate-600"
                onClick={() => nav(`/company/${cid}/reports/ledger-vouchers`, { state: { ledgerId: l.ledgerId } })}
              >
                <td>
                  <span className="inline-flex items-center gap-1.5" style={{ paddingLeft: depth * 16 + 24 }}>
                    <span className="w-4 shrink-0" aria-hidden />
                    <span>{l.name}</span>
                  </span>
                </td>
                <td className="num">{drCr(l.opening)}</td>
                <td className="num">{drCr(l.debit)}</td>
                <td className="num">{drCr(l.credit)}</td>
                <td className="num">{drCr(l.closing)}</td>
              </tr>
            ))}
          {open && renderRows(kids, depth + 1)}
        </Fragment>
      );
    });

  return (
    <div className="card p-4">
      <ReportActions
        name="chart-of-accounts"
        meta={meta}
        headers={["Level", "Particulars", "Opening", "Debit", "Credit", "Closing"]}
        rows={coaCsv}
      />
      <div className="flex items-center gap-3 mb-3 flex-wrap print:hidden">
        <input
          data-testid="coa-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Type to filter — ledgers & groups…"
          className="min-w-[260px]"
        />
        {filter && (
          <button data-testid="coa-clear" className="btn-ghost text-sm" onClick={() => setFilter("")}>
            Clear
          </button>
        )}
        <span className="text-xs text-slate-400">{q ? "filtered — every group and ledger matching" : "every group and ledger, with period balances"}</span>
        <span className="flex-1" />
        <span className="text-xs text-slate-400">
          {fmtDate(data.period?.from)} → {fmtDate(data.period?.to)}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="report-table" data-testid="coa-tree">
          <thead>
            <tr>
              <th className="text-left">Particulars</th>
              <th className="w-28 text-right">Opening</th>
              <th className="w-28 text-right">Debit</th>
              <th className="w-28 text-right">Credit</th>
              <th className="w-28 text-right">Closing</th>
            </tr>
          </thead>
          <tbody>{renderRows(data.groups ?? [], 0)}</tbody>
        </table>
      </div>
    </div>
  );
}
