import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useCompany } from "../store";
import { useHotkeys } from "../lib/hotkeys";
import { useQuery } from "@tanstack/react-query";
import { get } from "../lib/api";
import GoTo from "./GoTo";
import { buildGatewayMenu, flattenMenu } from "../lib/gatewayMenu";

export interface FKeyButton { key: string; label: string; onClick?: () => void; }

/** App chrome: top bar, breadcrumb, page title anchor, function-key panel. */
export default function Shell({
  title, breadcrumb, fkeys, children, wide,
}: {
  title: string;
  breadcrumb?: { label: string; to?: string }[];
  fkeys?: FKeyButton[];
  children: any;
  wide?: boolean;
}) {
  const { cid } = useParams();
  const { company } = useCompany();
  const nav = useNavigate();

  // R-53c smart Esc: go back the way the user came. Shell's back arrow and
  // the history trail are the single Esc owner; pages register their own Esc
  // only for in-page surfaces (modals) — those handlers run first (capture
  // phase, later listeners first) and preventDefault() to claim the key, so a
  // modal Esc never also navigates. Deep links (no trail) fall back to the
  // Gateway. Nav redirects and Esc-driven backs are not part of the trail.
  //
  // v1.50.1 history barrier (operator rule): the Gateway is the LAST STOP —
  // browser Back at the Gateway must not climb to the company-select page
  // (reachable only via Logout / Switch Company), and the ← arrow has no
  // business on a page without a trail. Opening a company does a full page
  // load, so the SPA stack beneath the Gateway entry is exactly the
  // pre-Gateway trail (e.g. Companies) — while the Gateway is mounted we
  // bury it: every popstate re-pushes the Gateway entry, so Back is a no-op
  // at the top. Esc at a bare Gateway does nothing — Tally behaviour.
  const navBack = () => {
    if (nav.length > 1) nav(-1);
    else if (cid) nav(`/company/${cid}`);
    else nav("/companies");
  };
  const navBackRef = useRef(navBack);
  navBackRef.current = navBack;
  useEffect(() => {
    if (!breadcrumb || breadcrumb.length === 0) return; // pages own Esc without a trail
    const t = window.setTimeout(() => {
      const handler = (e: KeyboardEvent) => {
        if (e.key !== "Escape") return; // Esc-back only — any other key is not ours (v1.49 lesson: without this guard every keystroke back-navigates)
        if (e.defaultPrevented) return; // a page-level handler claimed it (e.g. modal Esc)
        navBackRef.current();
      };
      // Bubble phase: page-level useHotkeys handlers register in capture on the
      // same window, so they fire first and can claim Esc via preventDefault()
      // before our back-navigation ever sees the key.
      window.addEventListener("keydown", handler);
      (window as any).__zprimeEscBack = handler;
    }, 0);
    return () => {
      window.clearTimeout(t);
      const handler = (window as any).__zprimeEscBack;
      if (handler) {
        window.removeEventListener("keydown", handler);
        delete (window as any).__zprimeEscBack;
      }
    };
  }, [breadcrumb]);

  // v1.50.1: the barrier lives for the whole Gateway mount (breadcrumbless
  // company page). Mounting pushes one same-document duplicate of the
  // Gateway entry, so the FIRST Back pops within this document (absorbable)
  // instead of across the document boundary to the page that opened the
  // company (not absorbable — the browser would unload us). Every popstate
  // re-pushes the Gateway path, so the buried boundary never surfaces.
  useEffect(() => {
    if (!cid) return;
    if (breadcrumb && breadcrumb.length > 0) return;
    const gateway = window.location.pathname;
    const lock = () => window.history.pushState(null, "", gateway);
    lock();
    window.addEventListener("popstate", lock);
    return () => window.removeEventListener("popstate", lock);
  }, [breadcrumb, cid]);

  // R-54 (Tally): F3 = change company — available on EVERY company page,
  // including breadcrumbless ones (Gateway) where the Esc-back handler
  // deliberately does not register. F3 is page-interceptable in tab view
  // (not in the R-51 browser-reserved set).
  // R-62: Alt+S = Company Settings (Tally's Stock-Query chord, unused in
  // zprime) — same every-screen registration. The GoTo overlay claims keys
  // while open; both handlers no-op then via defaultPrevented.
  useEffect(() => {
    if (!cid) return;
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === "F3") { e.preventDefault(); nav("/companies"); }
      // R-62/R-63: Alt+S = Company Settings, Alt+O = Chart of Accounts —
      // both Tally-vocabulary chords (Stock Query / the O of "COA"), free
      // in zprime's chord space since the letter space is saturated.
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        if (e.key === "s" || e.key === "S") { e.preventDefault(); nav(`/company/${cid}/settings`); }
        if (e.key === "o" || e.key === "O") { e.preventDefault(); nav(`/company/${cid}/reports/chart-of-accounts`); }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [cid, nav]);

  // R-54 Option B: Alt+G = Go To (Tally's universal navigator) on every page.
  // Shares the Gateway's ["voucher-types", cid] query cache — no extra request.
  const { data: goToVoucherTypes } = useQuery({
    queryKey: ["voucher-types", cid],
    queryFn: () => get<{ id: number; name: string; category: string; functionKey: string | null }[]>(`/api/c/${cid}/voucher-types`),
    enabled: !!cid,
  });

  // R-64 (D-2): voucher F-keys are GLOBAL — the README always claimed
  // "F4…F9 from any screen"; before R-64 only Gateway and Day Book registered
  // them. Shell owns the floor layer from the same cached voucher-types query
  // (zero extra requests); the Gateway/Day Book maps continue to shadow it
  // (capture-phase per-page listeners run first) with identical targets.
  const globalFkeyMap = useMemo(() => {
    const m: Record<string, () => void> = {};
    for (const v of goToVoucherTypes ?? []) {
      const fk = (v.functionKey ?? "").trim();
      if (!fk || m[fk]) continue; // first type wins; duplicates ignored
      // Safety: suppressed while a voucher is open in the editor — a stray
      // F-key mid-entry must never silently discard a half-filled voucher
      // (Esc first, then the F-key; consistent with the Esc ladder).
      m[fk] = () => {
        if (window.location.pathname.includes("/voucher/")) return;
        nav(`/company/${cid}/voucher/${v.id}/new`);
      };
    }
    return m;
  }, [goToVoucherTypes, cid, nav]);
  useHotkeys(globalFkeyMap, [globalFkeyMap]);

  // R-64 (Phase C): after chord navigation the focus used to stay on BODY —
  // keyboard users had to Tab from the very top of the document. Anchor focus
  // on the page heading when nothing is focused (never steals focus from a
  // page that deliberately focused an input).
  const location = useLocation();
  useEffect(() => {
    if (document.activeElement === document.body) {
      // Page heading when the page has one (PageHead pages); otherwise the
      // main region itself (tabindex=-1 makes it focusable) — either way a
      // keyboard user continues from the top of the CONTENT, not the document.
      const h1 = document.querySelector("main h1") as HTMLElement | null;
      if (h1) h1.focus({ preventScroll: true });
      else (document.getElementById("main-content") as HTMLElement | null)?.focus({ preventScroll: true });
    }
  }, [location.pathname]);
  const [goToOpen, setGoToOpen] = useState(false);
  const goToItems = useMemo(
    () => flattenMenu(buildGatewayMenu(cid ?? "", (goToVoucherTypes ?? []).filter((v) => v.category === "Accounting" || v.category === "Inventory"))),
    [cid, goToVoucherTypes]
  );
  useHotkeys({ "Alt+G": () => setGoToOpen(true) }, [cid]);

  // R-52: standard pages use the full body width — the old max-w-7xl cap idled
  // 400+px on wide monitors while table columns squeezed. `wide` remains as an
  // explicit opt-out hook; both resolve to full width now.
  const container = "max-w-none";

  return (
    <div className="h-full flex flex-col bg-slate-100">
      {/* R-64 (Phase C): skip link — first tab stop for keyboard users. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-white focus:text-indigo-700 focus:px-3 focus:py-1.5 focus:rounded-md focus:shadow-raised focus:border focus:border-indigo-200"
      >
        Skip to content
      </a>
      <GoTo open={goToOpen} items={goToItems} onClose={() => setGoToOpen(false)} />
      <header className="sticky top-0 z-30">
        <div className="bg-indigo-700 text-white shadow-card">
          <div className={`mx-auto flex items-center gap-3 px-5 h-12 ${container}`}>
          {breadcrumb && breadcrumb.length > 0 && (
            <button
              onClick={() => navBackRef.current()}
              className="text-white/80 hover:text-white text-base px-1 -ml-1"
              title="Back (Esc)"
              aria-label="Back"
            >
              ←
            </button>
          )}
            <Link to={`/company/${cid}`} className="font-bold tracking-tight text-white">
              zprime
            </Link>
            {company && (
              <span className="text-indigo-200 text-sm truncate">
                · {company.name}
                {company.gstin ? ` (${company.gstin})` : ""}
              </span>
            )}
            <div className="flex-1" />
            <span className="text-indigo-100 text-sm font-medium hidden sm:inline">{title}</span>
            <div className="flex-1 hidden sm:block" />
            <Link to="/companies" className="text-sm text-indigo-200 hover:text-white whitespace-nowrap">
              Switch Company
            </Link>
            <span className="h-4 w-px bg-indigo-500/60 hidden sm:block" aria-hidden />
            <button
              onClick={async () => {
                await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
                window.location.href = "/login";
              }}
              className="text-sm text-indigo-200 hover:text-white"
            >
              Logout
            </button>
          </div>
        </div>

        {breadcrumb && breadcrumb.length > 0 && (
          <nav className={`mx-auto w-full px-5 bg-white/80 backdrop-blur border-b border-slate-200 ${container}`}>
            <div className="flex items-center gap-1.5 text-sm text-slate-500 py-2">
              {breadcrumb.map((b, i) => (
                <span key={b.label + String(i)} className="flex items-center gap-1.5">
                  {i > 0 && <span className="text-slate-300">›</span>}
                  {b.to ? (
                    <Link to={b.to} className="hover:text-indigo-600">{b.label}</Link>
                  ) : (
                    <span className="text-slate-700 font-medium">{b.label}</span>
                  )}
                </span>
              ))}
            </div>
          </nav>
        )}
      </header>

      <div className="flex-1 flex min-h-0">
        <main id="main-content" tabIndex={-1} className={`flex-1 overflow-auto px-5 py-6 outline-none ${fkeys?.length ? "" : ""}`}>
          <div className={wide ? "w-full" : "max-w-7xl mx-auto"}>
            {children}
          </div>
        </main>

        {fkeys && fkeys.length > 0 && (
          <aside aria-label={`${title} shortcuts`} className="w-64 shrink-0 p-3 overflow-auto hidden lg:block">
            <div className="sticky top-2 card p-2 space-y-1">
              <div className="px-2 pt-1 pb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                {title} shortcuts
              </div>
              {fkeys.map((f, i) => (
                <button key={i} onClick={f.onClick} className="fkey-item">
                  <span className="fkey-chip">{f.key}</span>
                  <span className="leading-snug">{f.label}</span>
                </button>
              ))}
            </div>
          </aside>
        )}
      </div>

      {fkeys && fkeys.length > 0 && (
        <div className="lg:hidden border-t border-slate-200 bg-white px-3 py-2 flex gap-2 overflow-x-auto">
          {fkeys.map((f, i) => (
            <button key={i} onClick={f.onClick} className="fkey-item w-auto shrink-0">
              <span className="fkey-chip">{f.key}</span>
              <span className="leading-snug">{f.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
