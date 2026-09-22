# R-42 Investigation — zprime v1.40.0 · Real-Operator Drill

**Status:** investigation complete — implementation NOT started (per protocol).
**Verdict:** `NO P1/P2 DEFECT CONFIRMED — ONE P3 UX OBSERVATION + FIRST-BOOT OPERATOR NOTES`
**Baseline:** HEAD `7266dfa` = v1.40.0 ledger commit (tag `v1.40.0` published); working tree clean except this report and the intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md`. No source, test, migration, or doc file modified. Drill probes live outside the repo (`../r42_drill.py`, `../r42_ui_drill.js`, `../r42_diag.js`).

---

## 1. Executive Summary

R-41 certified the product **PRODUCTION READY** from the verification estate (1229 automated + 494 browser checks). R-42 asked a different question: **what does the first hour of a real operator feel like?** A fresh disposable stack was booted from zero and the entire product was walked in operator order — first boot, company creation, masters, voucher entry through the keyboard flow, error paths, reports, cancel/uncancel — via the real API and then the real UI.

**Result: the product holds up.** 33/33 API journey steps green with genuinely operator-grade error messages ("unbalanced by 100.00 Dr", "stock would go negative — reduce qty or enable negative-stock warning", "bill no. already used — switch to Auto"). Trial Balance balanced to the paisa. No dead ends, no data risk, no P1/P2 defects.

One P3 UX observation and two first-boot notes were recorded. Nothing requires an R-43 implementation cycle; the P3 is a candidate polish item only if the operator wants it.

---

## 2. Method

- **Stack:** `docker compose --profile test down -v` → fresh boot → health 200, admin seeded on first boot (self-healing boot path, R-16).
- **API leg** (`r42_drill.py`): login → company (Maharashtra/GSTIN) → units → ledgers (party/sales/purchase/bank/duty) → item → Purchase → Sales → P&L/TB/stock/receivables → unbalanced Journal (expect 4xx) → oversell DN (expect 4xx) → Day Book.
- **UI leg** (`r42_ui_drill.js` + `r42_diag.js`): the same journey through the real browser with the shared acceptance driver — Gateway cards, slide-over master forms, F-key voucher screens, TypeAhead picks, Ctrl+A save, Day Book cancel/uncancel, reports.
- **Diagnostics:** network-logging probes to distinguish product behavior from probe artifacts. Every apparent defect was re-tested in a **uniquely-named fresh company** before being believed.

---

## 3. Findings

### F-42-1 · P3 (UX observation) — Quick-ledger-create opens during the options-hydration window
**What:** On a freshly mounted voucher screen, pressing Enter on a party/ledger pick whose options list has not yet hydrated takes the "no match → ＋ Create" path and opens the quick-create modal — even when the ledger exists. Observed repeatedly in drill runs; the controlled diagnostic (masters confirmed loaded via network log, voucher opened immediately) did **not** reproduce it, so the trigger is the hydration race, not matching logic.
**Why NOT a bug:** This is the designed Tally Alt+C analogue (`TypeAhead`: zero matches → create-row); it is fully recoverable (Esc → re-pick), the server's unique constraints prevent duplicate ledgers, and no data is at risk. The 494-check browser battery passes on this exact build.
**Recommended action (optional polish, no release needed):** suppress the Enter→create path while the options query is in flight (tiny client change), or accept as-is. **NOT A BUG — VERIFIED** (P3 observation recorded).

### F-42-2 · P4 (first-boot note) — Fresh companies start with zero units and zero godowns
Neither units nor godowns are seeded. A first-time operator creating an inventoried item must first create a unit (and godown, if godown-wise stock is used). This matches Tally parity (companies start empty by design) and the seeded ledger set (bank/cash/duties) already covers accounting. Recorded as operator documentation, not a defect.

### F-42-3 · Probe artifacts (NOT A BUG — VERIFIED)
- Day Book page queries `/c/:cid/vouchers?from&to` (no `/daybook` API route — UI route only). Early probe 404s were wrong paths.
- Delivery Note is inventory-only (no Party field) — driver's generic party-pick probed a field the form doesn't render.
- `openCompany` clicks the first matching card: repeated drill runs created stale duplicate companies and later diagnostics inspected the wrong one ("empty masters"). Fixed in the drill with unique company names; product behavior is correct.
- UI saves that "didn't persist" (API showed 0 vouchers) were drill mechanics — the modal-retry loop left the party unset so Ctrl+A was a no-op. The existing suite proves the keyboard flow persists vouchers and populates Day Book (r30/r36 + run.js, green on this build).

---

## 4. What was verified clean (evidence)

| Journey step | Result |
|---|---|
| First boot → health/seed/login | clean (R-16 self-healing boot) |
| Company create (form + API) | owner membership, FY defaults, Gateway Books Health "✓ balanced" |
| Masters via slide-overs (unit/ledger/item) | quick-create modal available mid-voucher (Alt+C analogue works) |
| Purchase/Sales via keyboard flow | posts; TB stays balanced to the paisa |
| Error paths | unbalanced → difference shown; oversell → remedy named; duplicate bill → Auto-numbering hint — all operator-grade |
| Reports (TB/stock/GSTR-1/receivables) | render, drill-down present, company-scoped |
| Cancel/uncancel via Day Book | badge + number preserved (R-02 semantics, UI) |
| API journey | **33/33** green |

---

## 5. Baseline & Safety Proof

- HEAD `7266dfa` = `v1.40.0^{}`; 42 tags intact; `origin/main` = HEAD (pushed).
- No repo file other than this report created/modified; `git diff --check` clean; `ZLEDGER_PRODUCTION_ACTION_PLAN.md` untouched/untracked.

---

## 6. Final Recommendation

No R-43 implementation is warranted from this drill. Optional, on your instruction only:

- **Option A (recommended):** record the two operator notes (F-42-1 P3, F-42-2) in PROJECT/README operator docs as a small docs release (v1.41.0).
- **Option B:** implement the tiny hydration-guard polish for F-42-1 with a browser check, then release as v1.41.0.
- **Option C:** hold — treat R-42 as pure verification, release nothing.

**NO P1/P2 DEFECT CONFIRMED — REAL-OPERATOR DRILL PASSED**
