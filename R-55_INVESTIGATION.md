# R-55_INVESTIGATION.md — multi-financial-year support vs TallyPrime (REFERENCE: official TallyHelp "Moving to the Next Financial Year", doc date 2026-03-26)

**Status:** INVESTIGATION — zero production code touched. Operator question: *"what about financial years, multiple financial year support like TallyPrime?"*

---

## 1. How TallyPrime actually does it (official doc, summarised)

TallyPrime offers **four paths**; the recommended default is the first:

1. **Change Current Period (`Alt+F2`)** — *one company holds every year of data*. "Current period" is a **session/view setting**, not a data change: `FY beginning from` and `Books beginning from` on the company remain unchanged; balances from the previous FY carry forward automatically; reports can compare across years because the data is continuous. Recommended when books are not yet audited, continuity matters, year-end adjustments may still land. Costs: data grows yearly, performance decays over time.
2. **New company + import openings** — export closing balances (Excel/XML) from the old company, create a new company with the new FY-begin, import them as opening balances. For audited-history continuity in a fresh company.
3. **New company, start afresh** — no carry-forward (restructuring, new GSTIN).
4. **Split data (`Alt+Y › Split`)** — original retained as a copy; one/two child companies cut at a split date. For audited, closed years + performance. Pre-GST tax refs don't carry. Explicitly *not* to be used while books are unfinalised.

Plus the year-end companion features:
- **Restart voucher numbering per FY** — voucher-type numbering supports *Applicable From*, *Starting Number*, and **Periodicity (yearly)** so each FY gets a fresh series (also multi-series via F12, duplicate prevention).
- **Prerequisites checklist** before moving: bills adjusted, forex done, GST filed/reconciled, full backup.

**The conceptual core:** TallyPrime separates three things zprime currently conflates —
- *company FY metadata* (FY beginning from / books beginning from — static properties),
- *the session's current period* (`Alt+F2`, view state), and
- *a report's period* (`F2` per report).

## 2. What zprime does today (code-verified)

- **Company:** `financialYearStart` + `booksBeginFrom` stored per company (schema `companies`, created at company creation; both accepted by the update schema — mutable but with no migration semantics and no guard).
- **Engine is already period-agnostic (the good news):** every report takes explicit `from`/`to`; the accounting service computes *openings* as "all non-cancelled voucher activity before `from`, bounded below by `booksBeginFrom`" (`accounting.ts` uses `booksBeginFrom` as the lower bound for BS/P&L/TB openings). One dataset, any window — architecturally this **is** Tally's "change period" model. No year-end rollover entries are needed because BS-as-of is computed from the whole history.
- **Voucher numbering:** ONE counter per `(company, voucherType)`, never resets, no periodicity (`voucherCounters`; `next-number` at vouchers.ts:547). No FY restart — a Tally parity gap.
- **No session period concept:** no Alt+F2; the Gateway/Day Book/Reports compute their default windows on the fly.

### Findings (defects/risks discovered by this audit)

- **F1 — the stored FY is ignored by the UI (April-locked defaults).** Client helpers `fyStart()/fyEnd()` (`client/src/lib/format.ts`, mirrored in `server/src/lib/util.ts`) **hardcode the Indian April–March FY**. Gateway (`fyStart(today())`), Day Book (`useState(fyStart(today()))`) and Reports (`useState(fyStart(today()))`) all default windows from *today's date*, not from `company.financialYearStart`. A company with FY-begin 2025-07-01 (per its stored settings) still gets April windows everywhere. Tally supports arbitrary country FY-begin; zprime stores the value but barely honours it.
- **F2 — vouchers dated before `booksBeginFrom` silently vanish from reports.** The openings lower bound (`gte(vouchers.date, booksBegin)`) excludes any voucher earlier than books-begin; there is no server-side date validation against `booksBeginFrom` on voucher create/edit. Such vouchers are accepted, stored, counted in nothing (except possibly unbounded queries) — silent data loss by window. Tally validates entry dates against the period/books window and warns.

## 3. Gap analysis vs TallyPrime

| TallyPrime capability | zprime today | Gap size |
|---|---|---|
| One company, all years (change period) | ✅ engine already works this way | none (architecture matches) |
| Session "current period" (`Alt+F2`), shown on Gateway, defaults every screen | ❌ absent | **G1 — pure client feature** |
| Honour company's FY-begin (`FY beginning from`) in all windows | ⚠️ stored but ignored (F1) | **G2 — correctness fix, small** |
| Voucher numbering restart per FY (periodicity yearly, applicable-from, multi-series) | ❌ single never-resetting counter | **G3 — schema + logic, medium** |
| Year-end companion (checklist, restart numbering reminder) | ❌ absent | G4 — docs + small wizard, optional |
| Entry-date validation vs books window (warn, not block) | ❌ absent; pre-booksBegin data silently excluded (F2) | **G5 — server guard, small** |
| Cross-year report comparison (prev-year columns via F12) | ❌ absent (data supports it) | G6 — feature, defer |
| New-company-per-year (export openings → import) | ⚠️ XML import exists; no openings-import path | defer — unnecessary under the change-period model |
| Split data | ❌ | **explicitly N/A** for zprime's scale (single Postgres, computed openings, no performance cliff); document as a boundary |

## 4. Implementation options (for a future approved cycle — NOT scheduled)

**Option A — "Change Period" model completed (recommended; Tally's own recommended path):**
1. **G2** — all default windows derive from `company.financialYearStart` (Gateway FY line, Day Book, Reports; server `fyWindow` already honours `booksBeginFrom`); helpers take the company FY-begin as input. Fixes F1.
2. **G1** — session current-period: per-company `from`/`to` in localStorage (or a workspace store), set via **Alt+F2** modal + a Gateway period display; Day Book/Reports default to the session period instead of recomputed FY. Pure client; API untouched (already period-parametric).
3. **G5** — server warning (non-blocking) on vouchers outside `[booksBeginFrom, today]`, and include pre-booksBegin vouchers in openings OR reject them at the door (decide with the operator; Tally warns, doesn't silently drop). Fixes F2.
4. **G4-lite** — "New Financial Year" checklist section in README/runbook (backup, GST filed, then Alt+F2 forward + restart numbering).

**Option B — A + G3:** voucher-numbering periodicity (yearly restart with applicable-from + starting number per voucher type). Adds a column/semantics to numbering; needs a migration and careful R-10 idempotency interplay. Worth its own release.

**Option C — A/B + G6 comparison columns + G7 split:** explicitly out of scope for now; split is the wrong shape for zprime's architecture and scale (Tally splits for performance reasons zprime doesn't have).

**Recommendation:** Option A as v1.52.0-sized work (client-heavy, tiny server diff), Option B as a follow-up R-item. Nothing is scheduled until the operator approves.

## 5. Sources

- TallyHelp — "How to Move to New Financial Year in TallyPrime by Changing Current Period" (updated 2026-03-26), fetched in full during this session: the four paths, prerequisites, numbering-restart steps, split guidance.
- zprime code: `server/src/db/schema.ts` (companies, voucherCounters), `server/src/routes/companies.ts` (update schema), `server/src/routes/vouchers.ts` (next-number), `server/src/services/accounting.ts` (booksBegin-bounded openings), `client/src/lib/format.ts` + `client/src/pages/{Gateway,DayBook,Reports}.tsx` (April-locked defaults), `client/src/pages/Companies.tsx` (FY fields).
