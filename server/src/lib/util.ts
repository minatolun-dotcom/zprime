// Money/date helpers. Amounts are numeric(18,2) strings in Postgres (dr +, cr -).
// In JS we use plain numbers rounded to 2dp.

export function num(v: string | number | null | undefined): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

export function r2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** Format with 2 decimals, Indian grouping. */
export function fmtAmount(v: number): string {
  const s = v < 0 ? "-" : "";
  return s + Math.abs(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Indian short format for report columns: 1,23,45,678.90 */
export function inr(v: number, decimals = 2): string {
  return v.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function fmtQty(v: number, decimals = 2): string {
  return v.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}

// ---- Dates: store as 'YYYY-MM-DD' strings ----
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function d(v: string | Date | null | undefined): string {
  if (!v) return "";
  if (typeof v === "string") return v.slice(0, 10);
  return v.toISOString().slice(0, 10);
}

export function fmtDate(v: string | null | undefined): string {
  if (!v) return "";
  const [y, m, dd] = v.slice(0, 10).split("-");
  return `${dd}-${m}-${y}`;
}

/** Financial year start (1 Apr) for a given date. */
export function fyStart(dateStr: string): string {
  const dt = new Date(dateStr + "T00:00:00Z");
  const y = dt.getUTCFullYear();
  return dt.getUTCMonth() + 1 >= 4 ? `${y}-04-01` : `${y - 1}-04-01`;
}

/** Financial year end (31 Mar) for a given date. */
export function fyEnd(dateStr: string): string {
  const s = fyStart(dateStr);
  return `${parseInt(s.slice(0, 4), 10) + 1}-03-31`;
}

export function addDays(dateStr: string, days: number): string {
  const dt = new Date(dateStr + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function cmpDate(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 'YYYY-MM' helpers for payroll */
export function monthOf(dateStr: string): string {
  return dateStr.slice(0, 7);
}

export function monthLabel(m: string): string {
  const [y, mo] = m.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[parseInt(mo, 10) - 1]}-${y}`;
}
