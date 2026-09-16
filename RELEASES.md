# RELEASES.md — Immutable Release Ledger

The authoritative release history of zprime. **Every entry below is immutable.** Never rewrite history, never modify a released commit, never move or re-point a tag. The next release is appended below the last entry.

---

## v1.8.0

- **Commit:** `v1.8.0^{}` — resolve with `git rev-parse v1.8.0^{}` (a release commit cannot contain its own SHA; the annotated tag is the permanent pointer)
- **Tag:** `v1.8.0` (annotated; `v1.8.0^{}` = the release commit, verified at release)
- **Major purpose:** Cross-company master-reference validation (R-08, B-07 P1, route-level fix — no migration). Central `assertCompanyRefs` hook in crud.ts: a declarative `opts.refs` spec verifies every provided FK id belongs to the caller's company on POST and PUT (wired: ledgers.`groupId`, stock-items.`unitId`/`groupId`/`categoryId`, pay-heads.`ledgerId`); salary-structure PUT validates every `headId` in-company; payroll processing belt-and-braces asserts every used pay-head's `ledgerId` belongs to the company — a legacy foreign-ledger row (accepted before R-08) now fails loudly at posting with a named-head 400 instead of silently unbalancing the books.
- **Verification status:** VERIFIED AT RELEASE —
  - 796/796 automated checks (Python: smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression 514 (+17 dedicated R-08 checks: foreign group/unit/stock-group refs → 400 on POST and PUT, in-company refs still 200, pay-head foreign ledger → 400, salary-structure semantics, psql-inserted legacy foreign-ledger row → payroll 400 "references a ledger outside this company", TB asserted balanced after the rejection), attack-the-fixes 29)
  - 198/198 browser checks (baseline 153 + R-03 UI 12 + R-04 UI 9 + R-05 UI 12 + R-07 UI 12) on the rebuilt bundle and a fresh volume; zero client changes (no new UI suite needed)
  - typecheck (server + client) clean
  - fresh Docker verified (fresh volume, healthchecks)
  - independent accounting reconciliation green — no accounting-mathematics change: validation decides *whether a reference may be written*, never *how anything calculates*; voucher-path validation trio untouched; R-03/R-06/R-07 behavior unchanged
  - no migration, no schema change; read paths unchanged so existing books keep working; DB-level composite-FK enforcement explicitly deferred (route-level validation closes every reachable path)
