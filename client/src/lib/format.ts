export const num = (v: string | number | null | undefined): number => {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

export const r2 = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100;

export const inr = (v: number, decimals = 2): string =>
  v.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/** Signed display: negative numbers shown in red with minus */
export const drCr = (v: number): string => (Math.abs(v) < 0.005 ? "" : inr(Math.abs(v)));

export const fmtDate = (v: string | null | undefined): string => {
  if (!v) return "";
  const [y, m, d] = v.slice(0, 10).split("-");
  return `${d}-${m}-${y}`;
};

export const today = (): string => new Date().toISOString().slice(0, 10);

export function fyStart(dateStr: string): string {
  const dt = new Date(dateStr + "T00:00:00Z");
  const y = dt.getUTCFullYear();
  return dt.getUTCMonth() + 1 >= 4 ? `${y}-04-01` : `${y - 1}-04-01`;
}

export function fyEnd(dateStr: string): string {
  return `${parseInt(fyStart(dateStr).slice(0, 4), 10) + 1}-03-31`;
}

export const monthLabel = (m: string): string => {
  const [y, mo] = m.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[parseInt(mo, 10) - 1]}-${y}`;
};

export const cmp = (a: string, b: string) => a.localeCompare(b);
