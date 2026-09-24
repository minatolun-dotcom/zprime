import { useState } from "react";
import { fyStart, fyEndFromBegin, today } from "./format";
const fyEnd = (d: string) => fyEndFromBegin(fyStart(d));

/**
 * R-56 (F1 fix): period state whose DEFAULT comes from the session current
 * period (Alt+F2, per company) when set, else the company's STORED financial
 * year (company.financialYearStart) — never a hardcoded April.
 *
 * The stored financialYearStart date IS the anchor: the FY window is
 * [stored begin, begin + 1 year − 1 day]. The `to` default stays today()
 * (running window — the FY is not over until it's over); the stored FY-end
 * is available via fyEndFromBegin for the Gateway's FY line.
 *
 * Two-stage on purpose: while the company query is still in flight the hook
 * yields the classic April–March window so the date inputs never flash empty;
 * once `company` arrives the effective window is the company's own FY.
 *
 * `override` is null until the user explicitly changes a date on THIS page;
 * from then on the explicit value wins over both defaults.
 */
export function useCompanyPeriod(
  company: { financialYearStart: string } | undefined,
  session?: { from: string; to: string } | null
): { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void } {
  const [override, setOverride] = useState<{ from: string; to: string } | null>(null);
  const fyFrom = company?.financialYearStart || fyStart(today());
  const fyTo = company?.financialYearStart ? fyEndFromBegin(company.financialYearStart) : fyEnd(today());
  const from = override?.from ?? session?.from ?? fyFrom;
  const to = override?.to ?? session?.to ?? today();
  return {
    from,
    to,
    setFrom: (v: string) => setOverride((o) => ({ from: v, to: o?.to ?? to })),
    setTo: (v: string) => setOverride((o) => ({ from: o?.from ?? from, to: v })),
  };
}
