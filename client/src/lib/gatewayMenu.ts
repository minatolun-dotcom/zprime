// R-54/R-62: single source of truth for the Gateway menu tree — consumed by the
// Gateway page (letter navigation) and the Go To palette (Alt+G, Tally's
// universal navigator). Letters are globally unique per R-53c.
//
// R-62 (operator-specified arrangement): headings read Create, Alter,
// Vouchers, Day Book, Reports, Utilities, Company Settings. The Vouchers
// pane is ordered by shortcut class — F-keys first (F4…F10), then Alt+
// chords, then Ctrl+ chords, keyless last (same rule as the Day Book rail).
// Company Settings carries a real Alt+S chord (Tally's Stock-Query slot,
// unused in zprime), registered globally in Shell and advertised on its
// chip; the plain letter S stays with Sales Register. R-59's unpressable
// · chip is retired.

export interface MenuLeaf { label: string; to: string; letter?: string; hint?: string; }
export interface MenuEntry {
  letter: string;
  title: string;
  /** Direct navigation targets (Day Book) skip the contents pane. */
  to?: string;
  /** Contents shown in the right pane when the heading is selected. */
  items?: MenuLeaf[];
  /** Full chord shortcut (e.g. "Alt+S") advertised on the chip — for entries
   *  whose plain letter would collide with an item letter (R-62: Company
   *  Settings; plain S belongs to Sales Register). Registered in Shell. */
  chord?: string;
}

/** R-62: sort rank for voucher types by shortcut class — plain F-keys
 *  (F4…F10, numeric order) first, then Alt+ chords, then Ctrl+ chords,
 *  keyless types last. Shared by the Vouchers pane and the Gateway rail. */
export function voucherKeyRank(functionKey: string | null | undefined): number {
  const k = (functionKey ?? "").trim();
  let m: RegExpMatchArray | null;
  if ((m = k.match(/^F(\d+)$/i))) return parseInt(m[1], 10); // F4 → 4 … F10 → 10
  if ((m = k.match(/^Alt\+F(\d+)$/i))) return 100 + parseInt(m[1], 10);
  if ((m = k.match(/^Ctrl\+F(\d+)$/i))) return 200 + parseInt(m[1], 10);
  return 999; // keyless (e.g. Payroll) last
}

