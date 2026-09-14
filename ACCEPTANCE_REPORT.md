# zprime — Acceptance Test Report

**Date:** 2026-09-10 · **Method:** fictional Indian trading business driven through the **real UI** (Playwright + Chromium, keyboard-first — no direct API calls for data entry), reconciled at every month-end against an **independent expectation engine** (Python, shares no code and no queries with zprime).

**Verdict: 117/117 checks passed** (re-run 2026-09-10 after the final acceptance-repair pass; originally 116/116 with 9 open findings). Three months of books reconcile to the paisa. All findings from this report were subsequently **fixed and regression-verified** — see §3 status column and `BUG_FIX_REPORT.md`.

---

## 1. The business

**Meridian Traders** — electrical-goods trading, Maharashtra (GSTIN `27MERID12TR3`), FY 2026-27 (Apr–Jun tested).

- **Parties:** Sharma Electricals (27, registered), Karnataka Traders (29, registered), Sunrise Agencies (29, registered creditor), Global Spares (27, registered creditor), Vision Components (27, registered creditor), Deshmukh Traders (unregistered), Bharat Freight (unregistered).
- **Stock:** 6 items (LED Bulb 9W, LED Tube 20W, Copper Wire, Switch 6A, MCB 32A, Exhaust Fan), two godowns, `pcs`/`m` units, FIFO valuation via layered purchases at different rates.
- **Payroll:** 2 employees (Ramesh Kumar, Sunita Pawar), Basic+HRA earning heads, Professional Tax deduction head, TDS remittance.
- **Company B (Vasan & Co, Karnataka):** isolation probe — must see none of Company A's data.

### Transactions executed (all via UI forms & type-aheads)

Opening journals; intra-state purchases @18%; interstate purchase @IGST (Karnataka supplier); 5% / 18% / exempt / interstate sales; **credit note** (customer return); **debit note** (supplier return); partial & full bill-wise settlements against named refs; on-account advance; cash & bank payments; freight expense; backdated purchase entered in June for April (VC/101); mid-life **voucher edit** (VC/88 alter) and **delete** (duplicate opening journal); duplicate-opening mistake → delete → re-enter; stock purchase→sale→return cycles; payroll May + June with PT deduction; TDS deduction lines (rent 194I, site labour 194C) + remittance; company creation/switching; keyboard shortcuts (F4–F9, Ctrl+A, Esc).

Deliberate mistakes: duplicate opening journals (deleted), negative-amount deduction encoding (surfaced A-03), wrong-party bill allocation attempt (blocked by the app — BUG-002 fix verified working).

---

## 2. Result

```
== ACCEPTANCE RESULT: ALL CHECKS PASSED ==  (117 checks, 0 failures — post-repair re-run)
== ACCEPTANCE RESULT: ALL CHECKS PASSED ==  (129 checks, 0 failures — v1.1.0 release run)
```

The v1.1.0 run adds: `inv/sj-only` + `inv/ps-only` (F-INV-01 inventory-only vouchers through the real UI) and 12 `jun/cb-subperiod` checks (O-1: May-window Cash/Bank viewed in the browser while June vouchers exist — opening, Period Dr/Cr, closing, ledger drill-down, UI identity, future-contamination canary, per ledger). Combined release verification: **622/622 checks, 0 failures** (39 smoke, 88 adversarial, 65 bug-fix regression, 48 reconciliation, 224 final regression, 29 attack-the-fixes, 129 UI).

### Post-v1.1.0 — R-01 GSTR-1 HSN fix (P1 reporting integrity, FIXED)

Investigation confirmed the HSN summary selected inventory rows by quantity direction instead of outward voucher semantics (purchases/receipt notes included, sales excluded, `hsn="-"`/`rate=0` from NULL snapshots). Fixed in `gstr1()` only: population = voucher type `Sales` (same rule as `voucherGst(..., "outward")`), snapshot → stock-item-master fallback for HSN/rate, positive outward qty. The acceptance suite now **reconciles every rendered HSN row cell against the independent engine's Sales-only expectation** (`hsnMonth`) each month-end, plus purchase-exclusion canaries and a no-placeholder assertion — +11 UI checks (129 → 140). Final regression adds 59 R-01 checks (224 → 283) including the ₹91,111 purchase canary (fails against the old implementation), stock-only-movement non-pollution, master-fallback and stored-snapshot precedence, and backdate/edit/delete propagation. Post-fix verification: **711/711 checks, 0 failures**; Docker fresh-volume + restart persistence re-verified with an in-container HSN probe (`1234`, qty 2, taxable 1000, rate 18).

