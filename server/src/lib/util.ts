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

/** Financial year start for a given date. R-56: honours the company's
 *  stored financialYearStart ('YYYY-MM-DD'); April when absent (F1 fix). */
export function fyStart(dateStr: string, fyBegin?: string): string {
  const bmRaw = fyBegin ? parseInt(fyBegin.slice(5, 7), 10) : 4;
  const bm = Number.isFinite(bmRaw) && bmRaw >= 1 && bmRaw <= 12 ? bmRaw : 4;
  const dt = new Date(dateStr + "T00:00:00Z");
  const y = dt.getUTCFullYear();
  const begin = (yy: number) => `${String(yy).padStart(4, "0")}-${String(bm).padStart(2, "0")}-01`;
  return dt.getUTCMonth() + 1 >= bm ? begin(y) : begin(y - 1);
}

/** Financial year end (day before the next FY begin) for a given date. */
export function fyEnd(dateStr: string, fyBegin?: string): string {
  const s = fyStart(dateStr, fyBegin);
  const dt = new Date(s + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() - 1);
  const next = new Date(dt.getTime());
  next.setUTCFullYear(next.getUTCFullYear() + 1);
  return next.toISOString().slice(0, 10);
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
