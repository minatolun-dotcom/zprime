# R-27 Investigation — zprime v1.25.0 · TCS (Tax Collected at Source)

**Status:** investigation complete — implementation NOT started (per protocol).
**Verdict:** `R-27 CONFIRMED — GENUINE COMPLIANCE GAP, FULLY SCOPED`
**Baseline:** HEAD `4821cee` = tag `v1.25.0`; working tree carries only the ledger-doc push amendments (CONTINUE/RELEASES/STATE) + intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md`. No source/test/migration file modified.

---

## 1. Executive Summary

TCS — the seller's obligation to collect tax at source from the buyer under **Income-tax Act s. 206C** (most commonly **206C(1H)**: 0.1% on receipts from buyers whose turnover exceeds ₹10 crore, sale value > ₹50 lakh) — is **completely absent** from v1.25.0. `grep -rni "tcs|206c"` across server/client/tests returns zero genuine matches (all hits are `sgst` substrings).

This is the collection-side mirror of the TDS machinery that already exists and is proven in production, and the transaction-side mirror of R-23's RCM per-voucher decision. The architecture is already validated: a **dutyHead-classified ledger under Duties & Taxes**, entries as ordinary double-entry voucher lines, a dedicated report with collected/remitted/payable reconciliation, and exclusion from the GST engine (TCS is income-tax, not GST — the single correctness-critical integration point is keeping it out of GSTR-1/3B).

**No accounting-math change. No posting-engine change. Additive migration only.**

## 2. Baseline Integrity

- `git rev-parse HEAD` → `4821ceec0857099501b033a54584f4f8e741581a` = `v1.25.0^{}` ✓
- `git describe --tags` → `v1.25.0` ✓
- Remote publish verified this session: `origin/main` = HEAD, 27/27 tags on GitHub.
- Working tree: `M CONTINUE.md / RELEASES.md / STATE.md` (push-completion record — intentional, rides next release commit), `?? ZLEDGER_PRODUCTION_ACTION_PLAN.md` (untouched).

## 3. Current-State Evidence

| Question | Finding |
|---|---|
| Does any TCS code exist? | **No.** Only false-positive `sgst` substring hits. |
| TDS machinery to mirror | `tds_sections` master (schema.ts:130, company-scoped, `section/rate/threshold`, unique `(company_id, section)`); `ledgers.tdsSectionId` (:98, expense ledger attracts TDS); `voucher_entries.tdsSectionId` (:286, snapshot for reporting); "TDS Payable" starter ledger (companies.ts:91, `dutyHead: "TDS"`); `/reports/tds` (reports.ts:178) with **A-04 semantics** — deduction = CREDIT on duty ledger (`amount < 0`), remittance = DEBIT, sections breakdown, payable reconciliation; client `applyTds` helper (VoucherScreen.tsx:240) computing `r2(|amount| × rate / 100)` and pushing a negative line; master CRUD via `crud()` (masters.ts:61). |
| Upgrade-seeding precedent | Migration `0009_r23_rcm.sql`: idempotent `INSERT … WHERE NOT EXISTS` seeding "RCM Payable" into **existing** companies; new companies seeded in code. Exactly the pattern TCS needs. |
| GST-engine integration point | `gst.ts:101` — `dutyRows = entries.filter(e => e.dutyHead && e.dutyHead !== "TDS")`. A `dutyHead='TCS'` ledger must be excluded here too, or TCS lines pollute GSTR-1/3B duty aggregation. **This is the one correctness-critical line of the whole feature.** |
| Import-classification integration point | `import.ts:30` — `DUTY_NAME_RE` recognises `\btds\b` but not `\btcs\b`; an imported "TCS Payable" ledger could be misclassified as taxable supply. |
| Which voucher types | TCS is collected on **receipts** from buyers (206C(1H): earlier of credit of sale sum or receipt). The existing TDS helper runs on any voucher; the TCS helper likewise — but the natural surface is Receipt. Operator decides; no type restriction needed (mirrors TDS). |
| Sign convention | TCS Payable is a liability. Collecting = CREDIT (negative amount, same convention as TDS deduction); remitting to govt = DEBIT. The `/reports/tds` A-04 logic transfers verbatim. |

## 4. Legal-Scope Decision (documented, conservative)

- **Governing law:** Income-tax Act s. 206C — zprime already operates TDS (192–206) as income-tax machinery; TCS belongs to the same family. **GST s.52 TCS (e-commerce operator collection)** is NOT in scope — zprime is not an e-commerce operator platform, and GST-TCS would be GSTR-8 territory (a different return).
- **Rate/section variability:** TCS rates vary (206C(1): 1% scrap/minerals/timber; 206C(1H): 0.1% goods resale; higher if buyer has no PAN) → a **`tcs_sections` master mirroring `tds_sections`** is the honest model, not a hardcoded rate.
- **Threshold honesty:** s.206C(1H) applies per-buyer above ₹50 lakh sale. Like TDS thresholds today, zprime will **store the threshold and surface it as report advisory data, not enforce it** — cumulative per-buyer turnover tracking is beyond minimal scope and is stated as a documented limitation (the operator judges; the books record).

## 5. Proposed Scope (Option A — mirror the proven TDS pattern)

**Migration `0011_r27_tcs.sql` (additive only, 0009 precedent):**
1. `tcs_sections` table — mirror of `tds_sections` (`section, description, rate, threshold`, unique `(company_id, section)`).
2. `ledgers.tcs_section_id` — party/sale ledger attracts TCS under a section (mirror of `ledgers.tds_section_id`).
3. `voucher_entries.tcs_section_id` — per-line snapshot for report grouping (mirror of `tds_section_id`).
4. **Idempotent seed:** "TCS Payable" ledger (`duty_head='TCS'`, Duties & Taxes group) into every existing company `WHERE NOT EXISTS` — no data touched.

**Server:**
- `schema.ts` — the three mirror columns/table (conventions identical).
- `companies.ts` — starter seed gains `{ name: "TCS Payable", dutyHead: "TCS" }` (new companies).
- `masters.ts` — `crud(app, "tcs-sections", …)` + `tcsSectionSchema` in `lib/routes.ts`; ledger list/create surfaces `tcsSectionId`.
- `vouchers.ts` — entry validation accepts `tcsSectionId` (mirror of the TDS section-ownership check at :45-48); create/edit persist the snapshot.
- `gst.ts:101` — filter becomes `!== "TDS" && !== "TCS"` (the correctness-critical exclusion).
- `import.ts` — `DUTY_NAME_RE` gains `\btcs\b`.
- `reports.ts` — `GET /reports/tcs` mirroring `/reports/tds`: collected (credits on TCS ledgers) by section, remitted (debits), payable balance, plus threshold-rate reference data per section.

**Client:**
- VoucherScreen `applyTcs` helper beside `applyTds` ("− Collect TCS"): finds party lines whose ledger has a TCS section, computes `r2(|amount| × rate / 100)`, pushes a negative line on the TCS Payable ledger with the section snapshot. Clear error when no party line carries a section / no TCS ledger exists.
- MasterPage: TCS Sections CRUD + Party TCS Section field on the ledger form.
- Reports: `TcsView` beside `TdsView` + Gateway/registry entries.

**No change:** posting engine, accounting math, existing report keys, e-invoice/e-way/GSTR-9 services, authorization.

## 6. Blast Radius

| Surface | Change |
|---|---|
| Migration | 1 additive file, idempotent seed, no destructive SQL |
| Schema | +1 table, +2 columns |
| Server | 6 files touched (mirror-pattern, all previously exercised) |
| Client | 3 files (VoucherScreen, MasterPage, Reports/Gateway) |
| Tests | `final_regression.py` +~26 R-27 checks (incl. GST-exclusion proof: TCS lines must not move GSTR-1/3B totals; TCS report reconciliation collected−remitted=payable; smoke fixture gains a TCS receipt) → ~781; new `r27_ui.js` ~12 → ~322 |
| Risk | Low — every element is a verbatim mirror of a proven pattern; the only novel failure mode (GST contamination) is guarded by its own dedicated regression check |

## 7. Non-Bugs Verified During Investigation

- `gst.ts:101` excluding TDS from duty aggregation: **NOT A BUG — VERIFIED** (correct and intentional; TCS extends it).
- TDS threshold not enforced by `applyTds`: **NOT A BUG — VERIFIED** (operator-judgment model, documented; TCS adopts the same posture with stored threshold data).

## 8. Proposed Release

- **R-27 = TCS collection (Option A scope above).**
- **Proposed release: v1.26.0 — "TCS collection (s. 206C)"** — after full verification gates + browser acceptance + diff review, per protocol.
- Out of scope (future, own cycles): per-buyer cumulative threshold enforcement, GST s.52/GSTR-8 e-commerce TCS, TCS certificate generation.

---

**Decision is yours:** approve Option A, adjust, or reject. STOP — no implementation before approval.
