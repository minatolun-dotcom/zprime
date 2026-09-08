import { Link, useNavigate, useParams } from "react-router-dom";
import { useCompany } from "../store";

export interface FKeyButton { key: string; label: string; onClick?: () => void; }

/** App top bar + optional right-side function key panel. */
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

  return (
    <div className="h-full flex flex-col">
      <header className="bg-indigo-700 text-white shadow">
        <div className={`mx-auto flex items-center gap-3 px-4 h-11 ${wide ? "max-w-none" : "max-w-7xl"}`}>
          <button onClick={() => nav(-1)} className="text-white/80 hover:text-white text-sm" title="Back (Esc)">
            ←
          </button>
          <Link to={`/company/${cid}`} className="font-semibold tracking-tight hover:text-indigo-100">
            zprime
          </Link>
          {company && (
            <span className="text-indigo-200 text-[13px] truncate">
              · {company.name}
              {company.gstin ? ` (${company.gstin})` : ""}
            </span>
          )}
          <div className="flex-1" />
          <span className="text-indigo-100 text-[13px] font-medium">{title}</span>
          <div className="flex-1" />
          <Link to="/companies" className="text-[13px] text-indigo-200 hover:text-white">
            Switch Company
          </Link>
          <button
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
              window.location.href = "/login";
            }}
            className="text-[13px] text-indigo-200 hover:text-white"
          >
            Logout
          </button>
        </div>
      </header>

      {breadcrumb && breadcrumb.length > 0 && (
        <nav className={`mx-auto w-full px-4 pt-2 ${wide ? "max-w-none" : "max-w-7xl"}`}>
          <div className="flex items-center gap-1 text-[12px] text-slate-500">
            {breadcrumb.map((b, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span>›</span>}
                {b.to ? <Link to={b.to} className="hover:text-indigo-600">{b.label}</Link> : <span className="text-slate-700">{b.label}</span>}
              </span>
            ))}
          </div>
        </nav>
      )}

      <div className="flex-1 flex min-h-0">
        <main className={`flex-1 overflow-auto ${wide ? "px-4" : "px-4"} py-3`}>
          <div className={wide ? "w-full" : "max-w-7xl mx-auto"}>{children}</div>
        </main>
        {fkeys && fkeys.length > 0 && (
          <aside className="w-40 shrink-0 border-l border-slate-200 bg-white/70 p-2 space-y-1 overflow-auto hidden md:block">
            {fkeys.map((f, i) => (
              <button
                key={i}
                onClick={f.onClick}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-[12px] text-slate-700 hover:bg-indigo-50"
              >
                <span className="fkey-chip">{f.key}</span>
                <span className="truncate">{f.label}</span>
              </button>
            ))}
          </aside>
        )}
      </div>
    </div>
  );
}
