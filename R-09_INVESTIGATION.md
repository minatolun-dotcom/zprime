# R-09 Investigation — zprime v1.8.0 · B-08 Deployment Secrets

**Status:** investigation complete — implementation NOT started (per protocol).
**Verdict:** `R-09 CONFIRMED — INVESTIGATION REQUIRED` (P1, deploy-dependent; confirmed by source trace; no live exploit needed — the insecure defaults are plainly bootable).
**Baseline:** HEAD `e84eed28891741a18265207f41ba37b1ff0ae24e` = tag `v1.8.0`; working tree clean except this report and the intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md`. No repository file modified.

---

## 1. Executive Summary

The action plan's B-08 claim — "default `JWT_SECRET`/`ADMIN_PASSWORD` in compose; deployment must fail-fast" — is **CONFIRMED, and the in-code fallbacks make it slightly worse than described**. The application boots with well-known secrets through **three independent fallback layers**:

| Layer | Location | Insecure fallback |
|---|---|---|
| Compose interpolation | `docker-compose.yml:20-22` | `JWT_SECRET: ${JWT_SECRET:-change-me-in-production}`, `ADMIN_PASSWORD: ${ADMIN_PASSWORD:-admin123}` |
| Server process | `server/src/plugins/auth.ts:27` | `secret: process.env.JWT_SECRET ?? "dev-secret"` — the server **never** refuses to boot |
| Admin seeding | `server/src/index.ts:103` | `ADMIN_PASSWORD ?? "admin123"` (only when the users table is empty) |

**Why the JWT default is the dangerous one:** the token payload is `{uid, username}` with no server-side session state (R-03 model: per-request membership checks, stateless identity). Anyone who knows `JWT_SECRET` can forge `{uid: 1, username: "admin"}` and receive **full authentication bypass** — every company the seeded user is a member of, all accounting data, everything R-03 protects. `change-me-in-production` is public in the repository. `ADMIN_PASSWORD` matters only at first boot (seeding), so it is the lesser exposure; `POSTGRES_PASSWORD` (`zprime`) is lowest — the `db` service publishes no ports and is reachable only inside the compose network.

This is a **P1 that depends on deployment posture**: a localhost-only single-user deployment is not practically exploitable; a deployment exposed beyond localhost with defaults is trivially compromised. The plan grades it exactly this way ("P1 (deploy-dependent)") and requires fail-fast on boot. The README currently covers it with advisory text only ("Change JWT_SECRET and ADMIN_PASSWORD before exposing beyond localhost") — documentation, not enforcement.

## 2. Baseline Integrity

- `git rev-parse HEAD` → `e84eed28891741a18265207f41ba37b1ff0ae24e` = `v1.8.0` ✓; `git describe --tags` → `v1.8.0` ✓; working tree clean except the intentional untracked action plan. No repository file modified by this investigation.

## 3. Action-Plan Claim Re-Verification

| Claim (action plan) | v1.8.0 reality | Disposition |
|---|---|---|
| "Default JWT_SECRET / ADMIN_PASSWORD in compose" | Confirmed — compose interpolates insecure fallbacks when no `.env` is present | **CONFIRMED** |
| "Required env with no default; fail-fast on boot" | Not implemented: the in-process `?? "dev-secret"` fallback (auth.ts:27) means even an empty env boots happily | **CONFIRMED GAP** |
| "bcrypt-free scrypt login is fine" | Confirmed — scrypt with per-password random salt, timing-safe compare (auth.ts:8-21) | NOT A BUG — VERIFIED |
| "session expiry 7d fixed, no refresh — acceptable single-user" | Confirmed unchanged; out of R-09 scope per plan | POSTPONED |
| "rate limiting absent on login (P3, single-tenant)" | Confirmed absent | POSTPONED (P3) |
| Severity P1 (deploy-dependent) | Holds — forgery = full auth bypass on exposed deployments | P1, posture-dependent |

## 4. Consumers and Blast Radius (as-built)

**Who reads these variables:**
- `JWT_SECRET` → only `server/src/plugins/auth.ts:27` (JWT signing/verification).
- `ADMIN_USER`/`ADMIN_PASSWORD` → only `server/src/index.ts:100-106` (first-boot seeding when `users` is empty).
- `POSTGRES_PASSWORD` → only compose interpolation into `DATABASE_URL`.

**Who depends on the fallbacks today (the change surface):**
- All six Python suites spawn the server with only `DATABASE_URL` + `PORT` set (`smoke_test.py:33`, `attack_test.py:40`, `fix_regression.py:49`, `attack2.py:40`, `reconcile.py` equivalent, `final_regression.py:47`) and log in `admin/admin123` → they rely on the in-process fallbacks.
- The browser verification stack (`docker compose -p zprime up`) runs with no `.env` → relies on compose fallbacks; `driver.js` logs in `admin/admin123`.
- README quickstart (`cp .env.example .env  # optional`) marks the `.env` as optional — consistent with the fallbacks, wrong for fail-fast.

