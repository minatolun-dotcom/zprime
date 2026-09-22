# R-41 Review — zprime v1.39.0 · Whole-Product Readiness Re-Review

**Status:** investigation complete — implementation NOT started (per protocol; no code, test, migration, or doc file modified).
**Verdict:** `RELEASE CANDIDATE AFFIRMED AND UPGRADED — PRODUCTION READY (for the designed deployment model). ZERO OPEN FINDINGS.`
**Baseline:** HEAD `898b0eb` (ledger commit on release `0443d1c` = tag `v1.39.0`, pushed, 41 tags); tree clean except this report and the intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md`.

---

## 1. Scope and Method

The last formal readiness review (READINESS_REVIEW.md) certified **v1.15.0** as RELEASE CANDIDATE with one finding (F-R1, first-boot race). Since then: **29 release commits, +42,740 lines** across 25 releases (v1.16.0 → v1.39.0) — deployment self-healing, voucher provance, audit trail, GSTR-9, RCM, TCS, IRP/EWB connectivity, per-payee TDS, the keyboard-first arc, backup/restore close-out. This re-review re-certifies the whole product with **fresh evidence only** — every gate re-run on the v1.39.0 tree during this review.

## 2. Fresh-Evidence Verification (run during this review)

| Gate | Result |
|---|---|
| Python battery (6 suites) | **1229/1229** — smoke 39 · adversarial 88 · bug-fix 65 · reconciliation 61 · final regression **947** · attack-the-fixes 29 |
| Independent accounting reconciliation | **61/61** (hand-computed expectations, engine independent of production code) |
| Browser battery (rebuilt image + fresh volume) | **494/494** — run.js 153 + r03…r38 scenario suites 341, zero failures |
| Fresh install (fresh volume, rebuilt image) | App healthy; **16/16 migrations applied; 27 public tables** created from zero (vs 6/22 at v1.15.0) |
| Fail-fast secrets | ADMIN_PASSWORD seed refusal + JWT_SECRET/IRP_ENC_KEY boot enforcement verified in source (R-09/R-28 posture intact) |
| Typecheck | server + client clean |
| `git diff --check` | clean |

## 3. Security Posture (regression-level sweep, R-03 baseline)

- **Route→authorization mapping (per file):** reports 28/28, vouchers 10/10, crud 5/5, masters 3/3, payroll 3/3, banking 1/1, import 1/1 cid()-gated; companies.ts has 4 company-level routes (list/create/detail/update) with dedicated R-03 membership logic + owner-only `requireOwner` for membership management; auth.ts's 3 routes have no company surfaces by design.
- **No identity trust from clients:** zero hits for `req.body.companyId` / `req.query.companyId` / `body.userId` across the server.
- **No bypass via services:** all 19 direct `from(companies)` reads outside routes/companies.ts are `eq(companies.id, <authorized cid>)` scoping inside cid-gated flows.
- **IRP credential storage:** AES-256-GCM with per-encryption random IV, fail-fast boot when encrypted rows exist and IRP_ENC_KEY is missing/invalid; masked read-back in routes.
- Adversarial (88) + attack-the-fixes (29) suites re-verified cross-company 404s, IDOR, injection, XSS/CSV/XML protections green.

## 4. Accounting Integrity

- Reconciliation engine remains independent (no imports of production accounting logic) and grew to 61 hand-computed expectations spanning sales/purchase/receipts/payments/contra/journal, credit/debit notes, bill-wise allocations (both sides), full-period GST identity, GSTR-3B ITC, stock valuation.
- Every postings-affecting release since v1.15 has kept TB/BS/P&L/stock/GST assertions green — including this review's full battery. No accounting regression exists or is suspected.

## 5. Database / Migration Safety

- **16 additive-only migration files** — no `DROP`/`TRUNCATE`/`DELETE FROM` anywhere; journal matches 16/16 on a fresh install.
- Backup/restore path is content-guarded (R-39): 11 postings-bearing tables hash-compared row-for-row live vs restored + schema fingerprint (pg_dump-16 `\restrict` normalization).
- Fresh-install vs upgrade equivalence maintained by the R-12 guard in every battery.

## 6. Documentation / Ledger Consistency

- Tags ↔ RELEASES.md ↔ ROADMAP.md ↔ STATE.md coherent at v1.39.0 (41 tags; spot-verified v1.37.0/v1.38.0/v1.39.0 SHAs).
- ROADMAP candidates region formally dispositioned (R-40); STATE.md verdict line still cites the v1.16 READINESS_REVIEW — this review supersedes it.
- ONBOARDING_IRP_EWB.md, README (backup runbook + scheduling/drill), PROJECT.md all current as of their respective releases.

## 7. What Changed the Verdict (RELEASE CANDIDATE → PRODUCTION READY)

1. **The one open finding closed:** F-R1 (first-boot race) fixed in R-16 (`restart: unless-stopped` verified present in compose) — no findings have been open since.
2. **Verification estate more than doubled:** 868 → 1229 automated + 219 → 494 browser checks, all green on this tree, with new coverage (audit trail, RCM, GSTR-9, TCS, IRP/EWB mock wire tests, TDS per-payee, keyboard flows, backup content equality).
3. **All candidate lists dispositioned** — no known P1/P2 defect, no uncovered action-plan item, no stale documentation claiming otherwise.
4. **Operations hardened:** self-healing deployment, scheduled-backup + restore-drill runbook, credential encryption with fail-fast key management, provance/audit trail on vouchers.

## 8. Known Limitations (documented, accepted — unchanged)

- Single-tenant authorization semantics (user↔company membership), **not** a multi-tenant SaaS — must not be deployed/marketed as one.
- Single-process in-memory limiter/health state; fixed 7-day JWT; no 2FA/SSO/invitations (postponed by product decision).
- GST reports are management summaries, not e-filing JSON (IRP/EWB connectivity is opt-in and credential-gated).
- Audit trail covers vouchers (per-voucher lifecycle, delete-surviving); company-wide timeline/masters events remain postponed.

## 9. Recommendation

1. **Adopt PRODUCTION READY as the product status** in STATE.md (supersedes the v1.16 RELEASE CANDIDATE line; this review is the evidence).
2. No engineering work is required before production use in the designed model. Next R-items should come from real operator feedback (IRP/EWB production onboarding, day-to-day entry flows) or a named fresh investigation.
3. Keep the standing discipline: every future release runs the full battery; releases remain immutable.

**R-41 REVIEW COMPLETE — verdict: PRODUCTION READY (designed model), zero open findings.**
