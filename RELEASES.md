# RELEASES.md — Immutable Release Ledger

The authoritative release history of zprime. **Every entry below is immutable.** Never rewrite history, never modify a released commit, never move or re-point a tag. The next release is appended below the last entry.

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