## 5. Proposed R-09 Scope (for approval — NOT implemented)

**R-09 title:** *Fail-fast deployment secrets (B-08).*

1. **`auth.ts`:** refuse to boot when `JWT_SECRET` is missing, empty, or one of the known-insecure values (`dev-secret`, `change-me-in-production`) — throw at plugin registration with a message pointing at `.env.example`. **Always enforced** (no NODE_ENV escape hatch): an explicit test/dev secret is one line in each suite, and "insecure unless configured" is exactly the property being fixed.
2. **`index.ts` seeding:** when the `users` table is empty, `ADMIN_PASSWORD` must be set — else fail-fast with the same guidance. When users exist, the variable is irrelevant (no forced-rotation machinery in scope).
3. **`docker-compose.yml`:** switch to required-interpolation with a clear error: `JWT_SECRET: ${JWT_SECRET:?Set JWT_SECRET in .env (cp .env.example .env)}` and likewise `ADMIN_PASSWORD`; `POSTGRES_PASSWORD` keeps its default (db publishes no ports; documented residual risk, out of scope). Note: `:?` fails any compose command that interpolates the file (including `down`) until `.env` exists — accepted, standard behavior, documented.
4. **Test rig (mechanical):** each Python suite's env dict gains `JWT_SECRET` + `ADMIN_PASSWORD` (explicit test fixtures; login payload reads `ADMIN_PASSWORD` from its env or keeps `admin123` as the explicitly-set fixture value); verification flow creates `.env` before browser compose runs (documented in CONTINUE.md).
5. **Tests:** new checks — server spawn with missing/insecure `JWT_SECRET` exits with the guidance message; spawn with proper env boots; seeding without `ADMIN_PASSWORD` on an empty users table fails; existing suites all green with explicit fixtures. No accounting surface touched; no client change; no migration.
6. **README:** `.env` stops being optional; one-paragraph setup (cp, edit JWT_SECRET/ADMIN_PASSWORD); release-notes headline: **breaking for deployments relying on defaults — set env before upgrading.**

**Out of scope:** token refresh/expiry redesign, login rate limiting, POSTGRES_PASSWORD default removal, secret rotation workflows, .env encryption.

## 6. Findings Table

| ID | Area | Finding | Severity | Disposition |
|---|---|---|---|---|
| F-09-1 | Deployment security | Three-layer insecure-secret fallbacks; server never fails fast; forgeable JWT = full auth bypass on exposed deployments | **P1 (deploy-dependent)** | CONFIRMED → R-09 core |
| F-09-2 | Test rig | Six suites + browser stack depend on the fallbacks; must migrate to explicit fixtures | P2 (change surface) | Addressed in scope |
| F-09-3 | Docs | README advisory-only; `.env` marked optional | P3 | Addressed in scope |
| F-09-4 | Auth internals | scrypt+salt+timing-safe verify correct; JWT `{uid,username}` + per-request membership sound | — | NOT A BUG — VERIFIED |
| F-09-5 | Posture | POSTGRES_PASSWORD default `zprime` (db not network-exposed) | P4 | Documented residual risk |

## 7. Final Recommendation

R-09 is confirmed. The fix is small, config-only (no accounting surface), and converts a documented-but-unenforced security wish into a hard guarantee — at the cost of a breaking change for anyone relying on defaults, which is precisely the point of B-08 and needs explicit human approval.

**Investigation is complete. Awaiting human review and scope approval.**
