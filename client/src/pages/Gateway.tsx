import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Shell from "../components/Shell";
import { useCompany } from "../store";
import { get } from "../lib/api";
import { useHotkeys } from "../lib/hotkeys";
import { today, fyStart, fyEnd } from "../lib/format";

interface VoucherTypeRow { id: number; name: string; category: string; functionKey: string | null; }

interface MenuLeaf { label: string; to: string; letter?: string; hint?: string; }
interface MenuEntry {
  letter: string;
  title: string;
  /** Direct navigation targets (Day Book) skip the contents pane. */
  to?: string;
  /** Contents shown in the right pane when the heading is selected. */
  items?: MenuLeaf[];
}

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

  const fyFrom = company ? fyStart(today()) : "";
  const fyTo = company ? fyEnd(today()) : "";

  const acct = useMemo(
    () => (voucherTypes ?? []).filter((v) => v.category === "Accounting" || v.category === "Inventory"),
    [voucherTypes]
  );

  // R-53b: TallyPrime-faithful Gateway. The menu shows ONLY the general
  // headings — Masters are reached through Create / Alter, voucher entry
  // through Vouchers, and reports stay folded under Reports until selected.
  // R-53c: hot letters are GLOBALLY unique — no two options share a shortcut
  // letter (headings V/K/C/A/R/U included). The best letter of the option's
  // own name wins; when every letter of the name is already taken the item
  // ships letterless and stays reachable via arrows + Enter and by clicking.
  // Losers of a clash and their fallbacks: Purchase Register G→P (P&L keeps
  // F of "ProFit"), Sales Register keeps S over Stock Groups/Company
  // Settings, Voucher Types keeps Y (tYpes) over Payables, TDS Sections
  // keeps D over TDS Report/Audit Trail, Employees keeps E over Receivables.
  const masters = useMemo<MenuLeaf[]>(() => [
    { label: "Ledgers", to: `/company/${cid}/masters/ledgers`, letter: "L", hint: "Create / alter ledger accounts" },
    { label: "Groups", to: `/company/${cid}/masters/groups`, letter: "G", hint: "Account groups (28 pre-defined)" },
    { label: "Stock Items", to: `/company/${cid}/masters/stock-items`, letter: "I", hint: "Inventory items" },
    { label: "Units of Measure", to: `/company/${cid}/masters/units`, letter: "N" },
    { label: "Stock Groups", to: `/company/${cid}/masters/stock-groups` },
    { label: "Godowns / Locations", to: `/company/${cid}/masters/godowns`, letter: "O" },
    { label: "Voucher Types", to: `/company/${cid}/masters/voucher-types`, letter: "Y" },
    { label: "TDS Sections", to: `/company/${cid}/masters/tds-sections`, letter: "D" },
    { label: "TCS Sections", to: `/company/${cid}/masters/tcs-sections` },
    { label: "Employees & Payroll", to: `/company/${cid}/masters/employees`, letter: "E" },
  ], [cid]);

  const entries: MenuEntry[] = useMemo(() => [
    {
      letter: "V",
      title: "Vouchers",
      items: [
        ...acct.map((v) => ({ label: v.name, to: `/company/${cid}/voucher/${v.id}/new`, hint: v.functionKey ?? "" })),
        { label: "Process Payroll", to: `/company/${cid}/payroll`, hint: "Monthly salary vouchers" },
      ],
    },
    { letter: "K", title: "Day Book", to: `/company/${cid}/daybook` },
    { letter: "C", title: "Create", items: masters },
    { letter: "A", title: "Alter", items: masters },
    {
      letter: "R",
      title: "Reports",
      items: [
        { label: "Balance Sheet", to: `/company/${cid}/reports/balance-sheet`, letter: "B" },
        { label: "Profit & Loss A/c", to: `/company/${cid}/reports/profit-loss`, letter: "F" },
        { label: "Trial Balance", to: `/company/${cid}/reports/trial-balance`, letter: "T" },
        { label: "Cash / Bank Book", to: `/company/${cid}/reports/cash-bank`, letter: "H" },
        { label: "Sales Register", to: `/company/${cid}/reports/register-sales`, letter: "S" },
        { label: "Purchase Register", to: `/company/${cid}/reports/register-purchase`, letter: "P" },
        { label: "Stock Summary", to: `/company/${cid}/reports/stock-summary`, letter: "M" },
        { label: "Receivables (B/R)", to: `/company/${cid}/reports/receivables` },
        { label: "Payables (B/P)", to: `/company/${cid}/reports/payables` },
        { label: "GSTR-1", to: `/company/${cid}/reports/gstr1`, letter: "1" },
        { label: "GSTR-3B", to: `/company/${cid}/reports/gstr3b`, letter: "3" },
        { label: "GSTR-9 (Annual)", to: `/company/${cid}/reports/gstr9`, letter: "9" },
        { label: "TDS Report", to: `/company/${cid}/reports/tds` },
        { label: "TCS Report", to: `/company/${cid}/reports/tcs` },
        { label: "Salary Register", to: `/company/${cid}/reports/salary-register` },
        { label: "Cheque Register", to: `/company/${cid}/reports/cheque-register`, letter: "Q" },
      ],
    },
    {
      letter: "U",
      title: "Utilities",
      items: [
        { label: "XML Import", to: `/company/${cid}/import`, letter: "X", hint: "Masters + vouchers" },
        { label: "Cheque Printing", to: `/company/${cid}/cheques` },
        { label: "Audit Trail", to: `/company/${cid}/audit`, hint: "Voucher history" },
        { label: "Company Settings", to: `/company/${cid}/settings` },
      ],
    },
  ], [cid, acct, masters]);

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

  const f5 = acct.find((v) => v.name === "Payment");
  const f8 = acct.find((v) => v.name === "Sales");
  const f9 = acct.find((v) => v.name === "Purchase");

  // R-53c: F2 belongs to date/period (Tally behaviour) — the Gateway carries
  // no F2. K (Day Book) is the keyboard path from here.
  useHotkeys({
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
        ...(f5 ? [{ key: "F5", label: "Payment", onClick: () => nav(`/company/${cid}/voucher/${f5.id}/new`) }] : []),
        ...(f8 ? [{ key: "F8", label: "Sales", onClick: () => nav(`/company/${cid}/voucher/${f8.id}/new`) }] : []),
        ...(f9 ? [{ key: "F9", label: "Purchase", onClick: () => nav(`/company/${cid}/voucher/${f9.id}/new`) }] : []),
      ]}
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
          {/* R-51: browsers reserve F6/F12/Alt+digits etc. in tab context; an
              app-mode (standalone) zprime window gets every key back. One
              notice line — the shortcut chips live in the Shell rail only. */}
          <p
            className="pt-2.5 border-t border-slate-100 text-xs text-slate-400 leading-relaxed"
            title="Browsers reserve F6, F12 and Alt+digits in tab view. Install app (HTTPS/localhost) or Create shortcut… → Open as window gives every key back. Full notes: README, Shortcut keys & the browser."
          >
            Some keys are browser-reserved in tab view — <b>install as an app</b> for the full keyboard.
          </p>
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
                className="fkey-item !min-h-[2.5rem]"
              >
                <span className="fkey-chip !min-w-[1.7rem] !px-0 shrink-0">{s.letter}</span>
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
          <p className="px-2 pt-2.5 pb-1 text-xs text-slate-400 leading-relaxed">
            Press a heading's letter — <b>V</b> · <b>K</b> · <b>C</b> · <b>A</b> · <b>R</b> ·{" "}
            <b>U</b> — then an item's letter. <b>Esc</b> closes the list.
          </p>
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
    </Shell>
  );
}