export function buildGatewayMenu(cid: string, acct: { id: number; name: string; functionKey: string | null }[]): MenuEntry[] {
  // R-62 (operator-specified arrangement): the Vouchers pane is ordered by its
  // shortcut class — plain F-keys first (F4, F5, … F10), then the Alt+ chords
  // (Alt+F5 … Alt+F9), then the Ctrl+ chords (Ctrl+F7), keyless types last —
  // the same order the Day Book's F-key rail already uses. Pure presentation:
  // the seed order in the database is untouched.
  const voucherItems: MenuLeaf[] = [
    ...[...acct].sort((a, b) => voucherKeyRank(a.functionKey) - voucherKeyRank(b.functionKey))
      .map((v) => ({ label: v.name, to: `/company/${cid}/voucher/${v.id}/new`, hint: v.functionKey ?? "" })),
    { label: "Process Payroll", to: `/company/${cid}/payroll`, letter: "W", hint: "Monthly salary vouchers" },
  ];
  const masters: MenuLeaf[] = [
    { label: "Ledgers", to: `/company/${cid}/masters/ledgers`, letter: "L", hint: "Create / alter ledger accounts" },
    { label: "Groups", to: `/company/${cid}/masters/groups`, letter: "G", hint: "Account groups (28 pre-defined)" },
    { label: "Stock Items", to: `/company/${cid}/masters/stock-items`, letter: "I", hint: "Inventory items" },
    { label: "Units of Measure", to: `/company/${cid}/masters/units`, letter: "N" },
    { label: "Stock Groups", to: `/company/${cid}/masters/stock-groups`, letter: "2" },
    { label: "Godowns / Locations", to: `/company/${cid}/masters/godowns`, letter: "O" },
    { label: "Voucher Types", to: `/company/${cid}/masters/voucher-types`, letter: "Y" },
    { label: "TDS Sections", to: `/company/${cid}/masters/tds-sections`, letter: "D" },
    { label: "TCS Sections", to: `/company/${cid}/masters/tcs-sections`, letter: "4" },
    { label: "Employees & Payroll", to: `/company/${cid}/masters/employees`, letter: "E" },
  ];
  return [
    // R-62 (operator-specified order): Create, Alter, Vouchers, Day Book,
    // Reports, Utilities, Company Settings — masters first, then the
    // transaction surfaces, then reports and utilities.
    { letter: "C", title: "Create", items: masters },
    { letter: "A", title: "Alter", items: masters },
    {
      letter: "V",
      title: "Vouchers",
      items: voucherItems,
    },
    { letter: "K", title: "Day Book", to: `/company/${cid}/daybook` },
    {
      letter: "R",
      title: "Reports",
      items: [
        { label: "Balance Sheet", to: `/company/${cid}/reports/balance-sheet`, letter: "B" },
        { label: "Profit & Loss A/c", to: `/company/${cid}/reports/profit-loss`, letter: "F" },
        { label: "Trial Balance", to: `/company/${cid}/reports/trial-balance`, letter: "T" },
        { label: "Cash / Bank Book", to: `/company/${cid}/reports/cash-bank`, letter: "H" },
        { label: "Sales Register", to: `/company/${cid}/reports/register-sales`, letter: "S" },
        { label: "Purchase Register", to: `/company/${cid}/reports/register-purchase`, letter: "P" },
        { label: "Stock Summary", to: `/company/${cid}/reports/stock-summary`, letter: "M" },
        { label: "Receivables (B/R)", to: `/company/${cid}/reports/receivables`, letter: "5" },
        { label: "Payables (B/P)", to: `/company/${cid}/reports/payables`, letter: "6" },
        { label: "GSTR-1", to: `/company/${cid}/reports/gstr1`, letter: "1" },
        { label: "GSTR-3B", to: `/company/${cid}/reports/gstr3b`, letter: "3" },
        { label: "GSTR-9 (Annual)", to: `/company/${cid}/reports/gstr9`, letter: "9" },
        { label: "TDS Report", to: `/company/${cid}/reports/tds`, letter: "7" },
        { label: "TCS Report", to: `/company/${cid}/reports/tcs`, letter: "8" },
        { label: "Salary Register", to: `/company/${cid}/reports/salary-register`, letter: "0" },
        { label: "Cheque Register", to: `/company/${cid}/reports/cheque-register`, letter: "Q" },
      ],
    },
    {
      letter: "U",
      title: "Utilities",
      items: [
        { label: "XML Import", to: `/company/${cid}/import`, letter: "X", hint: "Masters + vouchers" },
        { label: "Cheque Printing", to: `/company/${cid}/cheques`, letter: "J" },
        { label: "Audit Trail", to: `/company/${cid}/audit`, letter: "Z", hint: "Voucher history" },
      ],
    },
    // R-62: Company Settings carries a REAL shortcut — Alt+S (Tally's
    // Stock-Query chord, unused in zprime) registered globally in Shell, so
    // Settings is one chord from any screen. The chip advertises the chord;
    // the plain letter S stays with Sales Register (no collision). This
    // replaces R-59's letterless · chip (an unpressable punctuation chip was
    // a dead end — the operator asked for a real shortcut).
    { letter: "·", chord: "Alt+S", title: "Company Settings", to: `/company/${cid}/settings` },
  ];
}

/**
 * Flattened menu for the Go To palette: every navigable option with its path.
 * Create and Alter share one masters option set (R-53c) — the palette shows
 * each option once (first occurrence wins, i.e. Create).
 */
export interface GoToItem { label: string; to: string; section: string; letter?: string; }

export function flattenMenu(entries: MenuEntry[]): GoToItem[] {
  const out: GoToItem[] = [];
  const seen = new Set<string>();
  for (const s of entries) {
    if (s.to) out.push({ label: s.title, to: s.to, section: "Gateway", letter: s.chord ?? s.letter });
    for (const it of s.items ?? []) {
      const key = `${it.label}\u0000${it.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ label: it.label, to: it.to, section: s.title, letter: it.letter });
    }
  }
  return out;
}
