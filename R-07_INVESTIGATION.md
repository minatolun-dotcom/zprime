# R-07 Investigation — zprime v1.6.0 · B-02 Opening Balances

**Status:** investigation complete — implementation NOT started (per protocol).
**Verdict:** `R-07 CONFIRMED — INVESTIGATION REQUIRED` (one confirmed P1 defect, two P2 defects, one verified non-bug; all evidence from source trace + live probe on v1.6.0).
**Baseline:** HEAD `caadf983aba600ffc5abd976f2e5281df890cf97` = tag `v1.6.0`; working tree clean except this report and the intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md`. No source, test, migration, or doc file modified.

---

## 1. Executive Summary

The action plan's B-02 claim — "opening stock breaks A = L + C by design (INV5: ₹4,60,000)" — is **real but mis-graded and incomplete**. Live verification against v1.6.0 shows B-02 is actually **three distinct behaviors**:

| ID | Finding | Severity | Nature |
|---|---|---|---|
| F-07-1 | Party (Sundry Debtor/Creditor) `openingBalance` is **invisible to Receivables/Payables reports** — a migrated book's outstanding money is silently missing | **P1** | Confirmed defect, silent |
| F-07-2 | Item opening stock has **no accounting origin** → BS `difference = −openingStock` with an honest "Difference in books" banner | P2 | Design limitation, honestly flagged (action plan claimed P0) |
| F-07-3 | Stock-in-Hand **sub-group** ledgers (e.g. Finished Goods) are **double-counted in BS assets** — the zeroing rule matches the group *name* exactly, missing descendants | **P2** | Confirmed defect, silent |
| F-07-4 | Ledger openings do **not** contaminate P&L period movement | — | NOT A BUG — VERIFIED |

The current architecture is Tally-shaped and more correct than the action plan implied: ledger openings flow through TB/BS/closing balances via `ledgerBalances()` (opening field + books-begin carry), the BS deliberately takes stock value from the **inventory engine** (zeroing Stock-in-Hand *ledger* closings to avoid the double-count), and an unbalanced opening set is **surfaced honestly** (`difference` + UI banner) rather than hidden. The two *silent* failures are F-07-1 (money missing from AR/AP) and F-07-3 (double-count through SIH sub-groups).

## 2. Baseline Integrity

- `git rev-parse HEAD` → `caadf983aba600ffc5abd976f2e5281df890cf97` = `v1.6.0` ✓
- `git describe --tags` → `v1.6.0` ✓
- `git status --short` → `?? ZLEDGER_PRODUCTION_ACTION_PLAN.md` (intentional only) ✓
- No source/test/migration/doc file modified by this investigation. Probe scripts live in `/tmp` only; probe data lives in the disposable Docker stack volume.

## 3. Action-Plan Claim Re-Verification

Original claims (ZLEDGER_PRODUCTION_ACTION_PLAN.md lines 52, 84–85, 92, 110):

| Claim | v1.6.0 reality | Disposition |
|---|---|---|
| "Balance Sheet PARTIAL — A=L+C holds only when openings entered consistently (B-02)" | Confirmed — but the inconsistency is **flagged**, not hidden (banner, `difference` field) | **Re-graded P0 → P2** |
| "Opening balances: ledger opening + books-begin carry works ✅" | Confirmed (O1 probe in final_regression covers continuity; A-06 fix covers period movement) | Accurate |
| "Stock opening: value appears in BS with **no accounting origin** ❌ (B-02)" | Confirmed — but side-effect is a visible banner; P&L/TB stay honest | Re-graded, see F-07-2 |
| "breaks A = L + C by design … INV5 ₹4,60,000" | Reproduced in kind at small scale (−1000 on ₹1000 stock); the *silent* openings defects are F-07-1/F-07-3, which the plan did not list | Claim correct but incomplete and mis-graded |

## 4. Architecture of Opening Balances (as-built)

```
ledgers.opening_balance   (numeric, dr + / cr −, schema.ts:68)
  ├─→ ledgerBalances()      opening = field + books-begin carry (accounting.ts:52)
  │     ├─→ Trial Balance   opening/closing rows (accounting.ts:123)
  │     ├─→ Balance Sheet   group tree fold (accounting.ts:200)
  │     │     └─ SIH *ledgers* zeroed by exact group name (accounting.ts:206)  ← F-07-3
  │     │     └─ computed stock line pushed: closingStock from inventory engine (accounting.ts:218)
  │     │     └─ difference = totalLiabilities − totalAssets (accounting.ts:230)
  │     └─→ P&L             movement-only (debit−credit in range) — openings excluded (A-06, accounting.ts:154)
  └─→ billWiseOutstanding() does NOT read opening_balance at all (accounting.ts:344)  ← F-07-1

