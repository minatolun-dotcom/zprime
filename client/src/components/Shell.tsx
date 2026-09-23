import { Link, useNavigate, useParams } from "react-router-dom";
import { useCompany } from "../store";

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

  const container = wide ? "max-w-none" : "max-w-7xl";

  return (
    <div className="h-full flex flex-col bg-slate-100">
      <header className="sticky top-0 z-30">
        <div className="bg-indigo-700 text-white shadow-card">
          <div className={`mx-auto flex items-center gap-3 px-5 h-12 ${container}`}>
            <button
              onClick={() => nav(-1)}
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
                <span key={i} className="flex items-center gap-1.5">
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
          <aside className="w-48 shrink-0 p-3 overflow-auto hidden lg:block">
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
