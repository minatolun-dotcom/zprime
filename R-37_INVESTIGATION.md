# R-37 Investigation — zprime v1.35.0 · Per-Payee FY TDS/TCS Engine (R-33 Option C)

**Status:** investigation complete — implementation NOT started (per protocol).
**Verdict:** `R-37 CONFIRMED — GENUINE COMPLIANCE-INFO GAP, FULLY SCOPED` (R-33's explicitly deferred Option C; no P0/P1 defect — the current per-section approximation is honest and documented; this is an approved-feature investigation).
**Baseline:** HEAD `97bc8678bd2bea064366ed9bd148c86c095f9c75` = tag `v1.35.0` (pushed, one ledger-docs commit ahead, `v1.35.0-1-g97bc867`); working tree clean apart from the intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md` (and `scripts/__pycache__/`). No source, test, migration, or doc file modified.

---

## 1. Executive Summary

R-33 shipped threshold advisories honestly but coarsely: the FY aggregate is measured **per section across all payees combined**. The law measures **per payee per FY** — section 194J's ₹50,000 threshold binds per *payee* (each professional's fees aggregated separately), not on the sum across every professional the business pays. Today a business paying ₹40,000 to Architect A and ₹40,000 to Consultant B (same 194J) reads "₹80,000 this FY — TDS due" when *neither* payee has actually crossed the threshold; conversely the aggregate can never catch that one payee crossed while others dilute the figure. The R-33 report documented exactly this: "Rows are keyed by section, not payee — the per-payee split is documented out of scope."

**The enabling discovery: the postings already know the payee.** Every TDS base line is a **debit on an expense ledger that carries the section declaration** (`ledgers.tds_section_id`) — and that expense ledger is usually *named for the payee* ("Prof Fees — Sharma & Associates"). The per-payee split is therefore just an additional `GROUP BY ledger` on the exact query R-33 already runs: `ledgerId` is already selected into the row set; only the aggregation map changes. **Zero schema change, zero migration, zero new state.** For TCS the same holds on the party-credit side (`ledgers.tcs_section_id` on the buyer ledger).

**Recommended scope (Option A, ≈ v1.36.0):** extend `tdsTcsFyAggregates` to also return a **per-payee breakdown** (`payees[]` inside each section aggregate: ledgerId, ledgerName, gstin-derived PAN presence flag, fyAmount, maxSingle, count), make the threshold-check advisory **per (section, payee)** — the legal unit — while keeping the section-level rollup for context, and surface payee rows on the TDS/TCS reports' `fyAggregates`. Wording becomes honest per-payee: "Payee X: ₹72,000 this FY under 194J (threshold ₹50,000) — TDS due on further payments to this payee". ~12–16 new Python checks; r33_ui stays green (the advisory strip wording contract is section-based but its assertions are wording-substring based — verified below). No blocking, ever; the operator-judgment posture is preserved.

## 2. Baseline Integrity

- `git rev-parse HEAD` → `97bc8678bd2bea064366ed9bd148c86c095f9c75`; `git describe --tags` → `v1.35.0-1-g97bc867`; tag `v1.35.0` → `dc758aa…` verified; remote matches.
- Verification estate: 1197 automated + 480 browser; 37 immutable tags.

## 3. Current Per-Section Engine (evidence)

- **`tdsTcsFyAggregates(companyId, dutyHead)`** (reports.ts:39–74): selects `sectionId` (= `ledgers.tds/tcsSectionId`) + `voucherEntries.amount` joined vouchers×ledgers, company-scoped, `isCancelled=false`, **defense-in-depth `ledgers.companyId` check**, FY window (`fyStart(today())`→today). Aggregates into `bySection` (threshold/thresholdMode joined from the section table). Base direction: TDS = expense **debit** lines (amount > 0), TCS = party **credit** lines (amount < 0). Returns per-section `{ sectionId, section, threshold, thresholdMode, fyAmount, maxSingle, count }`, filtered to sections with a threshold or postings.
- **`GET /reports/tds-threshold-check`** (reports.ts:559+): wraps the aggregates with mode-aware over/near + wording; `threshold=0` → "no threshold recorded — confirm applicability manually" (never a guess). Read-only, non-blocking.
- **TDS report** (`/reports/tds`, reports.ts ~475–556) and **TCS report** carry `fyAggregates: await tdsTcsFyAggregates(...)` — API-only surfaces (client `grep fyAggregates` → **zero hits**; the reports UI renders sections/deductions/remittances only).
- **VoucherScreen advisory strip** (R-33): fetches the endpoint on Deduct TDS / Collect TCS, shows over/near wordings in an amber strip; never blocks.

## 4. The Gap

- The aggregate sums **all payees' base lines under one section**. Two consequences, both live today:
  1. **False over-threshold:** ₹40k (Payee A) + ₹40k (Payee B) under 194J reads "₹80,000 — TDS due" although the law binds per payee (neither crossed ₹50k). The advisory overstates.
  2. **No payee visibility:** the operator cannot see *which* payee crossed or is near — the actionable question ("to whom do I owe TDS from the next payment?") is unanswerable from the surface.
- The R-33 code comment documents this limitation verbatim (reports.ts:36–37) — it is a known, honest scope cut, not a hidden bug.

## 5. The Legal Unit and What the Books Know

- **194-series thresholds bind per payee per FY** (the "payee" = the person to whom income is credited/paid; PAN-based aggregation in practice). **206C TCS binds per buyer** (with the turnover-based seller-side condition; out of scope — the books don't track seller turnover).
- **Payee identification in zprime = the expense ledger itself** (TDS) or the party ledger (TCS). This is the model's honest grain: zprime's ledger master *is* the payee master. A ledger named for a firm used by two real-world payees would merge them — but that is exactly how the books already attribute expense and how every TDS report in the product reads; the advisory inherits the books' grain rather than inventing a new one.
- **PAN availability:** `ledgers.gstin` exists (nullable). PAN = characters 3–12 of a GSTIN when present. Payees without GSTIN simply carry a "PAN not recorded — verify at ₹50,000+/yr" hint in wording when their aggregate crosses the threshold. No new master field is required (a dedicated `pan` column belongs to a future master-enrichment task, not this one).
- **Multiple expense ledgers per payee:** possible (two rent ledgers, same landlord). Per-ledger rows would split one payee's aggregate. Option A reports **per ledger** and words it "Ledger 'X'"; merging across ledgers requires a payee-identity concept (out of scope — documented). The per-ledger grain is still strictly more truthful than the per-section sum.

## 6. Design (for approval)

- **`tdsTcsFyAggregates` gains `payees[]` per section:** the same row query already returns everything needed; add `ledgerId` to the select and build `bySection → byLedger` nested maps. Each payee row: `{ ledgerId, ledgerName, hasPan (derived from gstin[2:12] presence), fyAmount, maxSingle, count }`. Section-level `{ fyAmount, maxSingle, count }` remain (sum/max across payees) — **shape-compatible with every existing consumer**.
- **Threshold-check advisory becomes per (section, payee):** for `aggregate` mode, over/near is evaluated **per payee** against the threshold; wording names the payee ledger. The section-level row keeps a rollup wording (unchanged semantics, now labeled "across payees"). `single` mode stays **per-payment** (maxSingle) — but now identifies the payee of that largest payment. `threshold=0` wording unchanged.
- **Reports:** TDS/TCS `fyAggregates` carry the new `payees[]` arrays — additive; nothing existing changes shape.
- **UI (minimal):** none required for correctness — `fyAggregates` are API-only today and the VoucherScreen strip reads server wordings. The wording change flows through automatically. (A payee-threshold table on the TDS report page is Option B territory.)

## 7. Blast Radius Analysis

| Change | Files | Risk | Mitigation |
|---|---|---|---|
| `payees[]` aggregation in `tdsTcsFyAggregates` | reports.ts | shape addition only | section-level fields unchanged; all existing assertions re-run |
| Per-payee advisory wording in threshold-check | reports.ts | r33_ui asserts wording substrings | verified: r33_ui checks `"194J"`, `"TDS/TCS due"`, `"single"` substrings — the new wording keeps all of them; suite re-run proves it |
| New Python checks (~12–16) | final_regression.py | additive | — |
| Optional: payee rows on TDS/TCS report pages | Reports.tsx | API-only today; only if Option B | — |

**No server behavior change beyond richer advisory data. No schema, no migration, no posting math, no blocking.**

## 8. Security / Accounting Check

- Endpoint remains cid-gated (non-member 404 test exists and stays); the richer payload exposes only the same company's data, grouped finer — no new isolation surface.
- No accounting semantics touched: the aggregates are read-only derivations of postings; TB/BS/P&L untouched; the R-33 cancel-exclusion and A-04 remittance-exclusion rules carry over verbatim (canceled vouchers still leave the aggregate; remittance debits were never in the base query).

## 9. Test Plan (for approval)

- **Python (~12–16 new checks in the R-33/R-37 block):** two payees under 194J, neither individually over (₹40k+₹40k): section aggregate = ₹80,000 (unchanged) **but** per-payee over=false for both, wording per-payee "not yet reached"; one payee over (₹72k) + one under (₹20k): payee-1 over=True wording names the ledger, payee-2 not-over; payee `hasPan` flag true/false by gstin presence; single-mode 194C names the payee of the largest payment; TCS head payee aggregation on a buyer credit; cancel-exclusion at payee grain; remittance never enters the base; non-member 404; TB still balances.
- **r33_ui.js:** must stay green (wording-substring contract verified compatible). New browser checks not required for Option A (the strip is wording-driven and already covered); Option B adds a `r37_ui.js` for the report-page payee table.

## 10. Scope Options

- **Option A (recommended, ≈ v1.36.0):** per-payee aggregates + per-payee advisory wording + `payees[]` on reports. API-surface only; minimal, truthful, zero schema.
- **Option B:** A + payee-threshold table rendered on the TDS/TCS report pages (+ `r37_ui.js`). More visible value for multi-payee operators; more surface.
- **Option C:** A + a `pan` master column and PAN-based payee identity across ledgers — rejected for now: a new schema concept and master-enrichment flow; the ledger grain is the honest v1 step. GSTIN-derived PAN covers the common case.
- **Option D:** defer — legitimate; the limitation is documented, not hidden.

## 11. R-37 Scope Statement (if approved)

**Title:** "Per-payee FY TDS/TCS aggregates: the advisory measures the law's unit."
**Requirements:** `payees[]` in `tdsTcsFyAggregates`; per-payee over/near evaluation + wording in threshold-check (single mode names the payee of the largest payment); `payees[]` on TDS/TCS reports; ~12–16 Python checks; r33_ui green; typecheck; full Python + browser batteries on a verified-fresh volume; no schema/migration.
**Acceptance criteria:** two-payee-under-threshold scenario reads per-payee truth (no false "TDS due"); one-over scenario names the payee; all R-33 assertions unchanged and green; 1197+ automated and 480+ browser checks remain green.

---

**Final verdict:**

# R-37 CONFIRMED — GENUINE COMPLIANCE-INFO GAP, FULLY SCOPED

Awaiting human review of scope (A / B / C / D) before any implementation. No code has been changed.
