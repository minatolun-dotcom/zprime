# ROADMAP.md — Where zprime Is Going

The permanent development roadmap. Current at v1.3.0.

## Released history (immutable — see RELEASES.md for the full ledger)

| Release | R-item | Purpose |
|---|---|---|
| v1.0.0 | — | Initial production release |
| v1.1.0 | — | Feature/fix release |
| v1.1.1 | **R-01** | GSTR-1 HSN reporting integrity (purchases/receipt notes no longer pollute HSN Table 12; sales inventory lines reported; HSN/rate snapshot resolution) |
| v1.2.0 | **R-02** | Voucher cancellation (Model A mark + exclude; cancel/uncancel; settled-bill + payroll guards; Day Book/VoucherScreen UI) |
| v1.3.0 | **R-03** | Company authorization and memberships (`user_companies` junction, centralized `cid()` membership authorization, immediate revocation, 404 no-leak semantics, owner-only member management) |
| v1.4.0 | **R-04** | XML import integrity (B-03 + B-05 + B-13 + B-14: single-transaction import, API-equivalent double-entry/bill validation, per-voucher error attribution, imported-ledger taxability classification, client multipart fix) |

## Current phase: IDLE — next item pending investigation

**R-04 is RELEASED as v1.4.0** (investigated → reviewed → approved → implemented → verified → browser-verified → release-reviewed → released). Per protocol, the next R-item requires its own investigation → review → approval cycle before any implementation.

Highest-value remaining candidates (from `ZLEDGER_PRODUCTION_ACTION_PLAN.md`, still NOT tasks): B-06 (credit/debit-note GSTR-1 sign, live-reproduced 99/99 vs 81/81), B-01 (negative stock acceptance), B-02 (opening-balance accounting model).

## Upcoming candidates (derived from ZLEDGER_PRODUCTION_ACTION_PLAN.md — NOT yet tasks)

These are prioritized investigation candidates only. **No future R-item becomes an implementation task without its own investigation → review → approval cycle.**

| Order | Candidate | Source | Class | Notes |
|---|---|---|---|---|
| R-04 | Import integrity (B-03 P0 + B-05 P1 + B-13 P2) | action plan, investigated | bug | investigation complete; pending approval |
| R-05 | Credit/Debit Note GST sign + CDNR/CDNUR (B-06 P1) | action plan, live-reproduced | bug | CN currently increases output tax in GSTR-1 |
| R-06 | Negative-stock guard (B-01 P0) | action plan, reproduced | bug | valuation/COGS distortion propagates |
| R-07 | Opening-stock accounting model (B-02 P0) | action plan, reproduced | bug | opening stock breaks A = L + C without an opening journal |
| later | Cross-company master-reference validation (B-07 P1) | action plan | bug | master CRUD gap; voucher path already validates |
| later | Deployment secrets hardening (B-08 P1*) | action plan | bug/ops | fail-fast on default JWT_SECRET for exposed deployments |
| later | Duplicate-submission protection (B-10 P2) | action plan | bug | idempotency |
| later | Purchase-return/DN test coverage (B-11 P2) | action plan | tests | coverage gap, not a demonstrated defect |
| later | Backup/restore UX (B-12 P2) | action plan | ops | pg_dump guidance exists in README; product surface absent |

Non-bug hardening candidates (from R-04 investigation, §13/§14): graduate the audit's INV probes into permanent regression blocks; import pre-validation feedback in the UI; negative-stock warning in VoucherScreen.

## Explicitly out of scope (do not schedule)

RCM, TCS, e-invoice, e-way bill, GSTR-9, batch/serial, BOM/production orders, compound units, multi-currency, full audit trail, period locking, SSO/2FA, invitations/email workflows, organization/workspace abstraction, subscription billing, FIFO promotion (WAVG stays canonical).

## Process reminder

Every item above requires: **INVESTIGATE → REVIEW → APPROVE → IMPLEMENT → VERIFY → BROWSER VERIFY → REGRESSION → RELEASE → UPDATE STATE** (`DEVELOPMENT_PROTOCOL.md`). Releases become immutable (`RELEASES.md`). Accounting mathematics are never changed by security/UX work.
