// R-53c/R-54/R-61: single source of truth for the Gateway menu tree — consumed by
// the Gateway page (letter navigation) and the Go To palette (Alt+G, Tally's
// universal navigator).
//
// R-61 mirrors TallyPrime's Gateway organization ("Gateway of Tally is
// organised into Masters, Vouchers, Utilities, and Reports" — TallyHelp):
// the middle column carries the four section headers, Utilities items and
// the headline reports sit DIRECTLY on level 1 (Tally's seamlessness — no
// drill to see them), and the report tail hides behind a letterless
// "Display More Reports" expander (Tally's own pattern). Create/Alter keep
// a contents pane because zprime's masters are pages, not modes.
//
// Letters remain globally unique per R-53c, and every letter that existed
// before R-61 keeps firing the same target (muscle memory intact): the
// R-53/R-59 heading letters R and U are FREED (their headings became the
// Reports/Utilities section labels), never reassigned. Company Settings
// stays letterless by arithmetic (all 26 letters + 10 digits taken);
// Display More Reports uses the distinct "…" chip — punctuation, so not
// pressable (click/arrow/Enter only), same class as Company Settings' "·".

export interface MenuLeaf { label: string; to: string; letter?: string; hint?: string; }
export interface MenuEntry {
  letter: string;
  title: string;
  /** Direct navigation targets (Day Book, promoted items) skip the contents pane. */
  to?: string;
  /** Contents shown in the right pane when the heading is selected. */
  items?: MenuLeaf[];
  /** R-61: Tally section label rendered above this entry (first entry of each section). */
  header?: string;
  /** Optional tooltip for direct level-1 entries. */
  hint?: string;
}

export function buildGatewayMenu(cid: string, acct: { id: number; name: string; functionKey: string | null }[]): MenuEntry[] {
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
  const allReports: MenuLeaf[] = [
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
  ];
  // R-61: Tally lists the headline statements directly on the Gateway; the
  // tail hides behind "Display More Reports". Letters are unchanged either way.
  const headline = new Set([
    "Balance Sheet", "Profit & Loss A/c", "Trial Balance", "Cash / Bank Book",
    "Sales Register", "Purchase Register", "Stock Summary",
  ]);
  const moreReports = allReports.filter((r) => !headline.has(r.label));

  return [
    // ---- MASTERS (Tally section 1) — Create/Alter keep a pane: zprime's
    // masters are pages; Tally's Create/Alter is a mode over the same list.
    { header: "Masters", letter: "C", title: "Create", items: masters },
    { letter: "A", title: "Alter", items: masters },
    // ---- TRANSACTIONS (Tally section 2)
    {
      header: "Transactions",
      letter: "V",
      title: "Vouchers",
      items: [
        ...acct.map((v) => ({ label: v.name, to: `/company/${cid}/voucher/${v.id}/new`, hint: v.functionKey ?? "" })),
        { label: "Process Payroll", to: `/company/${cid}/payroll`, letter: "W", hint: "Monthly salary vouchers" },
      ],
    },
    { letter: "K", title: "Day Book", to: `/company/${cid}/daybook` },
    // ---- UTILITIES (Tally section 3) — items promoted to level 1 (R-61;
    // they were one drill behind the U pane, invisible until opened).
    { header: "Utilities", letter: "X", title: "XML Import", to: `/company/${cid}/import`, hint: "Masters + vouchers" },
    { letter: "J", title: "Cheque Printing", to: `/company/${cid}/cheques` },
    { letter: "Z", title: "Audit Trail", to: `/company/${cid}/audit`, hint: "Voucher history" },
    // ---- REPORTS (Tally section 4) — headline statements at level 1,
    // tail behind the letterless expander.
    { header: "Reports", letter: "B", title: "Balance Sheet", to: `/company/${cid}/reports/balance-sheet` },
    { letter: "F", title: "Profit & Loss A/c", to: `/company/${cid}/reports/profit-loss` },
    { letter: "T", title: "Trial Balance", to: `/company/${cid}/reports/trial-balance` },
    { letter: "H", title: "Cash / Bank Book", to: `/company/${cid}/reports/cash-bank` },
    { letter: "S", title: "Sales Register", to: `/company/${cid}/reports/register-sales` },
    { letter: "P", title: "Purchase Register", to: `/company/${cid}/reports/register-purchase` },
    { letter: "M", title: "Stock Summary", to: `/company/${cid}/reports/stock-summary` },
    {
      letter: "…",
      title: "Display More Reports",
      items: moreReports,
    },
    // R-59: Company Settings at level 1 (letterless — all 26 letters + 10
    // digits are allocated; R-53c arithmetic). Tally parks administrative
    // entry points last on the Gateway too ("Display More"); the Settings
    // page hosts Users, which deserves one-keystroke-less discoverability.
    { letter: "·", title: "Company Settings", to: `/company/${cid}/settings` },
  ];
}

/**
 * Flattened menu for the Go To palette: every navigable option with its path.
 * Create and Alter share one masters option set (R-53c) — the palette shows
 * each option once (first occurrence wins, i.e. Create). R-61: sections are
 * the Tally area the option lives in (Masters/Transactions/Utilities/Reports);
 * letterless direct entries (Day Book, Company Settings) stay "Gateway".
 */
export interface GoToItem { label: string; to: string; section: string; letter?: string; }

export function flattenMenu(entries: MenuEntry[]): GoToItem[] {
  const out: GoToItem[] = [];
  const seen = new Set<string>();
  for (const s of entries) {
    if (s.to) out.push({ label: s.title, to: s.to, section: s.header ?? "Gateway", letter: s.letter });
    const itemSection = s.title === "Display More Reports" ? "Reports" : (s.header ?? s.title);
    for (const it of s.items ?? []) {
      const key = `${it.label}\u0000${it.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ label: it.label, to: it.to, section: itemSection, letter: it.letter });
    }
  }
  return out;
}
