import { ReactNode } from "react";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="block text-[12px] font-medium text-slate-600 mb-0.5">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-400 mt-0.5">{hint}</span>}
    </label>
  );
}

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return <div className="mb-3 rounded border border-red-200 bg-red-50 text-red-700 text-[13px] px-3 py-2">{msg}</div>;
}

export function Card({ children, className = "", onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return <div className={`bg-white rounded-lg shadow-sm border border-slate-200 ${className}`} onClick={onClick}>{children}</div>;
}

export function PageHead({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <div className="flex-1">
        <h1 className="text-[17px] font-semibold text-slate-800">{title}</h1>
        {sub && <p className="text-[12px] text-slate-500">{sub}</p>}
      </div>
      {actions}
    </div>
  );
}
