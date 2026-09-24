# R-60_INVESTIGATION.md — cross-FY report comparison vs TallyPrime (R-55 study's remaining candidate, G6)

**Status:** INVESTIGATION — zero production code touched. Operator request: *"Investigate per-FY reporting periods next (R-55 study's remaining candidate)."*

---

## 1. Framing: what "per-FY reporting" means in zprime's model

The R-55 study (`R-55_INVESTIGATION.md`) established zprime's architecture as Tally's recommended "change period" model: **one company holds every year of data**; balances carry forward automatically because every report computes its own openings from history. Options A (v1.52.0: session current period Alt+F2, stored-FY defaults, honest date windows) and B (v1.53.0: R-57 per-FY voucher-numbering restart) shipped. What remained from the study's gap table was **G6 — cross-year report comparison (prev-year columns via Tally's F12)**, marked "feature, defer" with the note *"data supports it."* This investigation verifies that claim on v1.53.0's code and sizes the work.

## 2. Code-verified state (v1.53.0)

**Server — the engine is fully period-parametric, so comparison is a data-reshaping problem, not an engine problem:**

- Every report takes explicit `from`/`to` (`period()` helper in `reports.ts` resolves query params against the company's stored FY). `trialBalance`, `profitAndLoss`, `balanceSheet`, `cashBankBook`, `register`, `ledgerVouchers` (`services/accounting.ts`) are pure functions of `(companyId, period)` with zero hidden year state. No migration needed — nothing is stored per-FY; a "previous FY column" is literally a second call with a shifted window.
- `profitAndLoss` returns flat scalars (`sales`, `purchases`, `openingStock`, `closingStock`, `directExpenses`, `directIncome`, `grossProfit`, `indirectExpenses`, `indirectIncome`, `netProfit`) + per-ledger detail arrays — trivially comparable per key.
- `trialBalance` returns rows keyed by `ledgerId` with opening/debit/credit + totals + `difference` — joins naturally across two runs on `ledgerId`.
- `balanceSheet(companyId, asOf)` is **as-of** (single date param) — a prior-FY column is one extra call with `asOf = priorFYEnd`.
- **P&L caveat verified:** the stock legs come from `stockClosingValue(companyId, date, "Stock-in-Hand")` at `from−1` and `to` — independent calls per window compose correctly; no shared mutable state.

**Client — the report shell is period-driven already:**

- `Reports.tsx` centralises the window: `useCompanyPeriod` (session period Alt+F2 first, stored FY second) → `qs` → one `useQuery` per report key. The three big reports render from typed-ish `data` props: `BalanceSheetView` (recursive `TreeRows`, Dr/Cr columns), `PnlView` (four sub-tables via `DrCr`/`CrOnly` cell helpers), `TrialBalanceView` (flat table + CSV export).
- Nothing on any report page knows about "years" — adding a comparison column means feeding each view a second payload and a label pair. The shell is the single place to fetch it.

**Tally parity reference (F12 "Show Previous Year figures"):** Tally toggles a prior-year column on the same reports (P&L, Balance Sheet, Trial Balance, registers) and prints `Current vs Previous` with the company's FY labels. That is exactly the shape proposed below — a per-report toggle, not a new report type.

## 3. Findings

- **F-60-1 (feasibility, green):** G6 needs **zero schema change and zero engine change** — the server can expose comparison either as one composed endpoint or (client-composed) two plain report calls. The engine's period-agnosticism (R-55's central finding) is what makes this cheap; the study's "data supports it" note is confirmed on today's code.
- **F-60-2 (composition decision):** two credible wirings — **(a) client-composed**: the Reports shell fires the existing endpoint twice (shifted window) and joins in the view; zero server diff. **(b) server-composed**: new optional `compare=1` (or `prev=1`) param on the three big reports returning `{ current, previous, labels }`; one round-trip, the join lives next to the engine, suites assert one payload. (b) is the honest engineering choice: it keeps the derivation of "what is the prior-FY window" server-side (mirrors the stored-FY logic the server already owns via `fyStart`), gives suites a single contract, and avoids duplicating window arithmetic in the client — at the cost of ~30 lines in `reports.ts` per report.
- **F-60-3 (window semantics to pin down):** "previous" must mirror the CURRENT window's length, not blindly the prior FY: a full-FY view (2026-04-01→2027-03-31) compares against the full prior FY (2025-04-01→2026-03-31), and a mid-year slice (e.g. 2026-04-01→2026-06-30) compares against the same slice one year earlier (2025-04-01→2025-06-30) — Tally does the latter for period reports. Balance Sheet's "as on" compares `to` against the prior FY's closing date (one year back, same month/day; clamped to books-begin if the company's books don't reach that far back — in which case the column renders blank/honest-dash, not a wrong number). A session period (Alt+F2) that spans partial years shifts both windows identically.
- **F-60-4 (pre-books / short-history honesty):** companies whose books begin inside the current FY have no prior-year data; the column must render as an explicit dash, never a fabricated zero, and the CSV export must carry the empty column (not drop it) so headers stay stable.
- **F-60-5 (no cross-FY uniqueness risk):** R-57's numbering buckets do not interact — comparison reads vouchers read-only; no counter/number logic is touched.
- **F-60-6 (registers/other reports out of scope for the first cut):** Sales/Purchase registers and cash-book comparison are Tally parity too, but the operator value concentrates in the three headline statements (P&L, BS, TB). Registers carry per-voucher rows where a "prev column" means side-by-side row lists, a genuinely different UI problem — documented as a follow-on, not smuggled in.
- **F-60-7 (performance):** each comparison doubles the affected queries for that report view (two windows). At zprime's scale (the R-55 study already ruled out the performance-motivated "split data" path) this is immaterial; the queries are the same indexed aggregates the page already runs.

