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
| v1.6.0 | **R-06** | Negative-stock availability guard (B-01: Model 1 reject-oversell with `allowNegativeStock` opt-out; chain-comparison chronological guard across create/edit/cancel/uncancel/delete/import; honest negative-stock valuation) |
| v1.7.0 | **R-07** | Opening balances in reports (B-02: party openings surface in AR/AP as a display-only "Opening Balance" bill; BS zeroing structural across Stock-in-Hand sub-groups; F-07-2 documented per Model A) |
| v1.8.0 | **R-08** | Cross-company master-reference validation (B-07: central `assertCompanyRefs` at the CRUD boundary for ledgers/items/pay-heads; salary-structure headId check; payroll belt-and-braces — legacy foreign-ledger row fails loudly at posting; route-level, no migration) |
| v1.9.0 | **R-09** ⚠ | Fail-fast deployment secrets (B-08: JWT_SECRET required + insecure-value denylist at boot, ADMIN_PASSWORD required at first-boot seeding, compose `:?` interpolation — BREAKING: default-secret deployments refuse to boot) |
| v1.10.0 | **R-10** | Voucher submission idempotency (B-10: `idempotency_keys` migration 0005, optional client key on `POST /vouchers` with replay-returns-original, same-transaction key record, unique-index concurrency authority; client UUID per new voucher form + `savingRef` Ctrl+A guard) |
| v1.11.0 | **R-11** | Purchase-side settlement regression coverage (B-11, test-only: creditor-side adversarial mirror of BUG-002 + bill-wise DN settling a purchase bill + advance-consumption + AP/GSTR-3B assertions → 834 checks; no source changes) |
| v1.12.0 | **R-12** | Backup/restore runbook and round-trip guard (B-12, docs/test-only: README verified restore sequence with the stop-app → drop/recreate prerequisite, +6 pg_dump→restore→verify round-trip checks → 840 checks; no source changes) |
| v1.13.0 | **R-13** | Login hardening (F-13-1 rate limiting: in-memory loginGuard, 10 failures/10 min per IP+username → 429 + Retry-After, success resets; F-13-2 dummy-scrypt timing equalization collapsing the 20.7× username-enumeration oracle; +14 checks → 854; server-only) |
| v1.14.0 | **R-14** | TB health surface (F-14-1: additive `difference` field on trialBalance, TB report out-of-balance banner, Gateway Books Health card; negative-stock warning + import error surfacing verified NOT A BUG — superseded by R-06/R-04; +6 Python +11 browser checks → 860/219) |
| v1.15.0 | **R-15** | Opening-GST semantics regression lock (test-only: opening-GST candidate verified NOT A BUG — returns period-only, ledger carries position, unpaired openings surface honestly; +8 checks → 868) |
| v1.16.0 | **R-16** | Deployment self-healing (F-R1: `restart: unless-stopped` on app+db, README note; compose-only) + **RELEASE CANDIDATE** status adopted per READINESS_REVIEW.md |
| v1.17.0 | **R-17** | Voucher actor provance — audit groundwork (migration 0006: created_by/updated_by/updated_at, no fabricated backfill; stamping at manual/import/edit write sites from verified JWT identity; masters deferred; +7 checks → 875) |
| v1.18.0 | **R-18** | Full audit feature (migration 0007: append-only `audit_events`, same-tx capture at all 7 voucher write sites, delete-event outlives voucher via SET NULL + snapshot, no backfill; F-R18-1 payroll created_by gap closed; cid-gated audit endpoint + VoucherScreen history strip; +18+11 checks → 893/228) |
| v1.19.0 | **R-20** | Company audit timeline (cid-gated read-only `GET /audit`, id-DESC chronology, limit/action/before-cursor params; AuditTrail page + Gateway card; deleted vouchers unlinked with snapshot; no migration; +8+12 checks → 901/240; R-19 between: B-12 re-verified ALREADY CLOSED, ROADMAP row retired) |
| v1.20.0 | **R-21** | Pre-validation UX (VoucherScreen negative-stock advisory from stock-summary closingQty + flow-sign deltas, suppressed on allowNegativeStock — now returned by companies list/detail; import dry-run `?dryRun=1` = identical tx path + full rollback + stats; Validate button + nothing-imported banner; guards untouched; +10+13 checks → 911/253) |
| v1.21.0 | **R-22** | Master-table actor provance (migration 0008: created_by/updated_by/updated_at on 9 master tables, no backfill — seeded rows honestly NULL, voucher_types/tds_sections excluded as system-seeded; ONE crud() change covers all 11 registrations with client actor fields stripped; import's 5 ensure* inserts stamp the importing actor; +20 checks → 931/255) |
| v1.22.0 | **R-23** | Reverse charge mechanism (migration 0009: `vouchers.is_rcm` per-transaction flag + RCM Payable duty-ledger seed for existing companies; voucherGst classification; GSTR-3B Table 4(A)(3) inwardRcm/rcmItc with regular-ITC exclusion; Alt+R voucher toggle, Day Book badge, 3B view rows, duty-head option; +33+14 checks → 964/267) |
| v1.23.0 | **R-24** | E-invoice payload generation (migration 0010: `ledgers.party_pincode`; NIC v1.01 B2B payload builder re-projecting voucherGst + line snapshots with strict all-at-once validation + UQC mapping; cid-gated `GET /reports/einvoice/:voucherId`; GSTR-1 e-inv download actions + validation banner; +27+16 checks → 991/285) |
| v1.24.0 | **R-25** | E-way bill payload generation (stateless EWB-01: shared supplyLines projection extracted from einvoice.ts; Part-A from voucherGst + line snapshots with strict validation, HSN-depth enforcement, sub-₹50k advisory; Part-B as optional request params, no persisted transport state; cid-gated `GET /reports/ewaybill/:voucherId`; GSTR-1 e-way actions; no migration; +28+13 checks → 1005/298) |
| v1.26.0 | **R-27** | TCS collection (Income-tax s. 206C) — collection-side mirror of the TDS machinery: migration 0011 (additive `tcs_sections` + `tcs_section_id` snapshots + idempotent "TCS Payable" seed), masters CRUD, voucher validation, cid-gated `GET /reports/tcs` (A-04 collected − remitted = payable), "− Collect TCS" client helper (gross-based, one-click balancing), gst.ts/import.ts TCS exclusions with dedicated GST-neutrality proof; thresholds surfaced, never enforced; +23+15 checks → 1060/325 |
| v1.25.0 | **R-26** | GSTR-9 annual return (`services/gstr9.ts` over one FY window: tables 4/5/6-7/8/9/12 — Table 8 duty-ledger ITC reconciliation, Table-9-vs-3B consistency cross-check, honest limitation tables; cid-gated `GET /reports/gstr9`, Gstr9View + Gateway entry; no migration; +26+12 checks → 1019/310; release-process amendment: push step added to RELEASED protocol) |
| v1.22.0 | **R-23** | Reverse charge mechanism (RCM — approved product decision, previously listed out of scope): migration 0009 `vouchers.is_rcm` per-transaction flag; dutyHead RCM + seeded RCM Payable starter ledger (TDS report pattern); GSTR-3B Table 4(A)(3) inwardRcm + rcmItc additive sections with regular-ITC exclusion and net-cash-nil reconciliation; Alt+R voucher toggle + Day Book badge + 3B view rows; no posting-engine change; +33+14 checks → 964/267 |
| v1.5.0 | **R-05** | Credit/debit-note GST reporting (B-06: signed aggregation, CDNR/CDNUR Table 9B, net totals reconciling with ledgers) + Apply-GST party balance (sign-correct duty base/side, party-row rebalance) |

## Current phase: IDLE — next item pending investigation

**R-11 is RELEASED as v1.11.0** (investigated → reviewed → approved [test-only] → implemented → verified → release-reviewed → released; no browser deltas required — zero client changes). Per protocol, the next R-item requires its own investigation → review → approval cycle before any implementation.

Highest-value remaining candidates (from `ZLEDGER_PRODUCTION_ACTION_PLAN.md`, still NOT tasks): B-12 (backup/restore UX), plus non-bug hardening (VoucherScreen negative-stock warning, import pre-validation feedback).

## Upcoming candidates (derived from ZLEDGER_PRODUCTION_ACTION_PLAN.md — NOT yet tasks)

These are prioritized investigation candidates only. **No future R-item becomes an implementation task without its own investigation → review → approval cycle.**

| Order | Candidate | Source | Class | Notes |
|---|---|---|---|---|
| R-07 ✅ DONE (v1.7.0) | Opening balances in reports (B-02, re-graded P1+P2) | action plan, reproduced | bug | F-07-1 AR/AP openings + F-07-3 BS sub-group scope fixed; F-07-2 documented (Model A) |
| R-08 ✅ DONE (v1.8.0) | Cross-company master-reference validation (B-07 P1) | action plan, reproduced | bug | central CRUD ref validation + payroll belt-and-braces; composite-FK DB enforcement deferred |
| R-09 ✅ DONE (v1.9.0) | Fail-fast deployment secrets (B-08 P1) | action plan, source-traced | bug | breaking change accepted; login rate limiting (P3) remains postponed |
| R-10 ✅ DONE (v1.10.0) | Duplicate-submission protection (B-10 P2) | action plan, live-reproduced | bug | idempotency key + client single-shot guard; keyless behavior unchanged |
| R-11 ✅ DONE (v1.11.0) | Purchase-side settlement coverage (B-11 P3) | action plan, live-probed | tests | test-only: +24 checks; no defect found (F-11-1/2/3 NOT A BUG — VERIFIED) |
| later | Deployment secrets hardening (B-08 P1*) | action plan | bug/ops | fail-fast on default JWT_SECRET for exposed deployments |
| later | Duplicate-submission protection (B-10 P2) | action plan | bug | idempotency |
| later | Purchase-return/DN test coverage (B-11 P2) | action plan | tests | coverage gap, not a demonstrated defect |
| B-12 ✅ DONE (v1.12.0) | Backup/restore (B-12, closed as P4 ops — R-19 re-verified live on v1.18.0 incl. 0007 schema) | action plan | ops | Verified runbook in README + 6-check drift guard in final_regression (R-12); in-product surface declined (F-12-3, documented security rationale: full-DB dump needs a global-admin tier zprime deliberately lacks) |

Non-bug hardening candidates (from R-04 investigation, §13/§14): graduate the audit's INV probes into permanent regression blocks; import pre-validation feedback in the UI; negative-stock warning in VoucherScreen.

Full audit trail **✅ DONE (v1.18.0)** — the "full audit trail" entry above is hereby retired: R-17+R-18 delivered per-voucher lifecycle history (who/what/when, delete-surviving). Still out of scope: company-wide timeline page, masters events, retention/export.

## Explicitly out of scope (do not schedule)

RCM ✅ DONE (v1.22.0 — approved product decision, row retired), TCS, e-invoice, e-way bill, GSTR-9, batch/serial, BOM/production orders, compound units, multi-currency, period locking, SSO/2FA, invitations/email workflows, organization/workspace abstraction, subscription billing, FIFO promotion (WAVG stays canonical).

## Process reminder

Every item above requires: **INVESTIGATE → REVIEW → APPROVE → IMPLEMENT → VERIFY → BROWSER VERIFY → REGRESSION → RELEASE → UPDATE STATE** (`DEVELOPMENT_PROTOCOL.md`). Releases become immutable (`RELEASES.md`). Accounting mathematics are never changed by security/UX work.