### Post-v1.1.1 — R-02 voucher cancellation (Model A, IMPLEMENTED)

Phase-1 investigation proved `vouchers.isCancelled` had full read-side exclusion in every report query but **no writer existed** — cancellation was unreachable and users had only hard-delete. Implemented as **Model A (mark + exclude)**: cancel preserves the voucher row, number and all attached entries/inventory/bills; **no reversal entries are ever created**; active reports exclude the voucher while cancelled; uncancel restores the exact prior state.

The acceptance suite now exercises the full lifecycle through the **real UI**: cancel the May credit note (CN-1) from Day Book with confirm dialogs → `Cancelled` badge rendered, voucher number preserved, no Alter/Del actions, `Uncancel` offered; VoucherScreen shows the read-only cancelled banner; the independent engine's expected deltas are asserted (`r02/gstr1-excluded`: FY outward total drops by exactly the CN amount; `r02/receivables-shift`: party outstanding shifts by exactly +2,360) and the Day Book API still lists the voucher with `isCancelled=true`; then uncancel through the UI and assert **exact restoration** — TB totals, party receivable and FY outward total return to the pre-cancellation values (`tb/receivables/gstr1-restored`), badge cleared. **+13 UI checks, 140 → 153.**

Final regression adds 85 R-02 API-level checks (283 → 368): per-type cancel/uncancel for all fourteen voucher types with effect-exactness, state-machine attacks (double cancel 409, uncancel active, edit/delete cancelled, cancel deleted/nonexistent, malformed id, unauthenticated, cross-company), before/cancelled/after-uncancel report equality (TB/BS/P&L/ledger/AR/cash), settled-bill guard vs unsettled bills, numbering never reusing a cancelled number, GST/HSN (R-01 semantics intact) exclusion, Salary Register + Cheque Register exclusion (the two read-side gaps found in Phase 1, fixed), and a payroll hard-delete guard protecting processed months. Post-fix verification: **790/790 checks, 0 failures**; Docker fresh volume + restart persistence + cancel/uncancel probe, plus an in-place upgrade simulation from a v1.1.1 database (migration 0002 applies alone; `cancelled_at`/`cancel_reason`/`cancelled_by` added nullable, data intact). **Released as v1.2.0.**

### Post-v1.2.0 — R-03 user→company authorization (Model C membership junction, IMPLEMENTED)

Phase-1 investigation (live-proven against v1.2.0, T1–T6) confirmed **authentication without authorization**: `cid()` checked only company *existence*, `GET /companies` returned the whole table, and any second authenticated user could read, modify, delete and cancel any company's data. Implemented as **Model C — `user_companies` membership junction** (additive migration `0003`, backfill = existing users × existing companies as owners, exactly the pre-R-03 effective access model; plus `vouchers.cancelled_by → users.id ON DELETE SET NULL`, the FK deferred by R-02).

**Authorization is centralized inside `cid()`** — every `/api/c/:cid/*` route now requires server-side membership, resolved per request (revocation is immediate, no JWT change, no companyId in the token). Unauthorized companies answer **404**, indistinguishable from unknown — no existence leak. Company routes membership-scoped: list filtered, detail/update gated 404, creation atomically grants owner membership; minimal **owner-only** member management (last-owner removal → 409). Frontend: stale/revoked `/company/:cid` renders a neutral "Company not found" notice with recovery link.

Real-browser verification: existing 153-check suite re-run green on the R-03 build, plus a dedicated **12/12 R-03 UI scenario** (`scripts/acceptance/r03_ui.js`) — owner sees both companies, second user sees only his own, direct navigation to the other company's URL → neutral 404 with no data leak, owner grants membership → access appears, revokes → access disappears immediately without re-login. Final regression adds 31 R-03 API checks (368 → 399): directory scoping, cross-company 404s across vouchers/masters/reports/GST/cheque-register/import, member-vs-owner rights, immediate revocation, last-owner/self-removal guards, and `cancelled_by` = the authenticated cancelling user. Post-fix verification: **821/821 checks, 0 failures**; Docker fresh volume + upgrade simulation from a v1.2.0 database (0003 applies alone, journal 3 → 4, data intact). Accounting mathematics untouched — authorization decides *who*, never *how*.

Per month-end (Apr 30, May 31, Jun 30), every identity below was compared **screen vs independent engine**, then traced to the DB where anything looked off:

