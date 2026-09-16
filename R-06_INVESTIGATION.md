# R-06 Investigation — zprime v1.5.0 · B-01 Negative Stock

**Status:** investigation complete — implementation NOT started (per protocol).
**Verdict:** `R-06 CONFIRMED — INVESTIGATION REQUIRED` (P1, live-reproduced).
**Baseline:** HEAD `e8c808b72bcf605974c419940a3ddbb5c5b19158` = tag `v1.5.0`; working tree clean except this report and the intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md`. No source, test, migration, or doc file modified.

---

## 1. Executive Summary

The action plan's B-01 claim is **confirmed and live-reproduced on v1.5.0**, and the investigation found the blast radius is **worse than the plan recorded**. A sale for more units than are in stock is accepted without any error, warning, or availability check. The valuation engine then (a) charges WAVG cost for units that never existed, (b) clamps negative running value to zero, and (c) lets a later purchase be averaged over a negative quantity — producing a closing value of **1,000 on a closing quantity of −2** (the plan's own probe had stopped at "value 0 on qty −5").

Financial impact measured live: gross profit overstated by **+500** on a 4-voucher scenario (reported GP 1,040 vs true 540), flowing into BS stock value, net profit, and capital. Cancel → uncancel (R-02) restores correct valuation because `stockSummary` recomputes from scratch every call — the distortion is presentation-state, not persisted data. No automated test covers any of this.

## 2. Baseline Integrity

```
git rev-parse HEAD   → e8c808b72bcf605974c419940a3ddbb5c5b19158
git describe --tags  → v1.5.0
git status --short   → ?? ZLEDGER_PRODUCTION_ACTION_PLAN.md (intentional) + this report (created after baseline check)
```

Probe ran against the disposable Docker stack on :3100 (fresh volume); probe scripts in /tmp only, removed after use.

## 3. Action-Plan Claim vs v1.5.0 Reality

| Plan claim (B-01, P0) | v1.5.0 actual | Disposition |
|---|---|---|
| "No availability check at posting" | **Confirmed.** `vouchers.ts` has zero stock-quantity logic; the only inventory posting guard is Physical Stock's negative-count rejection (`assertPhysicalRows`) | CONFIRMED BUG |
| "value clamp hides it" | **Confirmed.** `stock.ts` clamp block: when `runningQty < 1e-9 && runningQty > -1000` and `runningValue < 0` → `runningValue = 0` | CONFIRMED BUG |
| "INV4: buy 10@100, sell 15 → qty −5, value 0" | **Confirmed**, and extended: a subsequent purchase yields `qty −2, value 1000` — clamping a *positive* average onto a *negative* quantity | CONFIRMED + WORSE |
| "WAVG rate distortion propagates" | **Confirmed forward**, see mechanics below | CONFIRMED BUG |

## 4. Root Cause (code-level)

**A. No posting-time availability check** — `server/src/routes/vouchers.ts` (and the R-04-hardened import path) validate double-entry and bill rules but never consult stock availability. Any outward quantity is accepted.

**B. Valuation engine behavior under negative stock** — `server/src/services/stock.ts`:

1. WAVG outward cost: `cost = runningQty > 1e-9 ? (runningValue/runningQty)*out : 0`.
   - With qty 10/value 1000, selling 15 charges `(1000/10)*15 = 1500` — cost of goods **for 5 units that never existed**.
   - Once `runningQty ≤ 0`, further outward is charged **0** — COGS silently free.
2. The clamp: after an outward leaves `runningValue < 0` (with qty > −1000), value is forced to 0. This is the "hide" mechanism: the engine's own inconsistency is erased from the display and every downstream report.
3. The next inward adds to the clamped (0) value while `runningQty` stays negative: value 1000 / qty −2 → `closingRate = 0` (guard `closingQty > 1e-9` fails), yet **BS/P&L consume `closingValue` (+1000) directly** — positive asset value on negative stock.

**C. Consumers inherit the distortion** — `accounting.ts` computes `closingStock` (P&L: COGS = purchases + opening − closing) and BS stock line from `stockClosingValue()` → the clamped/inconsistent value flows into COGS, gross profit, net profit, capital, and BS totals. No clamp can make the identity true: with unclamped engine value 500, true GP is 540; clamped value 1000 reports GP 1,040.

## 5. Live Reproduction (v1.5.0, fresh company, no opening stock)

| Step | Action | Result |
|---|---|---|
| V1 | Purchase 10 @ 100 | stock qty 10, value 1000, rate 100 ✓ |
| V2 | **Sale 15** @ 120 (5 more than available) | **HTTP 200 — accepted.** Stock: qty **−5**, value **0** (clamped); outValue **1500** (WAVG cost for 15 units incl. 5 phantom) |
| V3 | Sale 2 @ 120 while negative | Accepted; cost **0** — COGS free |
| V4 | Purchase 5 @ 200 | Stock: qty **−2**, value **1000**, rate 0 — positive value on negative quantity |
| Reports | P&L FY: GP **1,040** vs independently-derived truth **540** → **overstated +500**; BS Stock-in-Hand **1000** | distortion propagates to BS/capital |
| R-02 path | Cancel V2 → stock qty 13/value 1800/rate 138.46 (recovers); uncancel → distortion returns exactly | valuation is recomputed per call; cancel/uncancel self-heal |

Also verified: no warning in `VoucherScreen.tsx` before save (server accepts, so nothing to surface); `minQty` exists on items but is display-only (LOW badge) — it is not an availability mechanism.

## 6. Impact Assessment

- **Accounting integrity (P1):** COGS and stock value become wrong by construction once stock goes negative; profit and BS are overstated by the clamped amount. All reports downstream (stock summary/movement/valuation, P&L, BS, capital) disagree with the ledgers.
- **Why P1, not P0:** requires a user (or import) to oversell; single-user deployments with reasonable workflow hit it easily (dispatch-before-GRN is normal business practice), but it is not an injection-class, authz-class, or silent-corruption-at-posting defect like B-03 was. The books' double-entry math stays balanced; what breaks is the inventory↔accounting agreement and profit measurement.
- **Data safety:** no persisted data is corrupted — `stockSummary` recomputes; fixing the policy heals historical views (subject to the policy chosen below).
- **Cancel/uncancel, R-02/R-03/R-05:** unaffected; probe confirms reconciliation intact.

## 7. Existing Coverage

`final_regression.py` asserts Physical Stock negative-count rejection (line ~457) only. **Zero tests** for: overselling acceptance, negative-qty valuation, clamping, post-negative purchase averaging, P&L/BS consistency under negative stock. The plan's INV4 was a manual probe, never a regression.

## 8. Policy Question for Human Review (the actual R-06 decision)

The fix is a **product-policy decision**, not just code. Options:

- **Model 1 — Reject oversell (Tally default "Disallow negative stock").** Outward that would drive an item's running qty negative → 400 naming item/voucher; company setting `allowNegativeStock` (bool) for those who need dispatch-first workflows. Valuation code can then assert qty ≥ 0 and remove the clamp entirely. Cleanest; changes behavior for anyone who (knowingly) oversold before — a migration/back-compat question.
- **Model 2 — Allow but value honestly (remove clamp, charge WAVG only on real qty, carry explicit negative-stock value).** No user friction, but negative-qty accounting semantics (what value does −2 units carry?) get complicated and remain a distortion source.
- **Model 3 — Warn, not block (UI-level only).** Rejected as primary: server is the trust boundary; UI-only warnings leave the API/import path open.

Investigation recommends **Model 1** (with the company-level opt-out), consistent with the project's accounting-correctness-first principle. Exact validation point (shared helper used by both `vouchers.ts` and `import.ts`, mirroring the R-04 `validateEntries` pattern), chronological-availability subtleties (backdated purchases before an oversell — rejection should use *chronologically prior* stock, not as-of-latest), and the clamp removal plan are implementation-phase work to be scoped after approval.

**Related but separate (do NOT bundle):** B-02 opening-stock accounting model (its own R-item, R-07 candidate) — the probe deliberately used zero opening stock to isolate B-01.

## 9. Non-Bugs Verified

- Physical Stock negative counted-qty rejection — **NOT A BUG — VERIFIED** working as designed (guarded, tested).
- Cancel/uncancel valuation recovery — correct by design (recompute-per-call), verified live.
- `minQty` LOW badge is informational by design; not an availability control.

## 10. Out of Scope

FIFO-vs-WAVG model choice (existing `costingMethod` field, currently exercised as WAVG by default; FIFO lot logic exists and is out of scope), B-02 opening stock, B-07 master-reference validation, negative-stock *import* UX beyond sharing the same server-side guard, reorder/notification features.

## 11. Proposed R-06 Implementation Scope (pending approval)

1. Company setting `allowNegativeStock` (default false) + shared availability guard in the voucher create/edit and import paths (chronological qty check per item).
2. Remove/condition the clamp and zero-cost branches in `stock.ts`; make negative state impossible unless the setting opts in (and document the opted-in semantics honestly).
3. Regression block: oversell → 400; with setting → allowed + documented valuation; backdated-purchase ordering; cancel/uncancel interactions; P&L/BS consistency assertions.
4. UI: server-driven error surfaces in VoucherScreen (already renders server messages); optional client-side pre-warning (cosmetic, non-binding).
5. Browser acceptance: real Sales oversell through the UI shows the 400 banner and no row is created.

## 12. Final Safety Check

```
git status --short → ?? R-06_INVESTIGATION.md, ?? ZLEDGER_PRODUCTION_ACTION_PLAN.md
HEAD unchanged: e8c808b72bcf605974c419940a3ddbb5c5b19158 = v1.5.0
No source/test/migration/doc modifications; probe data confined to disposable stack; /tmp scripts deleted.
```

**VERDICT: R-06 CONFIRMED — INVESTIGATION REQUIRED**