- **Important fixes:** P1 closed — the last known path to silently unbalanced books (pay-head → foreign ledger → payroll → entry invisible to both companies' reports, TB Dr=0/Cr=10,000, live-reproduced on v1.7.0) is impossible: the reference is rejected at creation, and any legacy row fails loudly at posting.
- **Immutable status:** 🔒 IMMUTABLE — `v1.8.0` is the current production baseline.

## v1.7.0

- **Commit:** `v1.7.0^{}` — resolve with `git rev-parse v1.7.0^{}` (a release commit cannot contain its own SHA; the annotated tag is the permanent pointer)
- **Tag:** `v1.7.0` (annotated; `v1.7.0^{}` = the release commit, verified at release)
- **Major purpose:** Opening balances in reports (R-07, B-02 re-verified: F-07-1 P1 + F-07-3 P2 fixed; F-07-2 documented per approved Model A). Party master openings now surface in Bills Receivable/Payable as a display-only synthetic "Opening Balance" bill dated books-begin (allocation sign convention: Debtors Dr +, Creditors Cr −; Against Ref settlement is a clean 400; on-account receipts net into the party total). Balance Sheet zeroing of Stock-in-Hand is structural — the group **and all descendants** (`descendantGroupIds()`), so SIH sub-group ledgers (Finished Goods, Raw Materials, …) can no longer double-count stock in assets. Independent engine `bills()` mirror aligned; PROJECT.md documents the opening-balance architecture and the manual opening-journal workflow for unfunded item openings (the honest "Difference in books" banner is designed behaviour).
- **Verification status:** VERIFIED AT RELEASE —
  - 779/779 automated checks (Python: smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression 497 (+16 dedicated R-07 checks: AR/AP openings incl. Cr-signed creditor, synthetic-bill shape, AR total, no-settlement 400, on-account netting 50k→40k, sub-group no-double-count, books-balance difference-0), attack-the-fixes 29)
  - 198/198 browser checks (baseline 153 + R-03 UI 12 + R-04 UI 9 + R-05 UI 12 + R-07 UI 12) on the rebuilt bundle and a fresh volume; new `r07_ui.js` covers the AR opening row visible/expandable in the real UI, AP −20,000 signed, BS banner absent before/after an unfunded sub-group ledger, zero page errors
  - typecheck (server + client) clean
  - fresh Docker verified (fresh volume, healthchecks)
  - independent accounting reconciliation green — no accounting-mathematics change: openings were already in TB/BS/closings; the reports now *show* the money they already carried. R-06 availability guard untouched (report-side only).
  - no migration, no schema change, no API surface change; client needed zero changes (OutstandingView renders bills generically)
- **Important fixes:** P1 closed — a migrated book's party balances were silently missing from the Outstanding reports whose purpose is collecting/paying that money (debtor opening 50,000 visible in TB, AR total 0). P2 closed — silent BS stock double-count through Stock-in-Hand sub-groups.
- **Immutable status:** 🔒 IMMUTABLE — `v1.7.0` is the current production baseline.

## v1.6.0

- **Commit:** `v1.6.0^{}` — resolve with `git rev-parse v1.6.0^{}` (a release commit cannot contain its own SHA; the annotated tag is the permanent pointer)
- **Tag:** `v1.6.0` (annotated; `v1.6.0^{}` = the release commit, verified at release)
- **Major purpose:** Negative-stock availability guard (R-06, B-01 P1) — **Model 1 approved: reject oversell, company-level opt-out.** Chain-comparison availability gate in `vouchers.ts`: movements replay chronologically (date, then voucher id; grandfathered negative states from the permissive era are tolerated as found), and a mutation is rejected **400** only when it turns a previously-valid step invalid — covering create, edit, cancel, uncancel, delete, and both XML import paths (no side doors). Physical Stock rows are absolute counts (opening folded once; PS replaces the running quantity; diff posted at running average). Additive migration `0004` adds `companies.allowNegativeStock` (default **false**); opted-in companies keep the permissive model but get **honest valuation** (`stock.ts` no longer clamps negative value to zero and caps WAVG unit cost at the item's latest purchase rate instead of charging 0 for phantom units). CompanySettings gains the Allow-Negative-Stock toggle.
- **Verification status:** VERIFIED AT RELEASE —
  - 763/763 automated checks (Python: smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression 481 (+21 dedicated R-06 checks: oversell 400, backdated legitimization, edit/cancel/uncancel/delete strand-rejection, import gate, opt-in honest valuation, chronological semantics), attack-the-fixes 29)
  - 186/186 browser checks (baseline 153 + R-03 UI 12 + R-04 UI 9 + R-05 UI 12) on the rebuilt bundle; pre-R-06 fixture companies opt in explicitly via `D.allowNegativeStock` (seeding helper, never a bypass of asserted guard behaviour)
  - typecheck (server + client) clean
  - fresh Docker verified (fresh volume, healthchecks, 0 error patterns in logs)
  - independent accounting reconciliation green — zero accounting-engine changes; the guard decides *whether a voucher may post*, never *how it posts*
  - migration is additive-only (one column, safe default, no destructive SQL); existing books without negative stock are unaffected, existing books with negative stock keep working via the opt-in flag
- **Important fixes:** P1 closed — overselling was accepted silently (phantom-unit WAVG cost), further sales posted zero COGS once stock went negative, and the next purchase averaged positive value onto a negative quantity, overstating P&L gross profit by the phantom margin (live-reproduced on v1.5.0). The posting path now refuses the first oversell instead of hiding it in the valuation.
- **Immutable status:** 🔒 IMMUTABLE — `v1.6.0` is the current production baseline.

---

## v1.5.0

- **Commit:** `v1.5.0^{}` — resolve with `git rev-parse v1.5.0^{}` (a release commit cannot contain its own SHA; the annotated tag is the permanent pointer)
- **Tag:** `v1.5.0` (annotated; `v1.5.0^{}` = the release commit, verified at release)
- **Major purpose:** Credit/debit-note GST reporting (R-05, B-06 P1) — `voucherGst()` aggregates with the books' natural signs instead of `Math.abs()` folding, so credit notes *subtract* from GSTR-1/3B output and debit notes *subtract* from ITC (previously both were counted as additional supplies, overstating tax); `gstr1()` returns real Table 9B **CDNR** (registered) and **CDNUR** (unregistered) sections with positive magnitudes plus `net*` totals (Table 9 net of 9B) that reconcile exactly with the ledgers; GSTR-1 UI gains the Net-supplies card and CDNR/CDNUR tables. Approved scope extension: **Apply-GST party balance** — the voucher-entry helper was doubly broken (sign-inverted duty-base selection meant duty rows were never inserted for Sales/Purchase and landed on the wrong side for CN/DN; the party row was never re-balanced, so Ctrl+A after Apply GST was always rejected); duty is now computed on the correct rows and pushed on the correct side for all four types, and the party row re-balances so the voucher saves immediately.
- **Verification status:** VERIFIED AT RELEASE —
  - 742/742 automated checks (Python: smoke 39, adversarial 88, bug-fix 65, reconciliation 61 (+13 independent CN/DN scenario incl. cross-period negative-month net), final regression 460 (+43 R-05), attack-the-fixes 29)
  - 186/186 browser checks (baseline 153 + R-03 UI 12 + R-04 UI 9 + R-05 UI 12 incl. real Apply-GST save through the UI)
  - typecheck (server + client) clean
  - fresh Docker verified (fresh volume, healthchecks, 0 error patterns in logs)
  - independent accounting reconciliation green — zero accounting-engine changes; reports only; ledger identities asserted (GSTR-1 net − ITC == duty-ledger net credit)
  - no migration; no schema change; JWT untouched
- **Important fixes:** P1 closed — statutory reports no longer contradict the ledger by construction (live-reproduced on v1.4.0: 3B net 1,440 vs book truth 1,080). A real-user Sales → Apply GST → Ctrl+A flow saves for the first time.
- **Immutable status:** 🔒 IMMUTABLE — `v1.5.0` is the current production baseline.

---

## v1.4.0

- **Commit:** `v1.4.0^{}` — resolve with `git rev-parse v1.4.0^{}` (a release commit cannot contain its own SHA; the annotated tag is the permanent pointer)
- **Tag:** `v1.4.0` (annotated; `v1.4.0^{}` = the release commit, verified at release)
- **Major purpose:** XML import integrity (R-04: B-03 + B-05 + B-13 + B-14) — the entire import now runs in one transaction (any rejection rolls back masters + vouchers + allocations atomically); every imported voucher passes the same double-entry gate as the API (`validateEntries`, F-INV-01 for inventory types); bill allocations validated with the API's rules (name, non-zero, direction, must total the entry); failures answer 400 naming the offending voucher; imported-ledger GST `taxability` classified from ledger identity (duty heads stay non-taxable), making GSTR-1 internally consistent; client `api()` no longer forces `Content-Type: application/json` onto FormData — the import page's file-upload mode works for the first time (B-14).
- **Verification status:** VERIFIED AT RELEASE —
  - 686/686 automated checks (Python: smoke 39, adversarial 88, bug-fix 65, reconciliation 48, final regression 417, attack-the-fixes 29)
  - 174/174 browser checks (baseline 153 + R-03 UI 12 + R-04 UI 9, incl. real file-upload import of balanced and unbalanced XML)
  - typecheck (server + client) clean
  - fresh Docker verified (fresh volume, healthchecks, 0 error patterns in logs)
  - independent accounting reconciliation green (no accounting formula changed — validation only rejects input that would corrupt books; previously-valid imports behave identically)
  - no migration; no schema change; JWT untouched
- **Important fixes:** P0 closed — the only path that could silently corrupt the ledger itself (unbalanced imported vouchers → permanently unbalanced Trial Balance, live-reproduced on v1.3.0 as TB 400/600) now cannot persist. Partial imports (previously committed piecemeal on mid-file failure) are now impossible.
- **Immutable status:** 🔒 IMMUTABLE — `v1.4.0` is the current production baseline.

---

## v1.3.0

- **Commit:** `38637c14f4e2eea4054385f9f006545b69c7a519`
- **Tag:** `v1.3.0` (annotated; tag object `b897dffdf44de47ac7e5d7419915c9f707c02755`; `v1.3.0^{}` = commit above)
- **Major purpose:** Company authorization and memberships (R-03) — Model C `user_companies` membership junction; authorization centralized in `cid()` (server-resolved per request, immediate revocation, 404 no-leak semantics); membership-filtered company list; atomic company + owner-membership creation; minimal owner-only member management (last-owner removal → 409); `vouchers.cancelled_by → users.id` FK (the FK R-02 deferred); stale-cid "Company not found" UI handling; additive migration `0003` with status-quo-preserving backfill.
- **Verification status:** VERIFIED AT RELEASE —
  - 821/821 automated checks (668 Python: smoke 39, adversarial 88, bug-fix 65, reconciliation 48, final regression 399, attack-the-fixes 29; + 165 browser)
  - 165/165 browser checks (baseline acceptance 153/153 + dedicated R-03 multi-user UI scenario 12/12)
  - fresh Docker verified (fresh volume, migrations auto-apply, healthchecks, clean logs)
  - upgrade verification (simulated v1.2.0 database → migration 0003 applies alone, data intact)
  - independent accounting reconciliation green (accounting mathematics untouched — authorization decides *who*, never *how*)
  - live multi-user security probe (cross-company 404s, immediate grant/revoke on the same JWT, last-owner 409)
- **Important fixes:** P1 authorization landmine closed — a second authenticated user could previously read/modify/delete/cancel any company's data. Authorization now requires server-verified membership on every request; unauthorized companies are indistinguishable from unknown.
- **Immutable status:** 🔒 IMMUTABLE — `v1.3.0` is the current production baseline.

---

## v1.2.0

- **Commit:** `5e5c09b702023827d2218ca25485cc565fb5dded`
- **Tag:** `v1.2.0` (annotated)
- **Major purpose:** Voucher cancellation (R-02) — Model A mark + exclude: cancel preserves the voucher row, number, entries, inventory and bills; no reversal entries; active reports exclude; uncancel restores exactly. Cancel/uncancel APIs (transactional, FOR UPDATE, company-scoped, clean 404/400/409); cancelled vouchers reject edit/delete (409); settled-bill guard; payroll hard-delete guard; Salary/Cheque Register cancellation fixes; Day Book cancelled badge + Uncancel; read-only VoucherScreen; additive migration `0002` (`cancelled_at/cancel_reason/cancelled_by`).
- **Verification status:** VERIFIED AT RELEASE — 790/790 automated checks (711 baseline + regression 283→368 + UI 140→153); fresh Docker; restart persistence; in-place upgrade from a simulated v1.1.1 database.
- **Important fixes:** cancellation was previously unreachable (no writers of `isCancelled`) — users had only hard-delete; the payroll hard-delete latent defect was closed in the same release.
- **Immutable status:** 🔒 IMMUTABLE.

---

## v1.1.1

- **Commit:** `2fcf50635b48180ca1108ef07954930e29238904`
- **Tag:** `v1.1.1` (annotated)
- **Major purpose:** GSTR-1 HSN reporting integrity (R-01) — population rule = `voucherTypes.name = "Sales"` (outward supply semantics, not inventory-quantity direction); purchases/receipt notes/delivery notes/stock journals no longer pollute HSN Table 12; HSN code/rate resolution snapshot → item-master → "-"; positive outward quantity enforced; ₹91,111 canary regression added.
- **Verification status:** VERIFIED AT RELEASE — 711/711 automated checks (final regression 224→283, UI 129→140 incl. cell-by-cell HSN reconciliation against the independent engine).
- **Important fixes:** HSN Table 12 reported wrong populations and NULL HSN/rate for UI-created vouchers.
- **Immutable status:** 🔒 IMMUTABLE.

---

## v1.1.0

- **Commit:** `fb73244d9b23223c94fc74612eb94ab5ed956b79`
- **Tag:** `v1.1.0` (annotated)
- **Major purpose:** feature/fix release (details recorded in `CHANGELOG.md`).
- **Verification status:** VERIFIED AT RELEASE — 622 checks green at release time.
- **Important fixes:** see `CHANGELOG.md` (historical record).
- **Immutable status:** 🔒 IMMUTABLE.

---

## v1.0.0

- **Commit:** `71e14fd3c8955975b580ee470b2fcb575ade5518`
- **Tag:** `v1.0.0` (annotated)
- **Major purpose:** initial production release — full accounting core (double-entry vouchers, numbering, masters, reports), inventory with WAVG/FIFO, GST reports, payroll/TDS, XML import, keyboard-first UI, Docker deployment.
- **Verification status:** VERIFIED AT RELEASE — 483 checks green at release time.
- **Important fixes:** n/a (initial).
- **Immutable status:** 🔒 IMMUTABLE.

---

## Ledger rules

1. A new release is **appended** at the top; nothing above it is ever edited.
2. A release requires the full `RELEASE_REVIEW` gate (`DEVELOPMENT_PROTOCOL.md`) — passing tests alone is not sufficient.
3. Every release = one release commit + one annotated tag, verified `tag^{}` == HEAD, clean tree, all prior tags unchanged.
4. Commit-message convention: `Release vX.Y.Z: <purpose>`; tag message: `zprime vX.Y.Z — <purpose>`.