## 4. Implementation options (for a future approved cycle — NOT scheduled)

**Option A — server-composed comparison on the big three (recommended):**
1. `reports.ts`: `trial-balance`, `profit-loss`, `balance-sheet` accept `compare=1`. The route derives the prior window per F-60-3 (shift `from`/`to` back one year; BS: `to` back one year, clamp/blank per F-60-4), calls the SAME service function twice, returns `{ ...currentShape, previous: <same shape>, compareLabels: { current, previous } }`.
2. Client: a **"Prev Year" toggle** in the Reports toolbar (and `Alt+C`... taken — the chip is click-only, or a second-pass key if the operator wants a hotkey) on the three views; when on, each view renders the prior column beside the current one: TB gains `Prev Debit/Prev Credit` (or compact `Prev Closing`), P&L gains a `Prev` column per line (labels `FY 2025-26` / `FY 2024-25` from `compareLabels`), BS gains a `Prev` Dr/Cr pair or a compact net column; CSV exports include the columns; blank history renders dashes.
3. `r60_ui.js`: post vouchers in two FYs of one company (April-begin, spanning 2025-26 and 2026-27 — the R-57 fixture pattern), assert prior column values, slice-window semantics, blank-history dashes, CSV headers, and zero page errors.

**Option B — client-composed (zero server diff):** the shell fetches the same endpoint twice and the views join. Rejected as primary: duplicates window arithmetic client-side, two round-trips to keep in sync, and the "prior window" rule (F-60-3) would live in the wrong layer.

**Option C — A + registers/cash-book comparison (follow-on):** explicitly deferred with F-60-6's rationale.

**Recommendation:** Option A, v1.53.x-to-v1.54.0-sized (server ~100 lines incl. window derivation, client view columns + toggle, one new suite). Nothing is scheduled until the operator approves.

## 5. Sources

- zprime code on v1.53.0: `server/src/services/accounting.ts` (trialBalance/profitAndLoss/balanceSheet/cashBankBook signatures and stock legs), `server/src/routes/reports.ts` (period() resolution, route shapes), `client/src/pages/Reports.tsx` (report shell, useCompanyPeriod, the three view components, TreeRows), `client/src/lib/period.ts` (session/stored-FY window logic), `server/src/lib/util.ts` (fyStart/fyEnd/fyKeyOf — the primitives the prior-window derivation reuses).
- TallyHelp reference carried in `R-55_INVESTIGATION.md` §1 (F12 previous-year columns; change-period model) — no new fetch needed; the study's gap table row G6 is the mandate.
