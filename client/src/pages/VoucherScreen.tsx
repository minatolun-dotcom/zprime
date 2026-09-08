import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Shell, { FKeyButton } from "../components/Shell";
import TypeAhead, { Option } from "../components/TypeAhead";
import { ErrorBanner } from "../components/ui";
import { get, post, put } from "../lib/api";
import { useCompany } from "../store";
import { useHotkeys } from "../lib/hotkeys";
import { num, r2, today, fmtDate } from "../lib/format";

interface LedgerRow { ledgerId: number | null; ledgerName: string; amount: number; againstBill?: string; tdsSectionId?: number | null; }
interface InvRow { itemId: number | null; itemName: string; godownId: number | null; qty: number; rate: number; amount: number; kind: string; }
interface VoucherType { id: number; name: string; category: string; affectsStock: boolean; shortCode: string; }

const PARTY_TYPES = ["Sales", "Purchase", "Credit Note", "Debit Note"];
const STOCK_FLOW: Record<string, 1 | -1> = { Sales: -1, "Delivery Note": -1, "Credit Note": 1, Purchase: 1, "Receipt Note": 1, "Debit Note": -1 };

export default function VoucherScreen() {
  const { cid, typeId, voucherId } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { company } = useCompany();
  const isEdit = Boolean(voucherId);

  const [vType, setVType] = useState<VoucherType | null>(null);
  const [date, setDate] = useState(today());
  const [number, setNumber] = useState("");
  const [numberLocked, setNumberLocked] = useState(false);
  const [reference, setReference] = useState("");
  const [refDate, setRefDate] = useState("");
  const [narration, setNarration] = useState("");
  const [party, setParty] = useState<{ id: number | null; name: string }>({ id: null, name: "" });
  const [entries, setEntries] = useState<LedgerRow[]>([{ ledgerId: null, ledgerName: "", amount: 0 }]);
  const [inv, setInv] = useState<InvRow[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [detailed, setDetailed] = useState(true);

  const ledgerInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const { data: allLedgers } = useQuery({ queryKey: ["all-ledgers", cid], queryFn: () => get<any[]>(`/api/c/${cid}/ledgers`) });
  const { data: allItems } = useQuery({ queryKey: ["all-items", cid], queryFn: () => get<any[]>(`/api/c/${cid}/stock-items`) });
  const { data: godowns } = useQuery({ queryKey: ["godowns", cid], queryFn: () => get<any[]>(`/api/c/${cid}/godowns`) });
  const { data: tdsSections } = useQuery({ queryKey: ["tds-sections", cid], queryFn: () => get<any[]>(`/api/c/${cid}/tds-sections`) });

  const ledgerOptions: Option[] = (allLedgers ?? []).map((l) => ({ id: l.id, name: l.name }));
  const itemOptions: Option[] = (allItems ?? []).map((l) => ({ id: l.id, name: l.name }));
  const ledgerById = useMemo(() => new Map((allLedgers ?? []).map((l: any) => [l.id, l])), [allLedgers]);

  // Load type (new) or full voucher (edit)
  useEffect(() => {
    (async () => {
      try {
        if (isEdit) {
          const v = await get<any>(`/api/c/${cid}/vouchers/${voucherId}`);
          setVType(v.type);
          setDate(v.date.slice(0, 10));
          setNumber(v.number);
          setNumberLocked(true);
          setReference(v.reference ?? "");
          setRefDate(v.refDate ? v.refDate.slice(0, 10) : "");
          setNarration(v.narration ?? "");
          const rows: LedgerRow[] = v.entries.map((e: any) => ({
            ledgerId: e.ledgerId, ledgerName: e.ledgerName, amount: num(e.amount),
            tdsSectionId: e.tdsSectionId,
            againstBill: e.bills?.find((b: any) => b.billType === "against_ref")?.billName ?? "",
          }));
          setEntries(rows.length ? rows : [{ ledgerId: null, ledgerName: "", amount: 0 }]);
          if (v.partyLedgerId) {
            const pl = v.entries.find((e: any) => e.ledgerId === v.partyLedgerId);
            setParty({ id: v.partyLedgerId, name: pl?.ledgerName ?? "" });
          }
          const items: InvRow[] = (v.inventoryEntries ?? []).map((e: any) => ({
            itemId: e.itemId, itemName: itemOptions.find((i) => i.id === e.itemId)?.name ?? `#${e.itemId}`,
            godownId: e.godownId, qty: num(e.qty), rate: num(e.rate), amount: num(e.amount), kind: e.kind,
          }));
          setInv(items);
        } else {
          const t = await get<VoucherType>(`/api/c/${cid}/voucher-types/${typeId}`);
          setVType(t);
          const next = await get<{ number: string }>(`/api/c/${cid}/vouchers/next-number?voucherTypeId=${t.id}`);
          setNumber(next.number);
          if (t.affectsStock) setInv([newInvRow()]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Load failed");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, typeId, voucherId]);

  function newInvRow(): InvRow {
    return { itemId: null, itemName: "", godownId: null, qty: 0, rate: 0, amount: 0, kind: "stock" };
  }

  const hasParty = vType ? PARTY_TYPES.includes(vType.name) : false;
  const isStockJournal = vType ? ["Stock Journal", "Manufacturing Journal"].includes(vType.name) : false;
  const isPhysical = vType?.name === "Physical Stock";
  const sign = vType ? (STOCK_FLOW[vType.name] ?? 0) : 0;

  const totalDr = r2(entries.reduce((s, e) => s + Math.max(e.amount, 0), 0));
  const totalCr = r2(entries.reduce((s, e) => s + Math.max(-e.amount, 0), 0));
  const diff = r2(totalDr - totalCr);

  // ---- GST helper ----
  const companyStateCode = company?.gstin?.slice(0, 2) ?? company?.stateCode ?? "";
  const partyLedger = party.id ? ledgerById.get(party.id) : null;
  const partyStateCode = (partyLedger?.gstin ? String(partyLedger.gstin).slice(0, 2) : "") || "";

  const applyGst = () => {
    if (!vType || !["Sales", "Purchase", "Credit Note", "Debit Note"].includes(vType.name)) return;
    const isSalesSide = ["Sales", "Credit Note"].includes(vType.name);
    const rateLedgers = entries.filter((e) => {
      const l = e.ledgerId ? ledgerById.get(e.ledgerId) : null;
      if (!l || l.dutyHead) return false;
      return isSalesSide ? e.amount > 0 : e.amount < 0;
    });
    const taxable = r2(rateLedgers.reduce((s, e) => s + Math.abs(e.amount), 0));
    if (taxable <= 0) { setError("Add taxable income/expense lines before applying GST"); return; }

    // Determine rates: from entries snapshot or ledger default
    const rates = new Set<number>();
    for (const e of rateLedgers) {
      const l = e.ledgerId ? ledgerById.get(e.ledgerId) : null;
      if (l?.gstRate) rates.add(num(l.gstRate));
    }
    if (rates.size === 0) rates.add(18);
    if (rates.size > 1) { setError("Multiple GST rates on lines — add tax ledgers manually"); return; }
    const rate = [...rates][0];
    const gst = r2((taxable * rate) / 100);

    // strip existing duty rows
    const base = entries.filter((e) => {
      const l = e.ledgerId ? ledgerById.get(e.ledgerId) : null;
      return !(l?.dutyHead && l.dutyHead !== "TDS");
    });
    const dutyOf = (head: string) => {
      const found = (allLedgers ?? []).find((l: any) => l.dutyHead === head);
      return found;
    };
    const rows = [...base];
    const inter = partyStateCode && companyStateCode && partyStateCode !== companyStateCode;
    if (inter) {
      const ig = dutyOf("IGST");
      if (ig) rows.push({ ledgerId: ig.id, ledgerName: ig.name, amount: vType.name === "Sales" || vType.name === "Credit Note" ? -gst : gst });
    } else {
      const cg = dutyOf("CGST"); const sg = dutyOf("SGST/UTGST");
      const half = r2(gst / 2);
      if (cg) rows.push({ ledgerId: cg.id, ledgerName: cg.name, amount: vType.name === "Sales" || vType.name === "Credit Note" ? -half : half });
      if (sg) rows.push({ ledgerId: sg.id, ledgerName: sg.name, amount: vType.name === "Sales" || vType.name === "Credit Note" ? -(gst - half) : gst - half });
    }
    setEntries(rows);
    setError("");
  };

  // ---- TDS helper ----
  const applyTds = () => {
    const withTds = entries.filter((e) => {
      const l = e.ledgerId ? ledgerById.get(e.ledgerId) : null;
      return l?.tdsSectionId;
    });
    if (withTds.length === 0) { setError("No expense line has a TDS section (set it on the expense ledger)"); return; }
    const tdsLedger = (allLedgers ?? []).find((l: any) => l.dutyHead === "TDS");
    if (!tdsLedger) { setError("Create a 'TDS Payable' ledger under Duties & Taxes with Duty Head = TDS"); return; }
    const base = entries.filter((e) => {
      const l = e.ledgerId ? ledgerById.get(e.ledgerId) : null;
      return !(l?.dutyHead === "TDS");
    });
    for (const e of withTds) {
      const l = ledgerById.get(e.ledgerId!);
      const sec = (tdsSections ?? []).find((s: any) => s.id === l?.tdsSectionId);
      const rate = num(sec?.rate ?? 0);
      const amount = r2((Math.abs(e.amount) * rate) / 100);
      if (amount > 0) base.push({ ledgerId: tdsLedger.id, ledgerName: tdsLedger.name, amount: -amount, tdsSectionId: sec?.id ?? null });
    }
    setEntries(base);
    setError("");
  };

  // ---- save ----
  const save = async () => {
    setError("");
    if (Math.abs(diff) > 0.004) { setError(`Voucher does not balance — difference ${diff.toFixed(2)}`); return; }
    const validEntries = entries.filter((e) => e.ledgerId && Math.abs(e.amount) > 0.004);
    if (validEntries.length === 0) { setError("Add at least one ledger entry"); return; }

    const payload: any = {
      voucherTypeId: vType!.id,
      date,
      number: numberLocked ? number : undefined,
      reference: reference || null,
      refDate: refDate || null,
      narration,
      partyLedgerId: hasParty && party.id ? party.id : null,
      entries: validEntries.map((e, i) => {
        const l = e.ledgerId ? ledgerById.get(e.ledgerId) : null;
        const isPartyRow = hasParty && e.ledgerId === party.id;
        const bills: any[] = [];
        if (l?.billWise) {
          if (isPartyRow && ["Sales", "Purchase", "Credit Note", "Debit Note"].includes(vType!.name)) {
            bills.push({ billType: "new_ref", billName: number || `${date}-${i}`, amount: e.amount, dueDate: refDate || null });
          } else if (e.againstBill) {
            bills.push({ billType: "against_ref", billName: e.againstBill, amount: e.amount, dueDate: null });
          } else {
            bills.push({ billType: "on_account", billName: "On Account", amount: e.amount, dueDate: null });
          }
        }
        return {
          ledgerId: e.ledgerId, amount: e.amount,
          gstRate: l?.gstRate != null ? num(l.gstRate) : null,
          hsnSac: l?.hsnSac ?? null,
          tdsSectionId: e.tdsSectionId ?? null,
          bills,
        };
      }),
      inventoryEntries: inv
        .filter((r) => r.itemId)
        .map((r) => ({
          itemId: r.itemId, godownId: r.godownId,
          qty: isPhysical ? Math.abs(r.qty) : r.kind === "source" ? -Math.abs(r.qty) : r.kind === "target" ? Math.abs(r.qty) : sign ? Math.abs(r.qty) * sign : r.qty,
          rate: r.rate, amount: r2(Math.abs(r.qty) * r.rate),
          kind: isPhysical ? "physical" : isStockJournal ? r.kind : "stock",
          hsnSac: null, gstRate: null,
        })),
    };

    setSaving(true);
    try {
      if (isEdit) await put(`/api/c/${cid}/vouchers/${voucherId}`, payload);
      else await post(`/api/c/${cid}/vouchers`, payload);
      qc.invalidateQueries({ queryKey: ["vouchers"] });
      qc.invalidateQueries({ queryKey: ["daybook"] });
      nav(`/company/${cid}/daybook`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  useHotkeys({
    "Ctrl+A": () => save(),
    Escape: () => nav(`/company/${cid}/daybook`),
    "Alt+F1": () => setDetailed(!detailed),
  }, [entries, inv, date, number, reference, narration, party, diff, vType]);

  const fkeys: FKeyButton[] = [
    { key: "Ctrl+A", label: "Accept / Save", onClick: save },
    { key: "F2", label: "Date", onClick: () => (document.getElementById("v-date") as HTMLInputElement)?.focus() },
    ...(hasParty ? [{ key: "F12", label: "Ref / Party", onClick: () => (document.getElementById("v-ref") as HTMLInputElement)?.focus() }] : []),
    ...(vType && ["Sales", "Purchase", "Credit Note", "Debit Note"].includes(vType.name) ? [{ key: "Alt+G", label: "Apply GST" }] : []),
    ...(vType?.category === "Accounting" ? [{ key: "Alt+T", label: "Deduct TDS" }] : []),
    { key: "Esc", label: "Quit (Day Book)", onClick: () => nav(`/company/${cid}/daybook`) },
  ];

  return (
    <Shell
      title={vType ? `${vType.name} Voucher` : "Voucher"}
      breadcrumb={[{ label: "Gateway", to: `/company/${cid}` }, { label: "Day Book", to: `/company/${cid}/daybook` }, { label: vType ? `${vType.name} ${isEdit ? "Alter" : "Create"}` : "…" }]}
      fkeys={fkeys}
    >
      <ErrorBanner error={error} />
      {!vType ? (
        <div className="text-slate-400 text-[13px]">Loading…</div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 max-w-4xl">
          {/* header */}
          <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-100 bg-slate-50 rounded-t-lg">
            <span className="text-[14px] font-semibold text-indigo-700">{vType.name}</span>
            <span className="text-[12px] text-slate-400">No.</span>
            <input className="w-32" value={number} onChange={(e) => setNumber(e.target.value)} />
            <span className="text-[12px] text-slate-400 ml-2">Date (F2)</span>
            <input id="v-date" type="date" className="w-36" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>

          <div className="px-4 py-3 space-y-4">
            {/* party for trading vouchers */}
            {hasParty && (
              <div className="grid grid-cols-[130px_1fr_130px_1fr] gap-2 items-center">
                <span className="text-[12px] font-medium text-slate-600">Party A/c</span>
                <TypeAhead items={ledgerOptions} value={party.name} onPick={(o) => {
                  if (!o) { setParty({ id: null, name: "" }); return; }
                  setParty({ id: o.id, name: o.name });
                  // ensure a party row exists at the top of the entries grid
                  setEntries((rows) => {
                    const withoutParty = rows.filter((r) => r.ledgerId !== o.id);
                    const oldPartyRow = rows.find((r) => r.ledgerId === o.id);
                    return [{ ledgerId: o.id, ledgerName: o.name, amount: oldPartyRow?.amount ?? 0 }, ...withoutParty];
                  });
                }} />
                <span className="text-[12px] font-medium text-slate-600">Invoice No.</span>
                <input id="v-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Party invoice no." />
              </div>
            )}
            {hasParty && (
              <div className="grid grid-cols-[130px_1fr_130px_1fr] gap-2 items-center">
                <span className="text-[12px] font-medium text-slate-600">Ref Date</span>
                <input type="date" value={refDate} onChange={(e) => setRefDate(e.target.value)} />
                <span className="text-[12px] text-slate-400" />
                <span />
              </div>
            )}

            {/* inventory grid */}
            {(vType.affectsStock || isStockJournal || isPhysical) && (
              <div>
                <div className="text-[12px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
                  {isPhysical ? "Physical Stock (counted qty)" : isStockJournal ? "Stock Journal (consumption / production)" : "Inventory"}
                </div>
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      {detailed && <th className="w-28">Godown</th>}
                      {isStockJournal && <th className="w-24">Type</th>}
                      <th className="w-24 text-right">Qty</th>
                      <th className="w-24 text-right">Rate</th>
                      <th className="w-28 text-right">Amount</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {inv.map((row, i) => (
                      <tr key={i}>
                        <td>
                          <TypeAhead items={itemOptions} value={row.itemName} onPick={(o) => {
                            if (!o) { setInv(inv.map((r, j) => (j === i ? { ...r, itemId: null, itemName: "" } : r))); return; }
                            const item = (allItems ?? []).find((x: any) => x.id === o.id);
                            const defRate = sign > 0 ? num(item?.standardCost) : num(item?.standardSalePrice);
                            setInv(inv.map((r, j) => (j === i ? { ...r, itemId: o.id, itemName: o.name, rate: r.rate || defRate } : r)));
                          }} />
                        </td>
                        {detailed && (
                          <td>
                            <select className="w-full" value={row.godownId ?? ""} onChange={(e) => setInv(inv.map((r, j) => (j === i ? { ...r, godownId: e.target.value ? parseInt(e.target.value, 10) : null } : r)))}>
                              <option value="">—</option>
                              {(godowns ?? []).map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
                            </select>
                          </td>
                        )}
                        {isStockJournal && (
                          <td>
                            <select className="w-full" value={row.kind} onChange={(e) => setInv(inv.map((r, j) => (j === i ? { ...r, kind: e.target.value } : r)))}>
                              <option value="source">Consumption</option>
                              <option value="target">Production</option>
                            </select>
                          </td>
                        )}
                        <td><input className="w-full text-right" type="number" step="any" value={row.qty || ""} onChange={(e) => setInv(inv.map((r, j) => {
                          if (j !== i) return r;
                          const qty = num(e.target.value);
                          return { ...r, qty, amount: r2(Math.abs(qty) * r.rate) };
                        }))} /></td>
                        <td><input className="w-full text-right" type="number" step="any" value={row.rate || ""} onChange={(e) => setInv(inv.map((r, j) => {
                          if (j !== i) return r;
                          const rate = num(e.target.value);
                          return { ...r, rate, amount: r2(Math.abs(r.qty) * rate) };
                        }))} /></td>
                        <td className="num">{row.amount.toLocaleString("en-IN")}</td>
                        <td><button className="text-slate-400 hover:text-red-500" onClick={() => setInv(inv.filter((_, j) => j !== i))}>✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button className="btn-ghost mt-1 text-[12px]" onClick={() => setInv([...inv, newInvRow()])}>+ Add Item</button>
              </div>
            )}

            {/* accounting entries */}
            <div>
              <div className="text-[12px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Ledger Entries</div>
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Ledger</th>
                    {detailed && <th className="w-36">Against Bill</th>}
                    <th className="w-32 text-right">Debit</th>
                    <th className="w-32 text-right">Credit</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((row, i) => {
                    const l = row.ledgerId ? ledgerById.get(row.ledgerId) : null;
                    return (
                      <tr key={i}>
                        <td>
                          <TypeAhead
                            items={ledgerOptions}
                            value={row.ledgerName}
                            inputRef={(el: HTMLInputElement | null) => { ledgerInputRefs.current[i] = el; }}
                            onPick={(o) => {
                              setEntries(entries.map((r, j) => (j === i ? { ...r, ledgerId: o?.id ?? null, ledgerName: o?.name ?? "" } : r)));
                              if (o && i === entries.length - 1) setTimeout(() => ledgerInputRefs.current[i + 1]?.focus(), 0);
                            }}
                          />
                        </td>
                        {detailed && (
                          <td>
                            <input
                              className="w-full"
                              placeholder={l?.billWise ? "bill ref / blank = on account" : "—"}
                              disabled={!l?.billWise}
                              value={row.againstBill ?? ""}
                              onChange={(e) => setEntries(entries.map((r, j) => (j === i ? { ...r, againstBill: e.target.value } : r)))}
                            />
                          </td>
                        )}
                        <td>
                          <input
                            className="w-full text-right"
                            type="number" step="any"
                            value={row.amount > 0 ? row.amount : ""}
                            onChange={(e) => setEntries(entries.map((r, j) => (j === i ? { ...r, amount: Math.abs(num(e.target.value)) } : r)))}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && i === entries.length - 1) {
                                setEntries([...entries, { ledgerId: null, ledgerName: "", amount: 0 }]);
                                setTimeout(() => ledgerInputRefs.current[i + 1]?.focus(), 0);
                              }
                            }}
                          />
                        </td>
                        <td>
                          <input
                            className="w-full text-right"
                            type="number" step="any"
                            value={row.amount < 0 ? -row.amount : ""}
                            onChange={(e) => setEntries(entries.map((r, j) => (j === i ? { ...r, amount: -Math.abs(num(e.target.value)) } : r)))}
                          />
                        </td>
                        <td><button className="text-slate-400 hover:text-red-500" onClick={() => setEntries(entries.length > 1 ? entries.filter((_, j) => j !== i) : entries)}>✕</button></td>
                      </tr>
                    );
                  })}
                  <tr className="font-medium bg-slate-50">
                    <td className="text-right pr-3">Total</td>
                    {detailed && <td />}
                    <td className="num">{totalDr.toLocaleString("en-IN")}</td>
                    <td className="num">{totalCr.toLocaleString("en-IN")}</td>
                    <td className={Math.abs(diff) > 0.004 ? "num text-red-600" : "num text-green-600"}>
                      {Math.abs(diff) > 0.004 ? diff.toFixed(2) : "✓"}
                    </td>
                  </tr>
                </tbody>
              </table>
              <div className="flex gap-2 mt-1">
                <button className="btn-ghost text-[12px]" onClick={() => setEntries([...entries, { ledgerId: null, ledgerName: "", amount: 0 }])}>+ Add Ledger</button>
                {vType && ["Sales", "Purchase", "Credit Note", "Debit Note"].includes(vType.name) && (
                  <button className="btn-ghost text-[12px]" onClick={applyGst}>+ Apply GST</button>
                )}
                {vType?.category === "Accounting" && (
                  <button className="btn-ghost text-[12px]" onClick={applyTds}>− Deduct TDS</button>
                )}
              </div>
            </div>

            {/* narration */}
            <div className="grid grid-cols-[130px_1fr] gap-2 items-center">
              <span className="text-[12px] font-medium text-slate-600">Narration</span>
              <input value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="Being…" />
            </div>

            <div className="flex gap-2 pt-1">
              <button className="btn-primary" disabled={saving} onClick={save}>{isEdit ? "Alter (Ctrl+A)" : "Accept (Ctrl+A)"}</button>
              <button className="btn-ghost" onClick={() => nav(`/company/${cid}/daybook`)}>Cancel (Esc)</button>
              <span className="flex-1" />
              <span className="text-[11px] text-slate-400 self-center">
                Enter on last amount row adds a new line · {fmtDate(date)}
              </span>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
