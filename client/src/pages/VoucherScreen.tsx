import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Shell, { FKeyButton } from "../components/Shell";
import TypeAhead, { Option } from "../components/TypeAhead";
import { ErrorBanner } from "../components/ui";
import { get, post, put, del } from "../lib/api";
import { useCompany } from "../store";
import { useHotkeys } from "../lib/hotkeys";
import { num, r2, today, fmtDate } from "../lib/format";

interface LedgerRow { ledgerId: number | null; ledgerName: string; amount: number; againstBill?: string; tdsSectionId?: number | null; tcsSectionId?: number | null; }
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
  // R-23: reverse charge (s. 9(3)/9(4)) — recipient self-accounts the GST.
  // Offered only on inward voucher types (Purchase / Debit Note).
  const [isRcm, setIsRcm] = useState(false);
  const [party, setParty] = useState<{ id: number | null; name: string }>({ id: null, name: "" });
  const [entries, setEntries] = useState<LedgerRow[]>([{ ledgerId: null, ledgerName: "", amount: 0 }]);
  const [inv, setInv] = useState<InvRow[]>([]);
  const [error, setError] = useState("");
  // R-33: threshold advisories (non-blocking) — populated when applyTds/
  // applyTcs fires; the voucher saves normally regardless.
  const [thresholdAdvisories, setThresholdAdvisories] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  // R-10 (B-10): ref mirror of `saving` — the Ctrl+A hotkey closure must read
  // the live value, not the one captured at effect registration time.
  const savingRef = useRef(false);
  // R-10: one idempotency key per NEW voucher form (stable across save
  // attempts/retries, so a double-accept or network retry replays the original
  // voucher server-side instead of posting a duplicate). Edit saves are
  // naturally idempotent (PUT) and carry no key.
  // F-48-1: crypto.randomUUID is only available in secure contexts (https or
  // localhost) — a LAN/IP deployment throws "crypto.randomUUID is not a
  // function", which killed the whole page white before any render. Fall back
  // to the WebCrypto getRandomValues UUID v4 shape, then to a random-hex key;
  // the server accepts any string ≤200 chars, and a no-key POST is already the
  // documented legacy path (R-10 suite, check 1).
  const idemKeyRef = useRef<string | null>(
    isEdit
      ? null
      : (() => {
          try {
            if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
            if (typeof crypto !== "undefined" && crypto.getRandomValues) {
              const b = crypto.getRandomValues(new Uint8Array(16));
              b[6] = (b[6] & 0x0f) | 0x40; // version 4
              b[8] = (b[8] & 0x3f) | 0x80; // RFC variant
              const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
              return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
            }
          } catch { /* fall through */ }
          return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
        })(),
  );
  const [detailed, setDetailed] = useState(true);
  // R-35: ledger-on-the-fly — quick-create modal state. quickTrigger records
  // which TypeAhead opened the modal so the created ledger is picked back into
  // that exact row (party or entry) without disturbing voucher state.
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickName, setQuickName] = useState("");
  const [quickGroupId, setQuickGroupId] = useState<number | "">("");
  const [quickTaxability, setQuickTaxability] = useState("none");
  const [quickRate, setQuickRate] = useState("");
  const [quickError, setQuickError] = useState("");
  const [quickSaving, setQuickSaving] = useState(false);
  const quickTriggerRef = useRef<{ row: number; kind: "entry" | "party" } | null>(null);
  const quickNameRef = useRef<HTMLInputElement | null>(null);
  const partyInputRef = useRef<HTMLInputElement | null>(null);
  // R-02: a cancelled voucher opened from Day Book is displayed read-only.
  const [cancelledView, setCancelledView] = useState(false);
  // R-18: compact audit history (edit mode only). Silent-degrade on fetch
  // failure — the viewer is convenience, never a security or workflow surface.
  const { data: auditTrail } = useQuery({
    queryKey: ["voucher-audit", cid, voucherId],
    queryFn: () => get<any[]>(`/api/c/${cid}/vouchers/${voucherId}/audit`),
    enabled: isEdit,
    retry: false,
  });

  const ledgerInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // R-43 (F-42-1): the options queries' initial-load flags feed TypeAhead's
  // create-path guard — an empty list during the fetch window must not read
  // as "nothing matches". isLoading is true only while data is undefined
  // (cached mounts never see it), so warm screens behave exactly as R-35.
  const { data: allLedgers, isLoading: ledgersLoading } = useQuery({ queryKey: ["all-ledgers", cid], queryFn: () => get<any[]>(`/api/c/${cid}/ledgers`) });
  // R-21: client-advisory negative-stock warning. Availability per item as of
  // the voucher date — the same chronological source the server guard uses —
  // so the operator sees the oversell while typing instead of at Ctrl+A.
  // Silent-degrade: the strip is a hint; the R-06 server guard remains the
  // authority and catches everything at save.
  const { data: stockAsOf } = useQuery({
    queryKey: ["stock-as-of", cid, date],
    queryFn: () => get<any[]>(`/api/c/${cid}/reports/stock-summary?to=${date}`),
    retry: false,
  });
  const { data: companyPrefs } = useQuery({
    queryKey: ["company-prefs", cid],
    queryFn: () => get<any>(`/api/companies/${cid}`),
    retry: false,
  });
  const { data: allItems, isLoading: itemsLoading } = useQuery({ queryKey: ["all-items", cid], queryFn: () => get<any[]>(`/api/c/${cid}/stock-items`) });
  const { data: godowns } = useQuery({ queryKey: ["godowns", cid], queryFn: () => get<any[]>(`/api/c/${cid}/godowns`) });
  const { data: tdsSections } = useQuery({ queryKey: ["tds-sections", cid], queryFn: () => get<any[]>(`/api/c/${cid}/tds-sections`) });
  const { data: tcsSections } = useQuery({ queryKey: ["tcs-sections", cid], queryFn: () => get<any[]>(`/api/c/${cid}/tcs-sections`) });
  // R-35: groups for the quick-create "Under" select (cache shared with Reports).
  const { data: allGroups } = useQuery({ queryKey: ["groups", cid], queryFn: () => get<any[]>(`/api/c/${cid}/groups`) });

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
          setCancelledView(!!v.isCancelled);
          setDate(v.date.slice(0, 10));
          setNumber(v.number);
          setNumberLocked(true);
          setReference(v.reference ?? "");
          setRefDate(v.refDate ? v.refDate.slice(0, 10) : "");
          setNarration(v.narration ?? "");
          setIsRcm(!!v.isRcm); // R-23: restore the reverse-charge flag on alter
          const rows: LedgerRow[] = v.entries.map((e: any) => ({
            ledgerId: e.ledgerId, ledgerName: e.ledgerName, amount: num(e.amount),
            tdsSectionId: e.tdsSectionId,
            tcsSectionId: e.tcsSectionId, // R-27: preserve the snapshot on alter
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

  // R-21: compute the would-be quantity per outward item (client deltas on top
  // of the as-of-date running qty). Physical rows are absolute counts — skip.
  // Suppressed entirely when the company opted into negative stock.
  const stockWarning = (() => {
    if (companyPrefs?.allowNegativeStock || !stockAsOf || !Array.isArray(stockAsOf) || stockAsOf.length === 0) return null;
    const avail = new Map<number, number>(stockAsOf.map((s: any) => [s.itemId ?? s.id, num(s.closingQty ?? s.runningQty)]));
    const deltas = new Map<number, number>();
    let offender: { name: string; avail: number } | null = null;
    for (const r of inv) {
      if (!r.itemId || isPhysical) continue;
      // The UI takes |qty| and the flow sign is applied at save (STOCK_FLOW;
      // Stock Journal kind source=target side). Mirror that signed delta here.
      const raw = num(r.qty);
      if (Math.abs(raw) < 1e-9) continue;
      const q = r.kind === "source" ? -Math.abs(raw) : r.kind === "target" ? Math.abs(raw) : raw * sign;
      deltas.set(r.itemId, r2((deltas.get(r.itemId) ?? 0) + q));
    }
    for (const [itemId, d] of deltas) {
      if (d >= 0) continue;
      const wouldBe = r2((avail.get(itemId) ?? 0) + d);
      if (wouldBe < -1e-9) {
        const it = allItems?.find((x: any) => x.id === itemId);
        offender = { name: it?.name ?? String(itemId), avail: avail.get(itemId) ?? 0 };
        break;
      }
    }
    return offender;
  })();

  // ---- GST helper ----
  const companyStateCode = company?.gstin?.slice(0, 2) ?? company?.stateCode ?? "";
  const partyLedger = party.id ? ledgerById.get(party.id) : null;
  const partyStateCode = (partyLedger?.gstin ? String(partyLedger.gstin).slice(0, 2) : "") || "";

  // Sign of the taxable (non-duty) income/expense rows per voucher type.
  // Sales income is Cr (negative); Credit Note income is Dr (positive);
  // Purchase expense is Dr; Debit Note expense is Cr. Duty rows carry the
  // same sign as the taxable rows of their voucher.
  const GST_BASE_SIGN: Record<string, 1 | -1> = { Sales: -1, "Credit Note": 1, Purchase: 1, "Debit Note": -1 };

  const applyGst = () => {
    if (!vType || !["Sales", "Purchase", "Credit Note", "Debit Note"].includes(vType.name)) return;
    const baseSign = GST_BASE_SIGN[vType.name];
    const rateLedgers = entries.filter((e) => {
      const l = e.ledgerId ? ledgerById.get(e.ledgerId) : null;
      if (!l || l.dutyHead) return false;
      return e.amount !== 0 && Math.sign(e.amount) === baseSign;
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
      if (ig) rows.push({ ledgerId: ig.id, ledgerName: ig.name, amount: baseSign * gst });
    } else {
      // R-34 (F-34-1): dutyHead is "SGST" (seed + convention) — the old
      // dutyOf("SGST/UTGST") matched nothing, so intrastate Apply-GST inserted
      // only the CGST half. The name is "SGST/UTGST"; the head is "SGST".
      const cg = dutyOf("CGST"); const sg = dutyOf("SGST");
      const half = r2(gst / 2);
      if (cg) rows.push({ ledgerId: cg.id, ledgerName: cg.name, amount: baseSign * half });
      if (sg) rows.push({ ledgerId: sg.id, ledgerName: sg.name, amount: baseSign * (gst - half) });
    }
    // Re-balance the party row after duty rows are (re)inserted, so the voucher
    // can be saved immediately after Apply GST (Tally behaviour).
    if (party.id) {
      const partyRows = rows.filter((e) => e.ledgerId === party.id);
      if (partyRows.length === 1) {
        const otherNet = r2(rows.reduce((s, e) => (e === partyRows[0] ? s : s + e.amount), 0));
        rows[rows.findIndex((e) => e === partyRows[0])] = { ...partyRows[0], amount: -otherNet };
      }
    }
    setEntries(rows);
    setError("");
  };

  // ---- R-33: threshold advisory fetch (non-blocking) — hits the read-only
  // endpoint and keeps only the actionable wordings (over/near). Silent-degrade
  // on failure: the advisory is a convenience, never a workflow gate.
  const fetchThresholdAdvisory = async (dutyHead: "TDS" | "TCS") => {
    setThresholdAdvisories([]);
    try {
      const res = await get<{ advisories: { section: string; over: boolean; near: boolean; wording: string }[] }>(`/api/c/${cid}/reports/tds-threshold-check?dutyHead=${dutyHead}`);
      setThresholdAdvisories((res.advisories ?? []).filter((a) => a.over || a.near).map((a) => a.wording));
    } catch { /* advisory is optional — never block the workflow */ }
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
    // R-33: threshold advisories — non-blocking; the server computes the
    // per-section FY aggregates from the postings and this just surfaces the
    // wording alongside the computation. Nothing is refused on a threshold.
    fetchThresholdAdvisory("TDS");
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

  // ---- TCS helper (R-27) — collection-side mirror of applyTds: party lines
  // whose ledger carries a TCS section collect rate% as a CREDIT on the
  // TCS Payable ledger (dutyHead='TCS').
  const applyTcs = () => {
    const withTcs = entries.filter((e) => {
      const l = e.ledgerId ? ledgerById.get(e.ledgerId) : null;
      return l?.tcsSectionId;
    });
    // R-33: same non-blocking threshold advisory as applyTds (TCS head).
    fetchThresholdAdvisory("TCS");
    if (withTcs.length === 0) { setError("No party line has a TCS section (set it on the party ledger)"); return; }
    const tcsLedger = (allLedgers ?? []).find((l: any) => l.dutyHead === "TCS");
    if (!tcsLedger) { setError("Create a 'TCS Payable' ledger under Duties & Taxes with Duty Head = TCS"); return; }
    const base = entries.filter((e) => {
      const l = e.ledgerId ? ledgerById.get(e.ledgerId) : null;
      return !(l?.dutyHead === "TCS");
    });
    for (const e of withTcs) {
      const l = ledgerById.get(e.ledgerId!);
      const sec = (tcsSections ?? []).find((s: any) => s.id === l?.tcsSectionId);
      const rate = num(sec?.rate ?? 0);
      const amount = r2((Math.abs(e.amount) * rate) / 100);
      if (amount > 0) {
        // Collection is computed on the ENTERED (gross) amount and comes out of
        // the party credit: the party line is reduced so the voucher stays
        // balanced after the single click (mirrors the statutory flow — collect
        // rate% of the receipt from the buyer, remit it to the government).
        const idx = base.indexOf(e);
        if (idx >= 0) base[idx] = { ...base[idx], amount: r2(base[idx].amount + amount) };
        base.push({ ledgerId: tcsLedger.id, ledgerName: tcsLedger.name, amount: -amount, tcsSectionId: sec?.id ?? null });
      }
    }
    setEntries(base);
    setError("");
  };

  // ---- R-35: ledger-on-the-fly quick-create ----
  // Opens the modal prefilled with the focused cell's typed text; the trigger
  // records the row so the created ledger is picked back in on success.
  const quickTriggerFromFocus = (): { row: number; kind: "entry" | "party" } | null => {
    const el = document.activeElement as HTMLInputElement | null;
    if (!el) return null;
    const idx = ledgerInputRefs.current.findIndex((x) => x === el);
    if (idx >= 0) return { row: idx, kind: "entry" };
    if (hasParty && el.closest("div.grid")?.textContent?.includes("Party A/c")) return { row: 0, kind: "party" };
    return null;
  };

  const openQuickCreate = (prefill: string, trigger: { row: number; kind: "entry" | "party" } | null = null) => {
    if (cancelledView) return;
    quickTriggerRef.current = trigger;
    setQuickName(prefill);
    setQuickGroupId("");
    setQuickTaxability("none");
    setQuickRate("");
    setQuickError("");
    setQuickOpen(true);
    setTimeout(() => quickNameRef.current?.focus(), 0);
  };

  // R-35: on modal close, focus returns to the triggering cell (Tally behavior
  // — the operator continues the entry where they left off). Without this the
  // focus drops to <body> and the next Alt+C loses the typed prefill.
  const refocusTrigger = () => {
    const t = quickTriggerRef.current;
    if (!t) return;
    if (t.kind === "party") partyInputRef.current?.focus();
    else ledgerInputRefs.current[t.row]?.focus();
  };

  const submitQuickLedger = async () => {
    if (quickSaving) return;
    setQuickError("");
    if (!quickName.trim()) { setQuickError("Ledger name is required"); return; }
    if (!quickGroupId) { setQuickError("Select the group this ledger belongs under"); return; }
    setQuickSaving(true);
    try {
      // Same boundary the masters page uses: cid-gated, Zod-validated,
      // R-08 in-company group ref check, 409-honest on duplicate names.
      const created = await post<any>(`/api/c/${cid}/ledgers`, {
        name: quickName.trim(),
        groupId: quickGroupId,
        taxability: quickTaxability,
        gstRate: quickRate === "" ? null : num(quickRate),
      });
      await qc.invalidateQueries({ queryKey: ["all-ledgers", cid] });
      const t = quickTriggerRef.current;
      if (t?.kind === "party") {
        setParty({ id: created.id, name: created.name });
        setEntries((rows) => {
          const without = rows.filter((r) => r.ledgerId !== created.id);
          return [{ ledgerId: created.id, ledgerName: created.name, amount: 0 }, ...without];
        });
      } else if (t) {
        setEntries((rows) => rows.map((r, j) => (j === t.row ? { ...r, ledgerId: created.id, ledgerName: created.name } : r)));
      }
      setQuickOpen(false);
      refocusTrigger();
    } catch (err) {
      // Server's message verbatim (e.g. the 409 duplicate-name wording).
      setQuickError(err instanceof Error ? err.message : "Could not create ledger");
    } finally {
      setQuickSaving(false);
    }
  };

  // ---- R-36: arrow-key grid navigation ----
  // Same-column row movement for the voucher grids: ArrowDown/ArrowUp move
  // focus to the input with the same data-col in the next/previous row.
  // Disabled inputs (non-bill-wise bill cell) and selects carry no data-col
  // and are skipped by construction. Modifier chords are ignored (window
  // hotkeys have already consumed Alt chords in capture; this guard keeps
  // Ctrl/Shift/meta combos explicit no-ops).
  const gridArrowNav = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const target = e.target as HTMLElement;
    const col = target.getAttribute?.("data-col");
    if (!col) return; // selects, buttons, ✕ — never arrow targets
    const cell = target.closest("td") as HTMLTableCellElement | null;
    const row = cell?.closest("tr") as HTMLTableRowElement | null;
    if (!cell || !row) return;
    const rows = Array.from(row.parentElement?.querySelectorAll("tr") ?? []);
    const idx = rows.indexOf(row);
    const candidates = e.key === "ArrowDown" ? rows.slice(idx + 1) : rows.slice(0, idx).reverse();
    for (const tr of candidates) {
      if (tr.textContent?.trim() === "Total") break; // summary strip row
      const next = tr.querySelector<HTMLInputElement>(`[data-col="${col}"]`);
      if (next && !next.disabled) {
        e.preventDefault();
        next.focus();
        if (next.type === "number") next.select();
        return;
      }
    }
  };

  // ---- save ----
  const save = async () => {
    if (savingRef.current) return; // R-10: single-shot save (hotkey path)
    setError("");
    if (cancelledView) { setError("This voucher is cancelled and cannot be altered. Uncancel it from the Day Book first."); return; }
    if (Math.abs(diff) > 0.004) { setError(`Voucher does not balance — difference ${diff.toFixed(2)}`); return; }
    const validEntries = entries.filter((e) => e.ledgerId && Math.abs(e.amount) > 0.004);
    // F-INV-01: inventory-category vouchers may be inventory-only — no accounting
    // rows — when at least one real stock movement (item + non-zero qty) exists.
    // All other voucher types still require ledger entries. The server enforces
    // the same rule (validateEntries) — this is UX, not the trust boundary.
    const validInv = vType?.category === "Inventory"
      ? inv.filter((r) => r.itemId && Math.abs(num(r.qty)) > 1e-9)
      : [];
    if (validEntries.length === 0 && validInv.length === 0) {
      setError("Add at least one ledger entry");
      return;
    }
    if (vType?.category === "Inventory" && inv.some((r) => r.itemId && Math.abs(num(r.qty)) <= 1e-9)) {
      setError("Inventory rows need a quantity");
      return;
    }

    const payload: any = {
      voucherTypeId: vType!.id,
      date,
      number: numberLocked ? number : undefined,
      reference: reference || null,
      refDate: refDate || null,
      narration,
      isRcm: vType && ["Purchase", "Debit Note"].includes(vType.name) ? isRcm : false, // R-23
      partyLedgerId: hasParty && party.id ? party.id : null,
      entries: validEntries.map((e, i) => {
        const l = e.ledgerId ? ledgerById.get(e.ledgerId) : null;
        const isPartyRow = hasParty && e.ledgerId === party.id;
        const bills: any[] = [];
        if (l?.billWise) {
          if (isPartyRow && ["Sales", "Purchase", "Credit Note", "Debit Note"].includes(vType!.name)) {
            // A-02 fix: auto bill names carry the voucher-type shortCode so two
            // types numbering from 1 (Sales #1 and Credit Note #1) can no longer
            // produce the same bill name and silently net on the same ledger.
            bills.push({ billType: "new_ref", billName: number ? `${vType!.shortCode}-${number}` : `${date}-${i}`, amount: e.amount, dueDate: refDate || null });
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
          tcsSectionId: e.tcsSectionId ?? null, // R-27: persist the collection-section snapshot
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
    savingRef.current = true;
    try {
      if (isEdit) await put(`/api/c/${cid}/vouchers/${voucherId}`, payload);
      else await post(`/api/c/${cid}/vouchers`, { ...payload, idempotencyKey: idemKeyRef.current ?? undefined });
      qc.invalidateQueries({ queryKey: ["vouchers"] });
      qc.invalidateQueries({ queryKey: ["daybook"] });
      nav(`/company/${cid}/daybook`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  };

  // R-54 Option A (Tally voucher actions): keyboard delete/cancel use the
  // same server contracts as the Day Book buttons. Edit mode only.
  const doDelete = async () => {
    try {
      await del(`/api/c/${cid}/vouchers/${voucherId}`);
      qc.invalidateQueries({ queryKey: ["daybook", cid] });
      nav(`/company/${cid}/daybook`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const doCancel = async () => {
    try {
      await post(`/api/c/${cid}/vouchers/${voucherId}/cancel`, {});
      qc.invalidateQueries({ queryKey: ["daybook", cid] });
      nav(`/company/${cid}/daybook`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel failed");
    }
  };

  useHotkeys({
    // R-35: ledger-on-the-fly — Alt+C from anywhere on the voucher screen.
    // Prefill comes from the focused input's typed text when it is a ledger or
    // party cell; otherwise the operator types the name in the modal.
    "Alt+C": () => {
      if (cancelledView) return;
      const el = document.activeElement as HTMLInputElement | null;
      const typed = el && el.tagName === "INPUT" && !el.readOnly && el.value.trim() ? el.value.trim() : "";
      openQuickCreate(typed, quickTriggerFromFocus());
    },
    // R-35 keyboard layering: with the modal open, Esc closes ONLY the modal
    // and Ctrl+A accepts the modal; the half-entered voucher is untouched.
    ...(quickOpen ? {
      "Ctrl+A": () => { submitQuickLedger(); },
      Escape: (e) => { e.preventDefault(); setQuickOpen(false); refocusTrigger(); },
    } : {
      "Ctrl+A": () => save(),
    }),
    "Alt+F1": () => setDetailed(!detailed),
    ...(vType && ["Purchase", "Debit Note"].includes(vType.name) && !cancelledView
      ? { "Alt+R": () => setIsRcm((x) => !x) } // R-23: reverse-charge toggle
      : {}),
    // R-34 (D-1): the advertised chords actually fire — same guards as the chips.
    ...(vType && ["Sales", "Purchase", "Credit Note", "Debit Note"].includes(vType.name)
      ? { "Alt+J": () => applyGst() } // R-54: Tally's statutory-adjustment slot; Alt+G is now Go To
      : {}),
    ...(vType?.category === "Accounting" ? { "Alt+T": () => applyTds() } : {}),
    // R-54 Option A (Tally voucher actions): Alt+D delete, Alt+X cancel —
    // edit mode only, never while the quick-create modal is up, confirm-guarded.
    ...(isEdit && !cancelledView && !quickOpen ? {
      "Alt+D": () => { if (window.confirm("Delete this voucher? This cannot be undone.")) doDelete(); },
      "Alt+X": () => { if (window.confirm("Cancel this voucher? It stays in the books but is excluded; Uncancel restores it.")) doCancel(); },
    } : {}),
  }, [entries, inv, date, number, reference, narration, party, diff, vType, isRcm, cancelledView, quickOpen, quickName, quickGroupId, quickTaxability, quickRate, isEdit]);

  const fkeys: FKeyButton[] = [
    { key: "Ctrl+A", label: "Accept / Save", onClick: save },
    { key: "F2", label: "Date", onClick: () => (document.getElementById("v-date") as HTMLInputElement)?.focus() },
    ...(hasParty ? [{ key: "F12", label: "Ref / Party", onClick: () => (document.getElementById("v-ref") as HTMLInputElement)?.focus() }] : []),
    ...(vType && ["Sales", "Purchase", "Credit Note", "Debit Note"].includes(vType.name) ? [{ key: "Alt+J", label: "Apply GST", onClick: applyGst }] : []),
    ...(isEdit && !cancelledView ? [
      { key: "Alt+D", label: "Delete Voucher", onClick: () => { if (window.confirm("Delete this voucher? This cannot be undone.")) doDelete(); } },
      { key: "Alt+X", label: "Cancel Voucher", onClick: () => { if (window.confirm("Cancel this voucher? It stays in the books but is excluded; Uncancel restores it.")) doCancel(); } },
    ] : []),
    ...(vType && ["Purchase", "Debit Note"].includes(vType.name) ? [{ key: "Alt+R", label: isRcm ? "RCM ✓ (toggle off)" : "Reverse Charge", onClick: () => setIsRcm((x) => !x) }] : []),
    ...(vType?.category === "Accounting" ? [{ key: "Alt+T", label: "Deduct TDS", onClick: applyTds }] : []),
    { key: "Alt+C", label: "Create Ledger", onClick: () => { if (!cancelledView) openQuickCreate("", quickTriggerFromFocus()); } },
    { key: "Esc", label: "Back", onClick: () => nav(-1) },
  ];

  return (
    <Shell
      title={vType ? `${vType.name} Voucher` : "Voucher"}
      breadcrumb={[{ label: "Gateway", to: `/company/${cid}` }, { label: "Day Book", to: `/company/${cid}/daybook` }, { label: vType ? `${vType.name} ${isEdit ? "Alter" : "Create"}` : "…" }]}
      fkeys={fkeys}
    >
      <ErrorBanner error={error} />
      {/* R-33: threshold advisories — honest amber nudges; nothing blocks. */}
      {thresholdAdvisories.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-sm px-4 py-2.5 leading-relaxed">
          {thresholdAdvisories.map((t, i) => (<div key={i}>⚠ {t}</div>))}
        </div>
      )}
      {!vType ? (
        <div className="text-slate-400 text-sm">Loading…</div>
      ) : (
        <div className="card max-w-5xl">
          {/* R-02: cancelled banner — the voucher is shown read-only */}
          {cancelledView && (
            <div className="px-5 py-2.5 bg-red-50 border-b border-red-100 text-red-700 text-sm font-medium rounded-t-xl">
              Cancelled voucher — displayed read-only. Its accounting, inventory and GST effects are inactive. Uncancel it from the Day Book to restore.
            </div>
          )}
          {/* R-18: compact audit history — one line per lifecycle transition */}
          {isEdit && !!auditTrail && auditTrail.length > 0 && (
            <div className="px-5 py-2 border-b border-slate-100 text-xs text-slate-500 flex flex-wrap gap-x-4 gap-y-1 leading-relaxed">
              {auditTrail.map((e: any) => (
                <span key={e.id}>
                  {e.action === "create" ? "Created" : e.action === "edit" ? "Edited" : e.action === "cancel" ? "Cancelled" : e.action === "uncancel" ? "Uncancelled" : "Deleted"}
                  {e.actorUsername ? ` by ${e.actorUsername}` : ""}
                  {e.detail ? ` (${e.detail})` : ""}
                  {" · "}{new Date(e.createdAt).toLocaleString()}
                </span>
              ))}
            </div>
          )}
          {/* header */}
          <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-100 bg-slate-50/80 rounded-t-xl flex-wrap">
            <span className="text-base font-semibold text-indigo-700">{vType.name}</span>
            <span className="text-sm text-slate-400">No.</span>
            <input className="w-32" value={number} onChange={(e) => setNumber(e.target.value)} />
            <span className="text-sm text-slate-400 ml-2">Date (F2)</span>
            <input id="v-date" type="date" className="w-36" value={date} onChange={(e) => setDate(e.target.value)} />
            {vType && ["Purchase", "Debit Note"].includes(vType.name) && (
              <label className="ml-auto flex items-center gap-2 text-sm cursor-pointer select-none" title="Reverse charge (s. 9(3)/9(4)) — you self-account the GST. Post the self-assessed duty on the RCM Payable ledger. (Alt+R)">
                <input type="checkbox" checked={isRcm} onChange={(e) => setIsRcm(e.target.checked)} disabled={cancelledView} />
                <span className={isRcm ? "font-semibold text-amber-700" : "text-slate-500"}>RCM</span>
              </label>
            )}
          </div>
          {isRcm && !cancelledView && (
            <div className="px-5 py-2.5 bg-amber-50 border-b border-amber-100 text-amber-800 text-xs leading-relaxed">
              Reverse charge — GST is NOT charged by the supplier. Self-account the tax: Dr expense/purchase, Cr RCM Payable (IGST/CGST/SGST rates as applicable). Reported under GSTR-3B Table 4(A)(3).
            </div>
          )}

          <div className="px-5 py-5 space-y-6">
            {/* party for trading vouchers */}
            {hasParty && (
              <div className="grid grid-cols-[minmax(120px,140px)_1fr_minmax(120px,140px)_1fr] gap-x-4 gap-y-4 items-center">
                <span className="text-sm font-medium text-slate-600">Party A/c</span>
                <TypeAhead items={ledgerOptions} value={party.name} inputRef={partyInputRef} onPick={(o) => {
                  if (!o) { setParty({ id: null, name: "" }); return; }
                  setParty({ id: o.id, name: o.name });
                  // ensure a party row exists at the top of the entries grid
                  setEntries((rows) => {
                    const withoutParty = rows.filter((r) => r.ledgerId !== o.id);
                    const oldPartyRow = rows.find((r) => r.ledgerId === o.id);
                    return [{ ledgerId: o.id, ledgerName: o.name, amount: oldPartyRow?.amount ?? 0 }, ...withoutParty];
                  });
                }}
                createLabel="ledger" loading={ledgersLoading} onCreate={(t) => openQuickCreate(t, { row: 0, kind: "party" })} />
                <span className="text-sm font-medium text-slate-600">Invoice No.</span>
                <input id="v-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Party invoice no." />
              </div>
            )}
            {hasParty && (
              <div className="grid grid-cols-[minmax(120px,140px)_1fr_minmax(120px,140px)_1fr] gap-x-4 gap-y-4 items-center">
                <span className="text-sm font-medium text-slate-600">Ref Date</span>
                <input type="date" value={refDate} onChange={(e) => setRefDate(e.target.value)} />
                <span />
                <span />
              </div>
            )}

            {/* inventory grid */}
            {(vType.affectsStock || isStockJournal || isPhysical) && (
              <div>
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
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
                  <tbody onKeyDown={gridArrowNav}>
                    {inv.map((row, i) => (
                      <tr key={i}>
                        <td>
                          <TypeAhead items={itemOptions} value={row.itemName} dataCol="item" onPick={(o) => {
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
                        <td><input className="w-full text-right" type="number" step="any" data-col="qty" value={row.qty || ""} onChange={(e) => setInv(inv.map((r, j) => {
                          if (j !== i) return r;
                          const qty = num(e.target.value);
                          return { ...r, qty, amount: r2(Math.abs(qty) * r.rate) };
                        }))} /></td>
                        <td><input className="w-full text-right" type="number" step="any" data-col="rate" value={row.rate || ""} onChange={(e) => setInv(inv.map((r, j) => {
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
                {stockWarning && (
                  <div className="mt-3 px-4 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm leading-relaxed">
                    Insufficient stock: "{stockWarning.name}" — only {stockWarning.avail} available on {date}. Save will be rejected unless "Allow Negative Stock" is enabled in Company Settings.
                  </div>
                )}
                <button className="btn-ghost mt-3 text-sm" onClick={() => setInv([...inv, newInvRow()])}>+ Add Item</button>
              </div>
            )}

            {/* accounting entries */}
            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Ledger Entries
                {vType?.category === "Inventory" && (
                  <span className="ml-2 font-normal normal-case text-slate-400">optional for an inventory-only voucher</span>
                )}
              </div>
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
                <tbody onKeyDown={gridArrowNav}>
                  {entries.map((row, i) => {
                    const l = row.ledgerId ? ledgerById.get(row.ledgerId) : null;
                    return (
                      <tr key={i}>
                        <td>
                          <TypeAhead
                            items={ledgerOptions}
                            value={row.ledgerName}
                            inputRef={(el: HTMLInputElement | null) => { ledgerInputRefs.current[i] = el; }}
                            dataCol="ledger"
                            onPick={(o) => {
                              setEntries(entries.map((r, j) => (j === i ? { ...r, ledgerId: o?.id ?? null, ledgerName: o?.name ?? "" } : r)));
                              if (o && i === entries.length - 1) setTimeout(() => ledgerInputRefs.current[i + 1]?.focus(), 0);
                            }}
                            createLabel="ledger"
                            loading={ledgersLoading}
                            onCreate={(t) => openQuickCreate(t, { row: i, kind: "entry" })}
                          />
                        </td>
                        {detailed && (
                          <td>
                            <input
                              className="w-full"
                              data-col="bill"
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
                            data-col="dr"
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
                            data-col="cr"
                            value={row.amount < 0 ? -row.amount : ""}
                            onChange={(e) => setEntries(entries.map((r, j) => (j === i ? { ...r, amount: -Math.abs(num(e.target.value)) } : r)))}
                          />
                        </td>
                        <td><button className="text-slate-400 hover:text-red-500" onClick={() => setEntries(entries.length > 1 ? entries.filter((_, j) => j !== i) : entries)}>✕</button></td>
                      </tr>
                    );
                  })}
                  <tr className="font-semibold bg-slate-50/80 border-t-2 border-slate-200">
                    <td className="text-right pr-3 text-base">Total</td>
                    {detailed && <td />}
                    <td className="num">{totalDr.toLocaleString("en-IN")}</td>
                    <td className="num">{totalCr.toLocaleString("en-IN")}</td>
                    <td className={Math.abs(diff) > 0.004 ? "num text-red-600" : "num text-green-600"}>
                      {Math.abs(diff) > 0.004 ? diff.toFixed(2) : "✓"}
                    </td>
                  </tr>
                </tbody>
              </table>
              <div className="flex gap-2.5 mt-3 flex-wrap">
                <button className="btn-ghost text-sm" onClick={() => setEntries([...entries, { ledgerId: null, ledgerName: "", amount: 0 }])}>+ Add Ledger</button>
                {vType && ["Sales", "Purchase", "Credit Note", "Debit Note"].includes(vType.name) && (
                  <button className="btn-ghost text-sm" onClick={applyGst}>+ Apply GST</button>
                )}
                {vType?.category === "Accounting" && (
                  <button className="btn-ghost text-sm" onClick={applyTds}>− Deduct TDS</button>
                )}
                {vType?.category === "Accounting" && (
                  <button className="btn-ghost text-sm" onClick={applyTcs}>− Collect TCS</button>
                )}
              </div>
            </div>

            {/* narration */}
            <div className="grid grid-cols-[minmax(120px,140px)_1fr] gap-4 items-center">
              <span className="text-sm font-medium text-slate-600">Narration</span>
              <input value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="Being…" />
            </div>

            <div className="flex gap-2.5 pt-2 flex-wrap items-center">
              <button className="btn-primary" disabled={saving || cancelledView} onClick={save}>{isEdit ? "Alter (Ctrl+A)" : "Accept (Ctrl+A)"}</button>
              <button className="btn-ghost" onClick={() => nav(-1)}>Cancel (Esc)</button>
              <span className="flex-1" />
              <span className="text-xs text-slate-400 self-center">
                Enter on last amount row adds a new line · {fmtDate(date)}
              </span>
            </div>
          </div>
        </div>
      )}
      {/* R-35: ledger-on-the-fly quick-create. Layering contract: Esc here
          closes ONLY this modal; the voucher behind keeps every keystroke.
          Ctrl+A / Enter accept; the server's 409 wording surfaces verbatim. */}
      {quickOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center" data-testid="quick-ledger-modal">
          <div className="card shadow-raised w-[440px] max-w-[95vw]">
            <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/80 rounded-t-xl text-base font-semibold text-indigo-700">
              Create Ledger
            </div>
            <div className="px-5 py-4 space-y-4" onKeyDown={(e) => {
              // R-35: Enter accepts the modal (Tally parity with Ctrl+A). Scoped
              // to the fields container so the buttons below keep native clicks.
              if (e.key === "Enter") { e.preventDefault(); submitQuickLedger(); }
            }}>
              {quickError && (
                <div className="rounded-lg bg-red-50 border border-red-100 text-red-700 text-sm px-3.5 py-2">{quickError}</div>
              )}
              <div className="grid grid-cols-[minmax(110px,130px)_1fr] gap-3 items-center">
                <span className="text-sm font-medium text-slate-600">Name</span>
                <input ref={quickNameRef} value={quickName} onChange={(e) => setQuickName(e.target.value)} placeholder="Ledger name" />
              </div>
              <div className="grid grid-cols-[minmax(110px,130px)_1fr] gap-3 items-center">
                <span className="text-sm font-medium text-slate-600">Under Group</span>
                <select value={quickGroupId} onChange={(e) => setQuickGroupId(e.target.value ? parseInt(e.target.value, 10) : "")}>
                  <option value="">—</option>
                  {(allGroups ?? []).map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-[minmax(110px,130px)_1fr] gap-3 items-center">
                <span className="text-sm font-medium text-slate-600">Taxability</span>
                <select value={quickTaxability} onChange={(e) => setQuickTaxability(e.target.value)}>
                  <option value="none">None</option>
                  <option value="taxable">Taxable</option>
                  <option value="exempt">Exempt</option>
                  <option value="nil">Nil Rated</option>
                </select>
              </div>
              <div className="grid grid-cols-[minmax(110px,130px)_1fr] gap-3 items-center">
                <span className="text-sm font-medium text-slate-600">GST Rate %</span>
                <input type="number" step="any" value={quickRate} onChange={(e) => setQuickRate(e.target.value)} placeholder="e.g. 18 (optional)" />
              </div>
              <div className="text-xs text-slate-400 leading-relaxed">
                Entry-ready master — GSTIN, bill-wise and TDS/TCS sections are set on the masters page later.
                Esc closes this dialog only; the voucher behind keeps its state.
              </div>
            </div>
            <div className="flex gap-2.5 px-5 py-3.5 border-t border-slate-100">
              <button className="btn-primary" disabled={quickSaving} onClick={submitQuickLedger}>Create (Ctrl+A)</button>
              <button className="btn-ghost" onClick={() => setQuickOpen(false)}>Cancel (Esc)</button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
