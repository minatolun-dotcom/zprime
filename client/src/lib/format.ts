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

/** Default FY begin: April (Indian statutory default, unchanged). */
export const FY_BEGIN_MONTH = 4; // April, 1-based

export function fyStart(dateStr: string, fyBegin?: string): string {
  const bm = fyBegin ? clampFyMonth(fyBegin) : FY_BEGIN_MONTH;
  const dt = new Date(dateStr + "T00:00:00Z");
  const y = dt.getUTCFullYear();
  return dt.getUTCMonth() + 1 >= bm ? fyBeginDate(y, bm) : fyBeginDate(y - 1, bm);
}

export function fyEnd(dateStr: string, fyBegin?: string): string {
  const bm = fyBegin ? clampFyMonth(fyBegin) : FY_BEGIN_MONTH;
  const dt = new Date(dateStr + "T00:00:00Z");
  const y = dt.getUTCFullYear();
  const endYear = dt.getUTCMonth() + 1 >= bm ? y + 1 : y;
  const endMonth = ((bm + 10) % 12) + 1; // month before fyBegin, wrapped (bm=4 → 3, bm=1 → 12)
  return `${String(endYear).padStart(4, "0")}-${String(endMonth).padStart(2, "0")}-${lastDayOf(endYear, endMonth)}`;
}

const fyBeginDate = (y: number, bm: number) => `${String(y).padStart(4, "0")}-${String(bm).padStart(2, "0")}-01`;
const clampFyMonth = (fyBegin: string): number => {
  const m = parseInt(fyBegin.slice(5, 7), 10);
  return Number.isFinite(m) && m >= 1 && m <= 12 ? m : FY_BEGIN_MONTH;
};
const lastDayOf = (y: number, m: number): string => String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0");

/** R-56: FY end for a company whose FY begins on the stored date `begin`
 *  (anniversary − 1 day). The stored financialYearStart IS the anchor —
 *  never recompute it from today's date. */
export function fyEndFromBegin(begin: string): string {
  const dt = new Date(begin + "T00:00:00Z");
  dt.setUTCFullYear(dt.getUTCFullYear() + 1);
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

// ---- R-56: session current period (Tally Alt+F2) — per company, client-only ----
// Tally's recommended multi-FY path: change the CURRENT PERIOD (Alt+F2); the
// company's FY-begin/books-begin stay untouched and balances carry forward.
// The period is a session lens over the same books, so it lives in
// localStorage per company (not the DB) and every period-defaulting page
// (Day Book, Reports) seeds from it instead of recomputing the FY.
export const sessionPeriodKey = (cid: string | number | undefined): string => `zprime_period_${cid ?? ""}`;

export function loadSessionPeriod(cid: string | number | undefined): { from: string; to: string } | null {
  try {
    const raw = localStorage.getItem(sessionPeriodKey(cid));
    if (!raw) return null;
    const p = JSON.parse(raw);
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (p && typeof p.from === "string" && typeof p.to === "string" && dateRe.test(p.from) && dateRe.test(p.to) && p.from <= p.to) return { from: p.from, to: p.to };
  } catch { /* corrupt or unavailable storage — fall through */ }
  return null;
}

export function saveSessionPeriod(cid: string | number | undefined, period: { from: string; to: string }) {
  try { localStorage.setItem(sessionPeriodKey(cid), JSON.stringify(period)); } catch { /* storage unavailable — period stays in-page */ }
}

export function clearSessionPeriod(cid: string | number | undefined) {
  try { localStorage.removeItem(sessionPeriodKey(cid)); } catch { /* storage unavailable */ }
}

export const monthLabel = (m: string): string => {
  const [y, mo] = m.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[parseInt(mo, 10) - 1]}-${y}`;
};

export const cmp = (a: string, b: string) => a.localeCompare(b);
