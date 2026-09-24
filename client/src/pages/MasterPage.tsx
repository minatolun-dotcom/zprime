import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Shell from "../components/Shell";
import { Card, ErrorBanner, Field, PageHead } from "../components/ui";
import { get, post, put, del } from "../lib/api";
import { useCompany } from "../store";
import { useHotkeys } from "../lib/hotkeys";
import { num } from "../lib/format";

type FieldType = "text" | "number" | "date" | "select" | "checkbox" | "textarea";
interface FieldDef {
  name: string; label: string; type: FieldType;
  options?: { value: string | number; label: string }[];
  optionsFrom?: "ledgers" | "units" | "stock-groups" | "stock-categories" | "groups" | "tds-sections" | "tcs-sections" | "employees";
  required?: boolean; hint?: string; full?: boolean;
}
interface KindConfig {
  title: string; endpoint: string; fields: FieldDef[];
  columns: { key: string; label: string; sub?: string }[];
  newRow: () => any;
  canCreate?: boolean;
}

const bool = (v: any) => v === true || v === "true" || v === "Yes";

export default function MasterPage() {
  const { cid, kind } = useParams();
  const qc = useQueryClient();
  const { company } = useCompany();
  const config = CONFIGS(kind ?? "", company?.financialYearStart ?? "");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<any | null>(null); // null = closed, {} = new
  const [form, setForm] = useState<any>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: rows } = useQuery({
    queryKey: [kind, cid],
    queryFn: () => get<any[]>(`/api/c/${cid}/${config.endpoint}`),
  });

  const { data: groupTree } = useQuery({
    queryKey: ["group-tree", cid],
    queryFn: () => get<any[]>(`/api/c/${cid}/group-tree`),
  });

  const { data: ledgerOpts } = useQuery({
    queryKey: ["ledger-opts", cid],
    queryFn: () => get<any[]>(`/api/c/${cid}/ledgers`),
    enabled: config.fields.some((f) => f.optionsFrom === "ledgers"),
  });
  const { data: unitOpts } = useQuery({
    queryKey: ["units", cid],
    queryFn: () => get<any[]>(`/api/c/${cid}/units`),
    enabled: config.fields.some((f) => f.optionsFrom === "units"),
  });
  const { data: sgOpts } = useQuery({
    queryKey: ["stock-groups", cid],
    queryFn: () => get<any[]>(`/api/c/${cid}/stock-groups`),
    enabled: config.fields.some((f) => f.optionsFrom === "stock-groups"),
  });
  const { data: scOpts } = useQuery({
    queryKey: ["stock-categories", cid],
    queryFn: () => get<any[]>(`/api/c/${cid}/stock-categories`),
    enabled: config.fields.some((f) => f.optionsFrom === "stock-categories"),
  });
  const { data: tdsOpts } = useQuery({
    queryKey: ["tds-sections", cid],
    queryFn: () => get<any[]>(`/api/c/${cid}/tds-sections`),
    enabled: config.fields.some((f) => f.optionsFrom === "tds-sections"),
  });
  const { data: tcsOpts } = useQuery({
    queryKey: ["tcs-sections", cid],
    queryFn: () => get<any[]>(`/api/c/${cid}/tcs-sections`),
    enabled: config.fields.some((f) => f.optionsFrom === "tcs-sections"),
  });

  const resolvedFields = useMemo(() => {
    return config.fields.map((f) => {
      if (!f.optionsFrom) return f;
      let options: { value: string | number; label: string }[] = [];
      if (f.optionsFrom === "groups") {
        const flat: { value: number; label: string }[] = [];
        const walk = (nodes: any[], depth: number) =>
          nodes.forEach((n) => {
            flat.push({ value: n.id, label: "\u00a0".repeat(depth * 3) + n.name });
            walk(n.children ?? [], depth + 1);
          });
        walk(groupTree ?? [], 0);
        options = flat;
      }
      if (f.optionsFrom === "ledgers") options = (ledgerOpts ?? []).map((l) => ({ value: l.id, label: l.name }));
      if (f.optionsFrom === "units") options = (unitOpts ?? []).map((u) => ({ value: u.id, label: `${u.symbol} (${u.name})` }));
      if (f.optionsFrom === "stock-groups") options = (sgOpts ?? []).map((g) => ({ value: g.id, label: g.name }));
      if (f.optionsFrom === "stock-categories") options = (scOpts ?? []).map((g) => ({ value: g.id, label: g.name }));
      if (f.optionsFrom === "tds-sections") options = [{ value: "", label: "— None —" }, ...(tdsOpts ?? []).map((s) => ({ value: s.id, label: `${s.section} (${s.rate}%)` }))];
      if (f.optionsFrom === "tcs-sections") options = [{ value: "", label: "— None —" }, ...(tcsOpts ?? []).map((s) => ({ value: s.id, label: `${s.section} (${s.rate}%)` }))];
      return { ...f, options };
    });
  }, [config, ledgerOpts, unitOpts, sgOpts, scOpts, tdsOpts, tcsOpts]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let list = rows ?? [];
    if (q) list = list.filter((r) => ((r.name ?? r.section ?? "") as string).toLowerCase().includes(q));
    return list;
  }, [rows, search]);

  useEffect(() => {
    if (editing) {
      const next: any = {};
      for (const f of config.fields) {
        const v = editing[f.name];
        next[f.name] = f.type === "checkbox" ? bool(v) : v ?? "";
      }
      setForm(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  // v1.50.1: claim Esc ONLY while the slide-over editor is open. A permanent
  // Esc claim starved Shell's history-back — Esc on the master list did
  // nothing (operator report). Same pattern as VoucherScreen's quick-create
  // modal: the map omits Escape when no modal is open, so the key falls
  // through to Shell (history-back / Gateway last stop).
  useHotkeys({
    ...(editing ? { Escape: (e) => { e.preventDefault(); setEditing(null); } } : {}),
  }, [editing]);

  const openNew = () => {
    setEditing(config.newRow());
    setError("");
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload: any = {};
      for (const f of config.fields) {
        let v = form[f.name];
        if (f.type === "number") v = v === "" ? (f.name.includes("opening") ? "0" : null) : String(v);
        if (f.type === "checkbox") v = !!v;
        if (v === "" && f.name !== "name") v = null;
        payload[f.name] = v;
      }
      if (editing?.id) await put(`/api/c/${cid}/${config.endpoint}/${editing.id}`, payload);
      else await post(`/api/c/${cid}/${config.endpoint}`, payload);
      setEditing(null);
      qc.invalidateQueries({ queryKey: [kind, cid] });
      qc.invalidateQueries({ queryKey: ["group-tree", cid] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: any) => {
    if (!confirm(`Delete "${row.name}"?`)) return;
    try {
      await del(`/api/c/${cid}/${config.endpoint}/${row.id}`);
      qc.invalidateQueries({ queryKey: [kind, cid] });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    }
  };

  return (
    <Shell title={config.title} breadcrumb={[{ label: "Gateway", to: `/company/${cid}` }, { label: config.title }]}>
      <PageHead
        title={config.title}
        sub={`${filtered.length} records`}
        actions={
          <div className="flex items-center gap-2">
            <input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <button className="btn-primary" onClick={openNew}>+ New</button>
          </div>
        }
      />
      <ErrorBanner error={error} />

      <Card>
        <table className="report-table">
          <thead>
            <tr>
              <th className="w-8">#</th>
              {config.columns.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
              <th className="w-16"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={r.id} className="row-link" onClick={() => setEditing(r)}>
                <td className="text-slate-400">{i + 1}</td>
                {config.columns.map((c) => (
                  <td key={c.key} className={c.sub === "num" ? "num" : ""}>
                    {c.sub === "num" ? (Math.abs(num(r[c.key])) < 0.005 ? "" : num(r[c.key]).toLocaleString("en-IN")) : r[c.key] ?? ""}
                  </td>
                ))}
                <td className="text-right">
                  <button className="btn-danger text-xs leading-none px-2.5 py-2" onClick={(e) => { e.stopPropagation(); remove(r); }}>Del</button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={config.columns.length + 2} className="text-center text-slate-400 py-6">No records</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      {editing !== null && (
        <div className="fixed inset-0 z-40 flex">
          <div className="flex-1 bg-black/30" onClick={() => setEditing(null)} />
          <form onSubmit={save} className="w-[430px] max-w-full bg-white shadow-raised overflow-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold tracking-tight">{editing.id ? "Alter" : "Create"} — {config.title}</h2>
              <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>✕</button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {resolvedFields.map((f) => (
                <div key={f.name} className={f.full ? "col-span-2" : ""}>
                  <Field label={f.label} hint={f.hint}>
                    {f.type === "select" ? (
                      <select
                        className="w-full"
                        required={f.required}
                        value={form[f.name] ?? ""}
                        onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
                      >
                        <option value="">— Select —</option>
                        {(f.options ?? []).map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    ) : f.type === "checkbox" ? (
                      <input
                        type="checkbox"
                        className="mt-1 w-4 h-4"
                        checked={!!form[f.name]}
                        onChange={(e) => setForm({ ...form, [f.name]: e.target.checked })}
                      />
                    ) : (
                      <input
                        className="w-full"
                        type={f.type === "number" ? "number" : f.type === "date" ? "date" : f.type === "textarea" ? undefined : f.type}
                        step={f.type === "number" ? "any" : undefined}
                        required={f.required}
                        value={form[f.name] ?? ""}
                        onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
                      />
                    )}
                  </Field>
                </div>
              ))}
            </div>
            <div className="mt-5 flex items-center gap-2">
              <button disabled={saving} className="btn-primary">{editing.id ? "Alter (Ctrl+S)" : "Create"}</button>
              <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
            </div>
            {kind === "ledgers" && editing.id === undefined && (
              <p className="mt-4 text-xs text-slate-500 leading-relaxed">Tip: create party ledgers under Sundry Debtors / Sundry Creditors with GSTIN + bill-wise on.</p>
            )}
            <Link to={`/company/${cid}`} className="block mt-6 text-sm text-indigo-600 hover:underline">← Back to Gateway</Link>
          </form>
        </div>
      )}
    </Shell>
  );
}

// ---- per-kind configurations ----

function CONFIGS(kind: string, _fy: string): KindConfig {
  const ledgerFields: FieldDef[] = [
    { name: "name", label: "Name *", type: "text", required: true },
    { name: "groupId", label: "Under Group *", type: "select", optionsFrom: "groups", required: true },
    { name: "openingBalance", label: "Opening Balance", type: "number", hint: "+ = Dr, − = Cr" },
    { name: "billWise", label: "Bill-wise Details", type: "checkbox" },
    { name: "gstin", label: "GSTIN", type: "text" },
    { name: "gstRegistrationType", label: "GST Registration", type: "select", options: [
      { value: "regular", label: "Regular" }, { value: "composition", label: "Composition" },
      { value: "unregistered", label: "Unregistered" }, { value: "consumer", label: "Consumer" },
      { value: "none", label: "None" },
    ] },
    { name: "taxability", label: "Taxability", type: "select", options: [
      { value: "taxable", label: "Taxable" }, { value: "exempt", label: "Exempt" },
      { value: "nil", label: "Nil Rated" }, { value: "none", label: "None" },
    ] },
    { name: "hsnSac", label: "HSN / SAC", type: "text" },
    { name: "gstRate", label: "GST Rate %", type: "number" },
    { name: "dutyHead", label: "Duty Head", type: "select", options: [
      { value: "", label: "—" }, { value: "IGST", label: "IGST" }, { value: "CGST", label: "CGST" },
      { value: "SGST", label: "SGST/UTGST" }, { value: "CESS", label: "CESS" }, { value: "TDS", label: "TDS" },
      { value: "RCM", label: "RCM (Reverse Charge)" },
    ] },
    { name: "isBankCash", label: "Bank / Cash Account", type: "checkbox" },
    { name: "bankAccountNumber", label: "Bank A/c No.", type: "text" },
    { name: "chequeEnabled", label: "Cheque Printing", type: "checkbox" },
    { name: "chequePayerName", label: "A/c Payee Name (cheque)", type: "text" },
    { name: "tdsSectionId", label: "TDS Section (expense)", type: "select", optionsFrom: "tds-sections" },
    { name: "tcsSectionId", label: "TCS Section (party)", type: "select", optionsFrom: "tcs-sections" },
    { name: "partyAddress", label: "Party Address", type: "textarea", full: true },
    { name: "partyState", label: "Party State", type: "text" },
    { name: "partyPincode", label: "Party PIN Code", type: "text", hint: "6-digit; required for e-invoice payloads" },
    { name: "partyPhone", label: "Phone", type: "text" },
    { name: "partyEmail", label: "Email", type: "text" },
  ];

  const configs: Record<string, KindConfig> = {
    ledgers: {
      title: "Ledgers", endpoint: "ledgers", fields: ledgerFields,
      columns: [{ key: "name", label: "Name" }, { key: "openingBalance", label: "Opening", sub: "num" }],
      newRow: () => ({ gstRegistrationType: "none", taxability: "none" }),
    },
    groups: {
      title: "Groups", endpoint: "groups",
      fields: [
        { name: "name", label: "Name *", type: "text", required: true },
        { name: "parentId", label: "Under Group", type: "select", optionsFrom: "groups", hint: "Nature is inherited from the parent group" },
        { name: "nature", label: "Nature", type: "select", options: [
          { value: "Assets", label: "Assets" }, { value: "Liabilities", label: "Liabilities" },
          { value: "Income", label: "Income" }, { value: "Expenses", label: "Expenses" },
        ], hint: "Required only for top-level groups (no parent)" },
      ],
      columns: [{ key: "name", label: "Name" }, { key: "nature", label: "Nature" }],
      newRow: () => ({}),
      canCreate: true,
    },
    "stock-items": {
      title: "Stock Items", endpoint: "stock-items",
      fields: [
        { name: "name", label: "Name *", type: "text", required: true },
        { name: "unitId", label: "Unit *", type: "select", optionsFrom: "units", required: true },
        { name: "hsnSac", label: "HSN / SAC", type: "text" },
        { name: "gstRate", label: "GST Rate %", type: "number" },
        { name: "taxability", label: "Taxability", type: "select", options: [
          { value: "taxable", label: "Taxable" }, { value: "exempt", label: "Exempt" }, { value: "nil", label: "Nil Rated" },
        ] },
        { name: "costingMethod", label: "Costing", type: "select", options: [
          { value: "weighted_avg", label: "Weighted Average" }, { value: "fifo", label: "FIFO" },
        ] },
        { name: "standardSalePrice", label: "Std. Sale Price", type: "number" },
        { name: "standardCost", label: "Std. Cost", type: "number" },
        { name: "openingQty", label: "Opening Qty", type: "number" },
        { name: "openingRate", label: "Opening Rate", type: "number" },
        { name: "openingValue", label: "Opening Value", type: "number" },
        { name: "minQty", label: "Reorder Min Qty", type: "number" },
      ],
      columns: [{ key: "name", label: "Item" }, { key: "gstRate", label: "GST %", sub: "num" }, { key: "openingQty", label: "Op. Qty", sub: "num" }],
      newRow: () => ({ gstRate: "18", taxability: "taxable", costingMethod: "weighted_avg" }),
    },
    units: {
      title: "Units of Measure", endpoint: "units",
      fields: [
        { name: "name", label: "Description *", type: "text", required: true },
        { name: "symbol", label: "Symbol *", type: "text", required: true },
        { name: "decimalPlaces", label: "Decimals", type: "number" },
      ],
      columns: [{ key: "symbol", label: "Symbol" }, { key: "name", label: "Description" }],
      newRow: () => ({ decimalPlaces: 0 }),
    },
    "stock-groups": {
      title: "Stock Groups", endpoint: "stock-groups",
      fields: [{ name: "name", label: "Name *", type: "text", required: true }],
      columns: [{ key: "name", label: "Name" }],
      newRow: () => ({}),
    },
    "stock-categories": {
      title: "Stock Categories", endpoint: "stock-categories",
      fields: [{ name: "name", label: "Name *", type: "text", required: true }],
      columns: [{ key: "name", label: "Name" }],
      newRow: () => ({}),
    },
    godowns: {
      title: "Godowns / Locations", endpoint: "godowns",
      fields: [{ name: "name", label: "Name *", type: "text", required: true }],
      columns: [{ key: "name", label: "Name" }],
      newRow: () => ({}),
    },
    "voucher-types": {
      title: "Voucher Types", endpoint: "voucher-types",
      fields: [
        { name: "name", label: "Name *", type: "text", required: true },
        { name: "shortCode", label: "Short Code", type: "text" },
        { name: "category", label: "Category", type: "select", options: [
          { value: "Accounting", label: "Accounting" }, { value: "Inventory", label: "Inventory" }, { value: "Payroll", label: "Payroll" },
        ] },
        { name: "numbering", label: "Numbering", type: "select", options: [
          { value: "automatic", label: "Automatic" }, { value: "manual", label: "Manual" },
        ] },
        { name: "prefix", label: "Prefix", type: "text" },
        { name: "suffix", label: "Suffix", type: "text" },
        { name: "startNumber", label: "Start Number", type: "number" },
        { name: "affectsStock", label: "Affects Stock", type: "checkbox" },
      ],
      columns: [{ key: "name", label: "Name" }, { key: "category", label: "Category" }],
      newRow: () => ({ category: "Accounting", numbering: "automatic", startNumber: 1 }),
    },
    "tds-sections": {
      title: "TDS Sections", endpoint: "tds-sections",
      fields: [
        { name: "section", label: "Section *", type: "text", required: true, hint: "e.g. 194C" },
        { name: "description", label: "Description", type: "text", full: true },
        { name: "rate", label: "TDS Rate %", type: "number" },
        { name: "threshold", label: "Threshold ₹", type: "number" },
        { name: "thresholdMode", label: "Threshold Mode (advisory)", type: "select", options: [
          { value: "", label: "— Advisory wording only —" },
          { value: "aggregate", label: "Aggregate per payee per FY (e.g. 194J ₹50k)" },
          { value: "single", label: "Single payment (e.g. 194C ₹30k per payment)" },
        ], hint: "Drives the wording of non-blocking advisories — TDS is never auto-applied or refused" },
      ],
      columns: [{ key: "section", label: "Section" }, { key: "rate", label: "Rate %", sub: "num" }],
      newRow: () => ({ rate: "0", threshold: "0" }),
    },
    "tcs-sections": {
      title: "TCS Sections", endpoint: "tcs-sections",
      fields: [
        { name: "section", label: "Section *", type: "text", required: true, hint: "e.g. 206C(1H)" },
        { name: "description", label: "Description", type: "text", full: true },
        { name: "rate", label: "TCS Rate %", type: "number" },
        { name: "threshold", label: "Threshold ₹ (reference)", type: "number" },
        { name: "thresholdMode", label: "Threshold Mode (advisory)", type: "select", options: [
          { value: "", label: "— Advisory wording only —" },
          { value: "aggregate", label: "Aggregate per buyer per FY (e.g. 206C(1H) ₹50L)" },
          { value: "single", label: "Single receipt" },
        ], hint: "Drives the wording of non-blocking advisories — TCS is never auto-applied or refused" },
      ],
      columns: [{ key: "section", label: "Section" }, { key: "rate", label: "Rate %", sub: "num" }],
      newRow: () => ({ rate: "0", threshold: "0" }),
    },
    employees: {
      title: "Employees", endpoint: "employees",
      fields: [
        { name: "name", label: "Name *", type: "text", required: true },
        { name: "designation", label: "Designation", type: "text" },
        { name: "joinDate", label: "Joining Date", type: "date" },
        { name: "pan", label: "PAN", type: "text" },
        { name: "bankName", label: "Bank", type: "text" },
        { name: "bankAccount", label: "Bank A/c No.", type: "text" },
        { name: "isActive", label: "Active", type: "checkbox" },
      ],
      columns: [{ key: "name", label: "Name" }, { key: "designation", label: "Designation" }],
      newRow: () => ({ isActive: true }),
    },
    "pay-heads": {
      title: "Pay Heads", endpoint: "pay-heads",
      fields: [
        { name: "name", label: "Name *", type: "text", required: true },
        { name: "type", label: "Type", type: "select", options: [
          { value: "earning", label: "Earning" }, { value: "deduction", label: "Deduction" }, { value: "employer_contribution", label: "Employer Contribution" },
        ] },
        { name: "ledgerId", label: "Post To Ledger *", type: "select", optionsFrom: "ledgers", required: true },
        { name: "affectsGross", label: "Affects Gross", type: "checkbox" },
      ],
      columns: [{ key: "name", label: "Pay Head" }, { key: "type", label: "Type" }],
      newRow: () => ({ type: "earning", affectsGross: true }),
    },
  };

  const cfg = configs[kind];
  if (cfg) return cfg;
  return { title: kind, endpoint: kind, fields: [], columns: [{ key: "name", label: "Name" }], newRow: () => ({}) };
}
