import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Shell, { FKeyButton } from "../components/Shell";
import { useCompany } from "../store";
import { get } from "../lib/api";
import { useHotkeys } from "../lib/hotkeys";
import { today, fyStart, fyEndFromBegin, fmtDate, loadSessionPeriod, saveSessionPeriod, clearSessionPeriod } from "../lib/format";
import { buildGatewayMenu, voucherKeyRank, MenuEntry } from "../lib/gatewayMenu";

interface VoucherTypeRow { id: number; name: string; category: string; functionKey: string | null; }

export default function Gateway() {
  const { cid } = useParams();
  const nav = useNavigate();
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

  // R-56 (F1 fix): the FY line shows the STORED financial year — the stored
  // financialYearStart date IS the anchor (begin → begin+1y−1d), never a
  // calendar recompute from today.
  const fyFrom = company?.financialYearStart || "";
  const fyTo = company?.financialYearStart ? fyEndFromBegin(company.financialYearStart) : "";

  // R-56: session current period (Tally Alt+F2) — a per-company lens stored in
  // localStorage, NOT company data. Changing it never touches FY-begin or
  // books-begin; balances carry forward because every report stays
  // period-parametric. The Gateway both displays and sets it.
  const [period, setPeriod] = useState<{ from: string; to: string } | null>(() => loadSessionPeriod(cid));
  const [periodOpen, setPeriodOpen] = useState(false);
  const [pFrom, setPFrom] = useState(period?.from ?? fyFrom);
  const [pTo, setPTo] = useState(period?.to ?? today());
  useEffect(() => {
    setPeriod(loadSessionPeriod(cid));
    setPFrom(loadSessionPeriod(cid)?.from ?? fyFrom);
    setPTo(loadSessionPeriod(cid)?.to ?? today());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid]);
  useHotkeys({ "Alt+F2": () => { setPFrom(period?.from ?? fyFrom); setPTo(period?.to ?? today()); setPeriodOpen(true); } }, [cid, period, fyFrom]);
  const applyPeriod = () => {
    const next = { from: pFrom || fyFrom, to: pTo || today() };
    setPeriod(next);
    saveSessionPeriod(cid, next);
    setPeriodOpen(false);
  };
  const resetPeriod = () => {
    clearSessionPeriod(cid);
    setPeriod(null);
    setPeriodOpen(false);
  };

  const acct = useMemo(
    () => (voucherTypes ?? []).filter((v) => v.category === "Accounting" || v.category === "Inventory"),
    [voucherTypes]
  );

  // R-53b/R-53c/R-54: TallyPrime-faithful Gateway with globally unique hot
  // letters (full scheme documented in lib/gatewayMenu.ts — the single
  // source of truth shared with the Alt+G Go To palette).
  const entries: MenuEntry[] = useMemo(() => buildGatewayMenu(cid ?? "", acct), [cid, acct]);

  // Headings only at first view — the contents pane opens on selection.
  const [open, setOpen] = useState<string | null>(null);
  const [hl, setHl] = useState<number | null>(null);

  const stateRef = useRef({ open, entries, hl });
  stateRef.current = { open, entries, hl };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const { open, entries, hl } = stateRef.current;

      if (e.key === "Escape") {
        // Claim the key whenever a pane is open so Shell's history-back does
        // not also fire; with no pane open, Esc falls through to Shell.
        if (open) {
          e.preventDefault();
          setOpen(null);
          setHl(null);
        }
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (!open) return;
        const items = entries.find((s) => s.title === open)?.items ?? [];
        if (!items.length) return;
        e.preventDefault();
        setHl((prev) => {
          const n = items.length;
          const cur = prev == null ? -1 : prev;
          return e.key === "ArrowDown" ? (cur + 1) % n : (cur - 1 + n) % n;
        });
        return;
      }
      if (e.key === "Enter") {
        if (!open) return;
        const items = entries.find((s) => s.title === open)?.items ?? [];
        const it = hl != null ? items[hl] : null;
        if (it) {
          e.preventDefault();
          nav(it.to);
        }
        return;
      }
      if (!/^[a-z0-9]$/i.test(e.key)) return;
      const k = e.key.toUpperCase();

      // TallyPrime letter navigation. R-53c: letters are globally unique, so
      // the open pane's own item letter fires directly, then heading letters
      // (V/K/C/A/R/U — K = Day Book from anywhere), then the global fallback.
      // The fallback dedupes by target: masters appear under BOTH Create and
      // Alter with the same letter, which is one option, not a clash — so the
      // letter still fires. A genuine multi-target letter drills into the
      // first matching heading with the item highlighted instead of guessing.
      if (open) {
        const items = entries.find((s) => s.title === open)?.items ?? [];
        const idxs = items.map((it, i) => ({ it, i })).filter(({ it }) => it.letter === k).map(({ i }) => i);
        if (idxs.length === 1) {
          e.preventDefault();
          nav(items[idxs[0]].to);
          return;
        }
        if (idxs.length > 1) {
          e.preventDefault();
          setHl((prev) => {
            const pos = idxs.indexOf(prev ?? -1);
            return idxs[(pos + 1) % idxs.length];
          });
          return;
        }
      }
      const direct = entries.find((s) => s.letter === k && s.to);
      if (direct) {
        e.preventDefault();
        nav(direct.to!);
        return;
      }
      const sec = entries.find((s) => s.letter === k);
      if (sec) {
        e.preventDefault();
        setOpen(sec.title);
        setHl(0);
        return;
      }
      const hits = entries
        .flatMap((s) => (s.items ?? []).map((it) => ({ s, it })))
        .filter(({ it }) => it.letter === k);
      const targets = [...new Set(hits.map(({ it }) => it.to))];
      if (targets.length === 1) {
        e.preventDefault();
        nav(targets[0]);
      } else if (hits.length > 1) {
        e.preventDefault();
        setOpen(hits[0].s.title);
        setHl(hits[0].s.items!.indexOf(hits[0].it));
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, nav]);

  const openEntry = entries.find((s) => s.title === open) ?? null;

  // R-53c: F2 belongs to date/period (Tally behaviour) — the Gateway carries
  // no F2. K (Day Book) is the keyboard path from here.
  // R-54 Option A: bind EVERY seeded voucher-type functionKey (Tally opens
  // its vouchers from anywhere, not only from Day Book) + Alt+G Go To.
  const fkeyMap: Record<string, () => void> = {};
  for (const v of acct) {
    const fk = (v.functionKey ?? "").trim();
    if (!fk || fkeyMap[fk]) continue; // first type wins; duplicates ignored
    fkeyMap[fk] = () => nav(`/company/${cid}/voucher/${v.id}/new`);
  }
  // R-62: the rail follows the voucher list's shortcut-class order — F-keys,
  // then Alt+ chords, then Ctrl+ (voucherKeyRank; Day Book's rail already
  // follows this order by construction).
  const rail: FKeyButton[] = Object.entries(fkeyMap)
    .map(([key, onClick]) => ({ key, label: "", onClick }))
    .sort((a, b) => voucherKeyRank(a.key) - voucherKeyRank(b.key));

  useHotkeys({ ...fkeyMap }, [cid, acct]);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    window.location.href = "/login";
  };

  return (
    <Shell
      title="Gateway"
      fkeys={rail.map((r) => ({ ...r, label: acct.find((v) => (v.functionKey ?? "").trim() === r.key)?.name ?? "" }))}
    >
      {/* R-53b: TallyPrime layout — company context left (info only; the Shell
          fkey rail is the single shortcut surface), general headings middle
          (nothing expanded), contents of the one selected heading right. */}
      <div className="grid grid-cols-1 lg:grid-cols-[300px_250px_minmax(0,1fr)] gap-6 items-start">

        {/* ---- Company panel (left, Tally's top-left company block) ---- */}
        <aside className="card p-5 space-y-3 lg:sticky lg:top-2 min-w-0 overflow-hidden">
          <div className="min-w-0">
            <div
              className="text-base font-semibold text-slate-800 leading-snug break-words"
              title={company?.name ?? undefined}
            >
              {company?.name ?? "…"}
            </div>
            <div
              className="text-xs text-slate-500 mt-1 truncate"
              title={[company?.gstin, company?.state].filter(Boolean).join(" · ") || undefined}
            >
              {[company?.gstin, company?.state].filter(Boolean).join(" · ")}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">FY {fyFrom} → {fyTo}</div>
            {/* R-56: session current period — click or Alt+F2 (Tally parity).
                A stored session period shows its range; otherwise "Full FY". */}
            <button
              data-testid="period-line"
              onClick={() => { setPFrom(period?.from ?? fyFrom); setPTo(period?.to ?? today()); setPeriodOpen(true); }}
              className={`text-xs mt-0.5 text-left block max-w-full truncate ${period ? "text-indigo-600 font-medium hover:underline" : "text-slate-500 hover:underline"}`}
              title="Change period (Alt+F2) — Tally's recommended way to work a different year without touching FY-begin or books-begin"
            >
              {period ? `Period ${fmtDate(period.from)} → ${fmtDate(period.to)}` : "Period: Full FY"}
            </button>
          </div>
          {tbHealth && (
            <div className="pt-2.5 border-t border-slate-100 min-w-0">
              {Math.abs(tbHealth.difference ?? 0) <= 0.004 ? (
                <div className="text-sm text-green-700 font-medium truncate" title="Trial Balance is balanced">
                  Trial Balance ✓ balanced
                </div>
              ) : (
                <div className="text-sm text-amber-700 font-medium truncate" title={`Trial Balance out by ${tbHealth.difference}`}>
                  Trial Balance ✗ out by {Math.abs(tbHealth.difference).toLocaleString("en-IN")}
                  <Link to={`/company/${cid}/reports/trial-balance`} className="ml-1 text-indigo-600 hover:underline font-normal">view</Link>
                </div>
              )}
            </div>
          )}
          <div className="pt-2.5 border-t border-slate-100 text-xs text-slate-500">
            Signed in as <span className="font-medium text-slate-700">{me?.username}</span>
            <button onClick={logout} className="ml-1.5 text-indigo-600 hover:underline">Logout</button>
          </div>
        </aside>

        {/* ---- Level 1: general headings only (middle) ---- */}
        <div className="card p-2">
          <div className="px-2 pt-1 pb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Gateway of zprime
          </div>
          {entries.map((s) =>
            s.to ? (
              <Link
                key={s.title}
                to={s.to}
                title={s.chord ? `${s.title} (${s.chord})` : undefined}
                className="fkey-item !min-h-[2.5rem]"
              >
                {/* R-62: only chord chips widen — single-letter chips keep the
                    standard 1.7rem box (the K chip must not stretch). */}
                <span className={`fkey-chip shrink-0 ${s.chord ? "!px-1.5" : "!min-w-[1.7rem] !px-0"}`}>{s.chord ?? s.letter}</span>
                <span className="flex-1 text-left font-medium">{s.title}</span>
              </Link>
            ) : (
              <button
                key={s.title}
                onClick={() => {
                  setOpen(open === s.title ? null : s.title);
                  setHl(0);
                }}
                className={`fkey-item !min-h-[2.5rem] ${open === s.title ? "bg-indigo-50 !text-indigo-800 ring-1 ring-indigo-200" : ""}`}
              >
                <span className="fkey-chip !min-w-[1.7rem] !px-0 shrink-0">{s.letter}</span>
                <span className="flex-1 text-left font-medium">{s.title}</span>
              </button>
            )
          )}
        </div>

        {/* ---- Level 2: contents of the selected heading only (right) ---- */}
        <div className="card p-2 min-h-[280px]" data-testid="gateway-contents">
          {openEntry?.items ? (
            <>
              <div className="px-2 pt-1 pb-2 flex items-baseline gap-2 flex-wrap">
                <span className="text-xs font-semibold uppercase tracking-wider text-indigo-600">
                  {openEntry.title}
                </span>
                <span className="text-xs text-slate-400">
                  letter = open · arrows = move · Enter = select · Esc = close
                </span>
              </div>
              <ul>
                {openEntry.items.map((it, i) => (
                  <li key={it.label}>
                    <Link
                      to={it.to}
                      className={`fkey-item !min-h-[2.25rem] !px-2 !rounded-md ${i === hl ? "bg-indigo-50 !text-indigo-800 ring-1 ring-indigo-200" : ""}`}
                      onMouseEnter={() => setHl(i)}
                      title={it.letter && it.hint ? it.hint : undefined}
                    >
                      {it.letter ? (
                        <span className="fkey-chip !min-w-[1.7rem] !px-0 shrink-0">{it.letter}</span>
                      ) : it.hint ? (
                        <span className="fkey-chip shrink-0">{it.hint}</span>
                      ) : (
                        <span className="w-[1.7rem] shrink-0" aria-hidden />
                      )}
                      <span className="flex-1 truncate">{it.label}</span>
                      {it.letter && it.hint && (
                        <span className="text-xs text-slate-400 hidden xl:inline">{it.hint}</span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="h-full min-h-[260px] grid place-items-center text-center p-8 text-sm text-slate-400 leading-relaxed">
              <div>
                Select a menu — or press its letter (<b>V</b> · <b>K</b> · <b>C</b> · <b>A</b> ·{" "}
                <b>R</b> · <b>U</b>).
                <br />
                <b>K</b> opens the Day Book from anywhere.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* R-56: Alt+F2 change-period modal (Tally "Change Current Period").
          Session-scoped: stored per company in localStorage, cleared anytime;
          reports/daybook default windows follow it. Company FY/books unchanged. */}
      {periodOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setPeriodOpen(false); }}>
          <div className="card w-full max-w-sm p-5 space-y-4" data-testid="period-modal">
            <div>
              <div className="text-base font-semibold text-slate-800">Change Period</div>
              <div className="text-xs text-slate-500 mt-0.5">Session current period for {company?.name ?? "this company"} — Alt+F2 (Tally). Reports and Day Book default to it.</div>
            </div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <input type="date" value={pFrom} onChange={(e) => setPFrom(e.target.value)} aria-label="Period from" />
              <span className="text-slate-400 text-sm">to</span>
              <input type="date" value={pTo} onChange={(e) => setPTo(e.target.value)} aria-label="Period to" />
            </div>
            <div className="text-xs text-slate-400 leading-relaxed">
              Company FY stays {fyFrom} → {fyTo}. This is a lens for this session only — balances and books are untouched.
            </div>
            <div className="flex items-center justify-between gap-2 pt-1">
              <button className="btn-ghost text-sm" onClick={resetPeriod} title="Clear the session period — pages fall back to the company FY">Reset to FY</button>
              <div className="flex gap-2">
                <button className="btn-ghost text-sm" onClick={() => setPeriodOpen(false)}>Cancel</button>
                <button className="btn-primary text-sm" onClick={applyPeriod} data-testid="period-apply">Apply</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