| Identity | Apr | May | Jun |
|---|---|---|---|
| Trial Balance Dr = Cr (period + ledger closings) | ✓ | ✓ | ✓ |
| Balance Sheet Assets = Liab + Capital (no difference banner) | ✓ | ✓ | ✓ |
| P&L net profit (cumulative, and app-mirror for month) | ✓ | ✓ | ✓ |
| Stock Summary qty/value per item (FIFO incl. backdated layering) | ✓ | ✓ | ✓ |
| Bills Receivable / Payable per party | ✓ | ✓ | ✓ |
| GSTR-1 outward rows (month) | ✓ | ✓ | ✓ |
| GSTR-3B net payable (month) | ✓ | ✓ | ✓ |
| TDS by section (with A-04 mirror) | ✓ | ✓ | ✓ |
| Cash / Bank closing | ✓ | ✓ | ✓ |
| Salary Register net per payslip | ✓ | ✓ | ✓ |
| Sales / Purchase register totals | ✓ | ✓ | ✓ |

Key numeric spot-checks that verified against the DB:

- **FIFO:** tubes 200 − 80 = 120 @ ₹6,000; opening 100@50 + 200@50 − 80@50 = 220/₹11,000; backdated VC/101 correctly re-layered April stock.
- **GSTR-3B June:** −3,420 = 1,080 (ITC incl. DN) − 4,500 (exempt outward) — app math correct.
- **BS:** TL = TA = 1,739,410 at Apr 30; no difference banner any month.
- **Payroll postings:** Salaries Dr 142,000; Salary Payable nets to 0 after June settlement; PT Payable Cr 800 (200 × 2 emp × 2 mo); TDS Payable Cr 2,500 + remittance −2,500 = 0.
- **Isolation:** Company B Day Book/receivables show zero Company A parties or vouchers.

---

## 3. App findings

| ID | Sev | Title | Status |
|---|---|---|---|
| **A-01** | P1 | GSTR-3B white-screens the entire React app (`Gstr3bView` spreads named server fields into a positional `Row`; `money(undefined)` unmounts root). Report had *never* rendered. | **Fixed** (`client/src/pages/Reports.tsx`). UI re-run: GSTR-3B renders and reconciles all 3 months. |
| **F-GRP-01** | P1 | Custom group creation via UI 500s — create path never sets NOT NULL `nature`. | **Fixed** (`routes/masters.ts` beforeSave: nature inherited from parent group, top-level requires nature; `lib/routes.ts` groupSchema tolerates empty-string nature; duplicates → clean 409; children forbidden only under Primary/P&L A/c). UI re-run: group created under Current Assets. |
| **F-TDS-01** | P1 | `/masters/tds-sections` list 500s — `masters.ts` sorts every list by `.name`, table has only `section`. TDS Sections master unusable, ledger "TDS Section" select can never populate, Alt+T inert. | **Fixed** (`masters.ts` sort key `bySection` + `tdsSectionSchema` validation; client list key fixed). UI re-run: sections create/list work. |
| **A-02** | P2 | Auto bill names are per-type voucher numbers → Credit Note #1's bill is also named "1" and silently nets into Sales #1's bill on the same ledger (open 6,160 → 3,800). Outstanding truth corrupted. | **Fixed** (client auto-name `${shortCode}-${number}` → `SALES-3`, `CRN-1`, …; server enforces per-party-ledger bill-name uniqueness at the DB transaction boundary, self-exclusion on edit). UI re-run: exact-bill settlement by typed name; CN bill stays distinct. |
| **A-03** | P2 | Server accepts **negative monthlyAmount on a deduction head**; payslip math then *adds* it (net 26,200 > gross 26,000). Books stayed balanced; the payslip lied. | **Fixed** (`routes/payroll.ts` rejects negative/NaN amounts on deduction heads and non-positive gross — 400, never 500). |
| **A-04** | P2 | TDS report sums **all** entries on the TDS ledger — remittance payments counted as deductions, so total reads 2×. | **Fixed** (`routes/reports.ts` TDS view: deductions and remittances aggregated separately by direction; report shows deducted, remitted, outstanding). |
| **A-05** | P2 | `onAccount` allocations are computed in `parties()` (accounting.ts:383) but **never merged** into party totals — an on-account advance against a party is invisible in outstanding reports (Deshmukh: ledger 2,500, card 4,500). | **Fixed** (`services/accounting.ts`: on-account net merged per party ledger as a synthetic "On Account" bill). UI re-run: Deshmukh card = ledger truth (4,500 − 2,000 = 2,500). |
| **A-06** | P2 | P&L for any sub-period shows **cumulative-through** figures (server sums books-begin closings, not period movements). May-only P&L wrong (ui 252,350 vs true 75,400). | **Fixed** (`services/accounting.ts` profitAndLoss: P&L heads use period movements debit−credit; stock lines period-correct; FY report unchanged). UI re-run: `pnl-month` checks pass for Apr/May/Jun. |
| **A-07** | P2 | `voucherGst` resolves supply type **only** from party state/GSTIN; when duty heads contradict the party (Input IGST on a 27-supplier), the IGST columns are silently zeroed in GSTR-3B while the ledger still carries the tax (1,215 vanished from May's return). No warning anywhere. | **Fixed** (`services/gst.ts` canonical rule: **duty-head amounts are authoritative**; classification is advisory. Contradictions are no longer silently zeroed — the IGST/CGST+SGST columns report the ledger's actual duty amounts, and `supplyMismatch` is flagged). Regression: the ₹1,215 case is a permanent check in `scripts/final_regression.py` + the engine mirror. |
| **F-INV-01** | P3 | Inventory-only Stock Journal cannot be entered via UI (no Ledger Entries section at all) — blocked rather than supported; undocumented. | **Fixed** (post-release: client save-gate exception for inventory-category vouchers with ≥1 real stock movement; server `assertLedgersTx` relaxed, `validateEntries` still authoritative; +35 checks incl. concurrency/cross-company attacks, `inv/sj-only` + `inv/ps-only` UI scenarios, in-container Docker probe). |
| **O-1** | P4 | Cash/Bank "Closing" includes vouchers dated after the report's `to` date (all-time sum), while Opening respects it — period semantics inconsistent. | **Closed — NOT REPRODUCIBLE** (post-release investigation: Opening ≤ from−1, Movement [from,to] inclusive, Closing = Opening + Dr − Cr, future vouchers excluded; code identical to v1.0.0; controlled reproduction failed; attributed to a FY→month-end-only coverage gap). Test-only remediation: 92 sub-period/boundary/edit/backdate/delete checks, independent engine `cashBankSub`, `jun/cb-subperiod` real-browser scenario with future-contamination canary. No production Cash/Bank logic modified. |

