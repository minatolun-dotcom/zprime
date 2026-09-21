# R-33 Investigation — zprime v1.31.0 · TDS/TCS Threshold Enforcement Posture

**Status:** investigation complete — implementation NOT started (per protocol).
**Verdict:** `NO P1/P2 DEFECT CONFIRMED — PRODUCT-DECISION INVESTIGATION` (thresholds honest as reference data; any enforcement is a posture change requiring an explicit product decision, not a bug fix).
**Baseline:** HEAD `88e89d25bfaea19ec14e5f405b90be0656ee8114` = tag `v1.31.0`; working tree clean except this report and the intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md` (plus the five ledger docs recording v1.31.0, riding with the next commit per convention). No source, test, migration, or doc file modified by this investigation.

---

## 1. Executive Summary

zprime's TDS (R-02-era) and TCS (R-27) machinery stores each section's statutory **threshold** in the masters (`tds_sections.threshold` / `tcs_sections.threshold`, numeric, default 0) and surfaces it in the reports as reference data — but **never enforces it anywhere**. The documented posture (R-27, verbatim): *"s.206C applicability is the operator's judgment; the books record what happened"* — and the TDS mirror: *"threshold not enforced by `applyTds`: NOT A BUG — VERIFIED (operator-judgment model, documented)"*.

This investigation answers the roadmap's standing question: **should zprime now enforce thresholds — warn, block, or stay as-is?** The honest answer requires confronting three hard truths about the domain, which is why this was never a quick add:

1. **Thresholds are legally per-PAYEE-per-FY aggregates**, not per-voucher values (e.g. 194C: ₹30k single payment OR ₹1,00,000 aggregate per contractor per FY; 194J: ₹50,000 aggregate FY 2025-26+). Enforcement requires **cumulative per-payee tracking across the financial year** — a queryable model zprime does not have today (the TDS report aggregates by section per period, not by payee per FY).
2. **Thresholds churn by Finance Act** (194J moved ₹30k → ₹50k for FY 2025-26; several limits revised repeatedly). Hard-coding law into code creates silent staleness; the operator-defined section master is the only honest source — and its `threshold` field already exists.
3. **Edge semantics are trap-rich:** PAN-less higher rates (s. 206AA ~20% or double), section-specific single-vs-aggregate rules, exempt payee categories, TCS 206C(1H) per-buyer ₹50-lakh turnover trigger. A naive block would be wrong more often than helpful.

## 2. Current Architecture (verified, file:line)

| Piece | Location | State |
|---|---|---|
| `tds_sections` master | `schema.ts:134` | `section/description/rate/threshold` per company, unique `(company, section)`; threshold default `"0"` |
| `tcs_sections` master (R-27) | `schema.ts:147` | exact mirror; schema comment states the posture verbatim |
| Ledger binding | `ledgers.tdsSectionId/tcsSectionId` | expense (TDS) / party (TCS) ledgers carry the section |
| Entry snapshot | `voucher_entries.tdsSectionId/tcsSectionId` | per-entry snapshot for reporting |
| Client helper (TDS) | `VoucherScreen.tsx:242 applyTds` | computes `r2(|amount| × rate/100)`, pushes a TDS-Payable credit; **no threshold check** |
| Client helper (TCS) | `VoucherScreen.tsx:268 applyTcs` | mirror; **no threshold check** |
| Server validation | `vouchers.ts:45-55` | section references must exist in-company (integrity only — no threshold logic) |
| TDS report | `reports.ts:410+ /tds` | deductions by section per period; threshold surfaced as reference column |
| TCS report (R-27) | `reports.ts:349+ /tcs` | A-04 semantics; threshold surfaced as reference |
| EWB advisory precedent | `ewaybill.ts:116-118` | non-blocking `warnings[]` array — the honest pattern for statutory nudges that the portal itself enforces |

## 3. Domain Grounding (why this is hard to "just enforce")

- **194C (contractor):** ₹30,000 single payment OR ₹1,00,000 aggregate per FY **per payee**; individual/HUF payee rate 1%, others 2% — the rate itself depends on payee classification.
- **194J (professional/technical):** ₹50,000 aggregate per FY per payee (revised from ₹30,000 effective FY 2025-26); rate 10%/2% by fee type (194JA/194JB sub-codes).
- **194I (rent):** threshold raised to ₹6,00,000/year (FY 2025-26); rate 10%/2% by asset type (194IB 2% for individuals/HUF).
- **206C(1H) TCS:** applies only once the **seller's** turnover exceeds ₹50 lakh (or the buyer's purchase exceeds ₹50 lakh); 0.1% rate; scrap/minerals 1%; 206AA PAN-less double-rate.
- **206AA:** no PAN → rate becomes ~20% (or double the normal rate) — enforcement without PAN-state awareness would mis-charge.

**Conclusion:** correct enforcement needs (a) per-payee per-FY aggregate tracking, (b) per-section single-vs-aggregate mode, (c) rate-class awareness. Each is real engineering — none is a config flag.

## 4. Design Options

**Option A (recommended) — Advisory threshold warnings (client + report), no blocking (≈ v1.32.0)**
- Reuse the proven EWB `warnings[]` pattern, end to end:
  - **VoucherScreen:** when `applyTds`/`applyTcs` fires (or when a line's ledger carries a section), the client queries a new lightweight `GET /reports/tds-threshold-check?ledgerId=…&amount=…` (per section: FY-to-date per-payee aggregate + this voucher) and shows a **non-blocking amber advisory**: *"194J payments to this payee: ₹61,200 this FY (threshold ₹50,000) — TDS required on this voucher"*. Below threshold: *"₹18,000 this FY — threshold ₹50,000; TDS becomes due at ₹50,000 (aggregate, FY)"*. The operator decides; the books record.
  - **Reports:** the TDS/TCS reports gain a per-section FY-aggregate line so the reference column stops being orphaned data.
  - **Per-section mode flag:** additive nullable `threshold_mode` on both masters (`single` | `aggregate` | null=advisory-only) so operators encode single-payment sections correctly — used for **advisory wording only**, not blocking.
- Blast radius: small — one read-only route, two client advisory hooks, report additions, additive nullable column (or none, if mode is encoded in `description` — worse; prefer the column), ~10 Python + ~6 browser checks. **No posting change; no voucher ever blocked.**

**Option B — Hard block above threshold** (voucher rejected unless TDS present once aggregate ≥ threshold): rejected — wrong more often than right. It cannot know PAN state, payee exemption, or whether another system already deducted; it would also be the first zprime feature that **refuses a legal accounting action** on a heuristic. Contradicts the A-07/A-04 philosophy (books record; contradictions surface visibly).

**Option C — Full per-payee FY tracking engine** (dedicated `tds_payee_fy` rollups, auto-deduction proposals, 206AA handling): genuinely useful but a large feature with real schema; belongs after operator demand, not as a posture change.

**Option D — Stay as-is** (thresholds as reference data): defensible; the documented posture stands. But the R-14 TB-health precedent showed that *surfacing* what the books know (honest advisories) is where zprime adds value without pretending to be a compliance engine.

## 5. NOT A BUG — VERIFIED (discipline items)

1. **`applyTds`/`applyTcs` never checking thresholds** — correct per the documented operator-judgment model; the helpers compute what the operator asked, nothing more.
2. **Reports surfacing thresholds without action** — honest reference data (A-04 posture); the tables would be misleading only if they claimed applicability, which they do not.
3. **No per-payee FY aggregate anywhere** — a deliberate R-27 scope line ("cumulative per-buyer turnover tracking is beyond minimal scope"), documented, not lost.

## 6. Out of Scope (all options)

- 26Q/27Q quarterly e-TDS return formats; TCS certificate generation (Form 27D); GSTR-8 e-commerce TCS; challan e-filing; auto-deduction on voucher save; PAN-state modeling.

## 7. Final Recommendation

**Approve Option A.** It converts stored-but-inert threshold data into actionable, non-blocking advisories using zprime's own established `warnings[]` honesty pattern — no new compliance-surface risk, no false blocking, and it makes the aggregate question (the real legal trigger) visible per-payee per-FY for the first time. Requires one small additive migration (`threshold_mode`), one read-only route, and modest client work. Release candidate: **v1.32.0**. Option D (do nothing) remains a legitimate choice — the posture documents are honest as they stand.
