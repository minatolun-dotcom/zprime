# READINESS_REVIEW.md — zprime v1.15.0 · Formal Production-Readiness Review

**Date:** 2026-09-17
**Reviewed baseline:** tag `v1.15.0`, HEAD `48cb0acadf30595764dc4d714c27381416498e95` — verified identical at review time; working tree clean (only the intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md`).
**Review type:** independent fresh-evidence verification, not a rehash of release claims. No code, test, migration, or doc file was modified.

---

## 1. Verdict

**RELEASE CANDIDATE — production-ready for its designed deployment model.**

zprime is ready for real accounting work in its intended model: a self-hosted, keyboard-first Indian accounting application for a single operator or small trusted team (LAN or VPN/behind-reverse-proxy deployment). Since v1.9.0 makes internet exposure a *supported* configuration, that path is also assessed: it is acceptable with the documented hardening (unique strong secrets — enforced at boot; HTTPS/reverse proxy — documented; login throttling + timing-equalization — shipped in v1.13.0).

It is **not** a multi-tenant SaaS and must not be marketed or deployed as one: the authorization model is user↔company membership, not global tenant isolation; there is no audit trail; there are no invitations/2FA/SSO (all explicitly postponed with product-owner sign-off).

## 2. Fresh-Evidence Verification (run during this review, on this exact tree)

| Gate | Result |
|---|---|
| Fresh-install compose (fresh volume, rebuilt image) | App healthy; **6/6 migrations applied; 22 tables** created from zero |
| Browser battery (7 suites, real Chromium, fresh stack) | **219/219** — baseline 153 + R-03 12 + R-04 9 + R-05 12 + R-07 12 + R-10 10 + R-14 11 |
| Python battery (6 suites, disposable DB, self-hosted servers) | **868/868** — smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression 586 (incl. R-06…R-15 blocks), attack-the-fixes 29 |
| Independent accounting reconciliation | green (reconcile.py 61/61 — hand-computed expectations incl. bill-wise DN, GSTR-3B ITC, full-period GST identity) |
| Typecheck | server + client clean |
| `git diff --check` | clean |
| Post-suite DB sanity | 9 companies / 37 vouchers as expected from the suites; VACUUM ANALYZE clean |

## 3. Finding of This Review — F-R1 (new, P3, deployment-hardening)

**First-boot race on a fresh volume can leave the app container dead until manual restart.**

- **Reproduced live this review:** `docker compose down -v && up` on a fresh volume → db healthcheck (`pg_isready`, interval 3s) passed transiently during `initdb`; `app` started under `depends_on: service_healthy`, its migration connection hit `ECONNREFUSED 172.31.0.2:5432`, and the container **exited and stayed exited** (no restart policy). A manual `docker compose up -d` recovered it; migrations then applied cleanly (6/6) and the full battery passed. The v1.10.0 fresh-install run happened to win this race — the defect was always there.
- **Impact:** every *genuinely fresh* deployment (the documented first-run path) has a probability of failing on first boot with no self-recovery. Not a data-integrity or security issue; data-wise the app is idempotent (migrations are journaled; second boot applies cleanly). It is a first-impression reliability defect for the exact audience (self-hosters) zprime targets.
- **Fix (small, well-bounded, for R-16):** add `restart: unless-stopped` to the `app` service (and optionally a retry/backoff wrapper or a stricter db healthcheck such as `pg_isready -d zprime` inside a `postgres:16-alpine` image that reports ready only after init completes). One-line-class compose change + docs note; no application code, no migration, no accounting surface.
- **Severity: P3** — reliability/deployment only; recoverable with one command; no data risk.

Everything else verified in this review passed with no new findings.

## 4. Subsystem Matrix (finding → closing release → fresh evidence this review)

| Area | Status | Closed in | Fresh evidence |
|---|---|---|---|
| Import integrity (B-03/B-04/B-05) | COMPLETE | v1.4.0 (R-04) | R-04 UI 9/9; per-voucher 400 with atomic rollback re-verified in R-14 investigation |
| Negative stock (B-01) | COMPLETE | v1.6.0 (R-06) | R-06 regression blocks inside final_regression 586 |
| Opening balances / BS identity (B-02) | COMPLETE | v1.7.0 (R-07) + R-14 surface | reconcile 61; BS banner + Gateway card live in browser battery |
| CN/DN GST (B-06) | COMPLETE | v1.5.0 (R-05) | R-05 UI 12/12; reconcile GST identity |
| Master-reference isolation (B-07) | COMPLETE | v1.8.0 (R-08) | adversarial 88 |
| Deployment secrets (B-08) | COMPLETE | v1.9.0 (R-09) | fresh boot required explicit env (fail-fast verified in final_regression R-09 block) |
| Duplicate submissions (B-10) | COMPLETE | v1.10.0 (R-10) | R-10 UI 10/10 (double-Ctrl+A → one voucher); 12 regression checks |
| Supplier-side settlements (B-11) | COMPLETE | v1.11.0 (R-11) | reconcile 61 (bill-wise DN-2); 21 regression checks |
| Backup/restore (B-12) | COMPLETE | v1.12.0 (R-12) | 6 round-trip checks incl. ON_ERROR_STOP drift guard |
| Login hardening (F-13-1/2) | COMPLETE | v1.13.0 (R-13) | 14 regression checks (threshold, no-bypass, timing oracle collapsed) |
| TB health surface (F-14-1) | COMPLETE | v1.14.0 (R-14) | R-14 UI 11/11 |
| Opening-GST semantics | VERIFIED-NOT-A-BUG, locked | v1.15.0 (R-15) | 8 regression checks |
| Double-entry / TB / BS / P&L | WORKING | — | reconcile 61/61 + every suite's balance assertions |
| Bill-wise outstanding (AR/AP) | WORKING | R-02/R-05/R-11 | adversarial + reconcile + 21 R-11 checks |
| Payroll / TDS | WORKING (basic) | R-02 guards | fix_regression 65 + regression blocks |
| Company authorization (R-03) | WORKING | v1.3.0 | R-03 UI 12/12; adversarial cross-company 404s |
| XML import | WORKING (validated-only) | v1.4.0 | R-04 UI |
| Audit trail | POSTPONED (by product decision) | — | — |
| RCM / e-invoice / e-way / GSTR-9 / TCS / BOM | POSTPONED | — | — |

## 5. Deployment Posture (as-built)

- **Supported:** single app container + Postgres 16 via compose; LAN/VPN or reverse-proxy deployment; internet-exposed with documented hardening (README: secrets fail-fast, login throttling, HTTPS guidance).
- **Required operator behavior:** `.env` with strong `JWT_SECRET`/`ADMIN_PASSWORD` (boot refuses otherwise); backup via the R-12 runbook (regression-guarded `pg_dump` path); upgrades via journaled migrations (additive-only history; fresh vs upgrade equivalence verified across releases).
- **Known limitations (documented, accepted):** single-process in-memory limiter/health state; fixed 7-day JWT; no audit trail; single-tenant authorization semantics; GST reports are management summaries, not e-filing JSON.

## 6. Recommendation

1. **Adopt "RELEASE CANDIDATE" as the product status** in STATE.md/ROADMAP.md (supersedes the action plan's ALPHA verdict, which predated R-04…R-15).
2. **R-16 = F-R1 fix** (`restart: unless-stopped` + docs) — small, deployment-only, closes the one new finding.
3. Optional future scope remains postponed by design: audit trail, RCM/e-invoice/e-way/GSTR-9/TCS, multi-tenant ambitions (rejected).

No code changes were made in this review. The only artifact created is this file.

**READINESS REVIEW COMPLETE — verdict: RELEASE CANDIDATE (with F-R1 noted for R-16)**