### Reconciliation against the earlier QA pass

- **BUG-002 (bill allocation integrity) fix verified in real use:** wrong-party/excess allocations rejected through the UI flow.
- **BUG-001 (voucher numbering)** held throughout: no duplicates or reuse across 3 months, edits, deletes, and backdating.

---

## 4. Test-rig corrections (documented so the numbers stay honest)

These were **my** errors found by reconciliation — listed to show the app was not forgiven anything:

1. Opening-capital scheme double-counted (master openings + journals) → journals-only scheme, unbalanced books eliminated before judging the app.
2. TB parser read period-movement cells; app shows **closing** balances in cells 4/5 → parser fixed to app semantics, engine mirror updated.
3. Salary Register parser read **Gross** (cell 2) instead of **Net** (cell 4).
4. GSTR-3B parser grabbed the "1" in the "Alt+F1" footer hint → slice at the Net panel's "Total".
5. Engine payroll mirror: gross = earning heads only (PT is a deduction, not an earning) — matched to `routes/payroll.ts`.
6. Engine `gst_of` now mirrors the app's supply-type rule (see A-07).
7. Grid automation: ledger-grid `tbody` includes the Total strip row → row-indexing fixed; CN/DN added to scenario; FIFO item amounts recorded for backdated layers.

---

## 5. Verdict

**Post-repair verdict: all conditions from this report are now met.**

The double-entry core was already sound over sustained, messy, real-world use; after the final acceptance-repair pass the peripheral defects are fixed too, each verified three ways: API regression tests, the independent reconciliation engine, and a full re-run of this UI acceptance suite (117/117, including new F-GRP-01 and A-02 regression probes).

**Conditions — all closed:**
1. ✅ F-GRP-01 + F-TDS-01 fixed (group create via UI succeeds; TDS sections master usable).
2. ✅ A-02 + A-05 fixed (bill names unambiguous per party/type; on-account merged into outstanding).
3. ✅ A-04, A-06, A-07 fixed (TDS report splits deductions/remittances; sub-period P&L is period-correct; duty heads authoritative in GST reports — IGST can no longer silently vanish).

### Artifacts
`scripts/acceptance/` — `run.js` (scenario+checks), `driver.js` (UI driver), `engine.py` (expectation engine), `state.json` (entered business events), `expected.json` (engine figures), `run.log`, `shots/` (screenshots per check).