stockItems.opening_qty/value (schema.ts:154-156)
  └─→ stockSummary()        state starts from openings (stock.ts:39-41)
        └─→ stockClosingValue() → BS stock line + P&L opening/closing stock
```

The importer (`import.ts`) sets both `openingBalance` (line 215) and item openings (lines 256–258) but creates **no opening vouchers** — so every migrated book carries unfunded openings by construction, making F-07-1/F-07-3 the *common case* for the exact audience B-02 was written for.

## 5. Live Reproduction (v1.6.0, disposable stack :3000, company "R07 Probe")

Setup: ledger openings Cash 100,000 Dr / Capital 150,000 Cr / Probe Debtor 50,000 Dr (bill-wise); item opening 10 @ 100 = 1,000; **no vouchers, no opening journals**.

**S1 — BS/TB with balanced ledger openings:**
```
BS totalLiabilities=150000 totalAssets=151000 difference=-1000
  assets: Current Assets=150000 (Cash+Debtor), Stock-in-Hand=1000 (engine)
TB Dr=150000 Cr=150000 balanced   (openings fold correctly)
```
→ Ledger openings balance correctly; the −1000 is exactly the unfunded item opening → F-07-2 confirmed at scale-1, banner honest.

**S1-AR — Receivables as of 2026-04-30:**
```
AR parties=[] total=0        ← the debtor's 50,000 opening is MISSING
```
→ **F-07-1 confirmed.** The party's opening balance exists in TB (50k Dr) but Receivables reports zero. Money is invisible to the report whose purpose is collecting it. Tally shows a party's opening balance as an "Opening Balance" bill in Outstanding reports.

**S2 — P&L contamination check:**
```
P&L netProfit=0 (month with openings only)
```
→ **F-07-4: NOT A BUG — VERIFIED.** Openings are balance-carry, not movement; A-06 logic holds.

**S3 — SIH sub-group double-count:**
```
POST group "Finished Goods" under Stock-in-Hand; ledger "FG Opening Ledger" opening 1000
BS totalAssets=151000 → 152000 (same single ₹1,000 of stock counted twice)
difference=-1000 → -2000
```
→ **F-07-3 confirmed.** `balanceSheet()` zeroes ledger closings only when `b.groupName === "Stock-in-Hand"` (exact name, accounting.ts:206). A ledger under an SIH *sub-group* — the natural Tally structure (Finished Goods / Raw Materials) — survives zeroing, rolls into Current Assets via the tree, and is counted **again** by the pushed inventory-engine stock line. Silent: the banner does not distinguish this double-count from an ordinary opening mismatch.

## 6. Existing Coverage

- `reconcile.py:200` asserts `BS difference == 0` — but only in the **manual opening-journal scenario** (its openings are funded by hand: opening journal + opening stock journal, lines 88–97). No test creates unfunded openings and asserts the banner value.
- No test sets a party `openingBalance` and asserts Receivables/Payables content → F-07-1 has **zero coverage**.
- No test creates an SIH sub-group ledger → F-07-3 has **zero coverage**.
- Browser baseline works around B-02 entirely: `run.js:108-109` — "Opening books come from the two opening journals (OPEN-CAP + OPEN-STK), not master openings — otherwise capital and stock are counted twice."

## 7. Findings Table

| ID | Area | Finding | Severity | Reproducible | Impact | Coverage | Disposition |
|---|---|---|---|---|---|---|---|
| F-07-1 | AR/AP reports | Party `openingBalance` never appears in Receivables/Payables (`billWiseOutstanding` reads only `bill_allocations`) | **P1** | YES (S1-AR) | Migrated books: outstanding money silently missing from collection/payment reports | none | **CONFIRMED BUG → R-07 core** |
| F-07-2 | BS/inventory | Item opening value has no accounting origin → BS `difference = −openingStock`, honest banner, importer creates this state for every migrated book | P2 (re-graded from P0) | YES (S1) | Visible imbalance requiring manual opening journals; no guided remedy | banner only (reconcile asserts the funded case) | **Design limitation → needs product decision** |
| F-07-3 | BS | SIH **sub-group** ledger closings not zeroed → stock double-counted in assets | P2 | YES (S3) | Migrated Tally structures (Finished Goods/Raw Materials under SIH) double-count stock, silently | none | **CONFIRMED BUG → R-07** |
| F-07-4 | P&L | Ledger openings do not contaminate period movement | — | YES (S2) | — | O1 probe + A-06 tests | NOT A BUG — VERIFIED |

Adjacent observations (P4, not defects): the BS "Stock-in-Hand" engine line is a synthetic top-level node while the real SIH group sits under Current Assets (cosmetic grouping); `import.ts` `openingValue` uses `openingQty * openingRate` and ignores a Tally-provided value (rounding-faithful, minor).

## 8. Selected R-07 and Proposed Scope

**R-07 title:** *Opening balances in reports — party openings in AR/AP and BS stock double-count.*

**Recommended scope (Option B):**
1. **F-07-1 (P1):** `billWiseOutstanding()` merges each party ledger's `openingBalance` (Dr for Debtors, Cr for Creditors — sign-mirrored like existing rows) as a synthetic **"Opening Balance"** bill dated books-begin, exactly following the A-05 on-account merge precedent (`accounting.ts:420+`). Party total and report `total` include it. Settlement of an opening balance = normal allocations against that synthetic bill or on_account.
2. **F-07-3 (P2):** replace the name-equality zeroing with structural identity: zero ledger closings for the **Stock-in-Hand group and all its descendants** (resolve group ids once, `buildGroupTree`-style ancestry check), so sub-group stock ledgers are excluded from the asset fold exactly like the top node.
3. Tests: independent-engine + final-regression blocks reproducing S1/S1-AR/S3 with exact expected values; reconcile.py gains an unfunded-opening scenario asserting the banner difference equals −openingStock; r07_ui.js checks the AR "Opening Balance" row in the browser.

**F-07-2 disposition (needs human decision, not bundleable silently):**
- **Model A (Tally-faithful, minimal):** keep the honest banner; document the opening-journal workflow (as reconcile.py and the browser fixture already do); optionally label the BS difference "Difference in opening balances" (Tally wording).
- **Model B (guided):** add a Company Settings / BS-banner action "Post opening entries" that generates the balancing journal(s) from current openings (stock → SIH vs capital; party/unfunded ledger openings → capital or Suspense A/c). Larger scope, touches accounting posting — must be designed so it can never post twice.
- **Model C (importer-side):** importer emits one opening journal inside its single transaction when openings are unbalanced. Fixes migrated books only, not API-created ones.

## 9. Non-Bugs Verified

- **F-07-4:** openings are balance-carry only; P&L month with openings and no vouchers reports 0 (probe S2). A-06 + O1 coverage adequate.
- TB folds openings correctly (S1: 150k/150k balanced).
- BS is balanced when openings are consistent — reconcile.py's funded scenario already proves this in CI.

## 10. Out of Scope

Multi-currency openings, opening GST credit (ITC carry-forward — regulatory feature, postponed by roadmap), FIFO/WAVG opening-lot semantics beyond current behavior, auditing/period locking, any change to accounting mathematics. R-06's availability guard is untouched: availability replay starts from item openings and is unaffected by report-side fixes.

## 11. Final Recommendation

R-07 is confirmed. The single highest-priority defect is **F-07-1** (P1: silent omission of party opening balances from Outstanding reports — the report's core purpose fails for migrated books). F-07-3 (silent BS double-count) belongs in the same report-truth fix. F-07-2 is a product decision (Model A/B/C above) and should be answered before implementation begins.

**Investigation is complete. Awaiting human review and scope approval.**
