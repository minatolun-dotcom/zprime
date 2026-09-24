import { useEffect, useRef } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useCompany } from "../store";
import { useHotkeys } from "../lib/hotkeys";

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
        if (e.key !== "Escape") return; // Esc-back only — any other key is not ours
        if (e.defaultPrevented) return; // a page-level Esc claimed it (e.g. modal)
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

  // R-52: standard pages use the full body width — the old max-w-7xl cap idled
  // 400+px on wide monitors while table columns squeezed. `wide` remains as an
  // explicit opt-out hook; both resolve to full width now.
  const container = "max-w-none";

  return (
    <div className="h-full flex flex-col bg-slate-100">
      <header className="sticky top-0 z-30">
        <div className="bg-indigo-700 text-white shadow-card">
          <div className={`mx-auto flex items-center gap-3 px-5 h-12 ${container}`}>
            <button
              onClick={() => navBackRef.current()}
              className="text-white/80 hover:text-white text-base px-1 -ml-1"
              title="Back (Esc)"
              aria-label="Back"
            >
              ←
            </button>
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
        <main className={`flex-1 overflow-auto px-5 py-6 ${fkeys?.length ? "" : ""}`}>
          <div className={wide ? "w-full" : "max-w-7xl mx-auto"}>
            {children}
          </div>
        </main>

        {fkeys && fkeys.length > 0 && (
          <aside className="w-64 shrink-0 p-3 overflow-auto hidden lg:block">
            <div className="sticky top-2 card p-2 space-y-1">
              <div className="px-2 pt-1 pb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                Shortcuts
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
