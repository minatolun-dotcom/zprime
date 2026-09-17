# R-13 Investigation — zprime v1.12.0 · Login Hardening (Rate Limiting + Timing Enumeration)

**Status:** investigation complete — implementation NOT started (per protocol).
**Verdict:** `R-13 CONFIRMED — INVESTIGATION REQUIRED` (two P3 security-hardening findings, both live-reproduced; no P1/P2 defect).
**Baseline:** HEAD `a8396ac93318054da081482b011004460a0d81ad` = tag `v1.12.0`; working tree clean except this report and the intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md`. No source, test, migration, or doc file modified.

---

## 1. Executive Summary

With B-01…B-12 fully dispositioned, the highest-ranked remaining item per the action plan and the protocol priority order (security before UX) is **login hardening**: the action plan's §11 names "rate limiting absent on login (P3, single-tenant)" and its Phase 5 schedules "login rate limiting" as production hardening. This investigation confirms the finding and finds a second, undocumented issue beside it.

Two findings, both reproduced against the live v1.12.0 stack:

| ID | Finding | Severity |
|---|---|---|
| F-13-1 | **No rate limiting / lockout on `POST /api/auth/login`** — 25 consecutive failed logins: 25 instant 401s, no 429, no delay, no lockout | P3 (P2 for internet-exposed deployments) |
| F-13-2 | **Timing side-channel enables username enumeration** — avg 43.0 ms for existing user vs 2.1 ms for nonexistent user (20.7× signal), because `scryptSync` runs only when the user exists | P3 |

Since R-09 (v1.9.0) made `JWT_SECRET`/`ADMIN_PASSWORD` mandatory and fail-fast, internet-exposed deployment is a *supported* configuration (`3000:3000` is published directly with no proxy by default). For that configuration, F-13-1 + F-13-2 combine into a practical online password-guessing path with a working username oracle. For the classic LAN single-operator deployment, both are low-impact. Neither finding can corrupt accounting data or cross company boundaries.

No P1/P2 defect was found in the authentication core itself: scrypt+timingSafeEqual password verification is correct, JWT handling is sound, the 401 message is uniform (no textual enumeration), and post-burst legitimate login works normally.

## 2. Baseline Integrity

- `git rev-parse HEAD` → `a8396ac93318054da081482b011004460a0d81ad`
- `git describe --tags` → `v1.12.0`
- `git status --short` → clean except intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md`
- Baseline at v1.12.0: **840/840** Python (39+88+65+61+558+29) + **208/208** browser.
- Probe impact: only login attempts against the running stack — no data created, nothing to clean.

## 3. Candidate Selection (why R-13 is this)

Remaining items after B-01…B-12, ranked per protocol (security → accounting → data integrity → … → UX):

1. **Login rate limiting** — plan §11 security item, Phase 5. **Selected.**
2. Audit-trail groundwork (`created_by`/`updated_by`) — plan Phase 5/P3, but it is a schema+scope-expanding feature touching every table; the plan itself POSTPONEs the full audit trail. Poor next-single-item fit.
3. UX items (VoucherScreen negative-stock warning, import pre-validation feedback, TB-health indicator) — real value but explicitly polish; rank below security.
4. Opening GST balances / invoice rounding / FIFO experimental-flag — P3/P4 polish.

## 4. Current Authentication Architecture (as-built)

- `POST /api/auth/login` (`server/src/routes/auth.ts`): zod-parse `{username, password}` → single user lookup by exact username → `verifyPassword` → JWT `{uid, username}` 7d → httpOnly cookie `token` (`sameSite: lax`, `maxAge` 7d). Failure: uniform `401 {"error":"Invalid username or password"}` for both unknown-user and wrong-password.
- `verifyPassword` (`server/src/plugins/auth.ts`): `crypto.scryptSync(password, salt, 64)` + `timingSafeEqual` — N=16384 default cost. Verification itself is constant-time *given both hashes exist*.
- Auth plugin: preHandler JWT gate for all `/api/*` except `/api/auth/login` and `/api/health`. R-09 fail-fast on missing/insecure `JWT_SECRET`.
- Password hashing is synchronous (`scryptSync`) — blocks the event loop for the duration (~40 ms observed); relevant to both findings (fast rejection path skips it entirely).
- Deployment: `docker-compose.yml` publishes `3000:3000` directly; no reverse proxy, no infra-level limiting in the stack. Login route has **zero** attempt tracking, no lockout, no delay, no captcha; no rate-limit dependency exists anywhere (`@fastify/rate-limit`/`fastify-rate-limit`/`under-pressure` absent from package manifests and lockfile).
- Single Node process serves the app → in-memory limiter state is process-global and viable (no multi-worker deployment exists).

## 5. Live Probe Evidence (v1.12.0, running stack)

```
== 1. burst 25x valid-user + wrong password ==
   statuses: 25 × 401          any 429/lockout: False
== 2. burst 25x nonexistent user ==
   statuses: 25 × 401
== 3. timing side-channel (20 interleaved rounds) ==
   avg valid-user-wrong-pw: 43.0 ms
   avg nonexistent-user:     2.1 ms
   ratio: 20.7x              enumeration-viable: True
== 4. sanity ==
   correct login after bursts: 200 {"username":"admin"}
   /auth/me without cookie: 401   /auth/me with cookie: 200
```

The 20.7× ratio is a reliable remote oracle: an attacker can enumerate valid usernames before ever attempting a password. Combined with F-13-1 (unlimited attempts at ~22 req/s observed, i.e. ~1.9M guesses/day/username), online guessing of weak passwords becomes practical on exposed deployments.

## 6. Findings

### F-13-1 — No login rate limiting / lockout (P3; P2 if internet-exposed)
- **Root cause:** login route performs no attempt accounting; no limiter registered app-wide; no dependency available.
- **Impact:** unlimited online password guessing; no attenuation of credential stuffing; scrypt cost (43 ms) is the only brake (~1.9M guesses/day).
- **Existing coverage:** none — suites only assert 401-on-bad-password (smoke 1×, attack 1×).

### F-13-2 — Timing side-channel → username enumeration (P3)
- **Root cause:** `if (!user || !verifyPassword(...))` short-circuits: unknown user skips `scryptSync` entirely (2.1 ms vs 43 ms). The *message* is uniform; the *timing* is not.
- **Impact:** reliable enumeration of valid usernames over HTTP; materially improves the F-13-1 attack.
- **Existing coverage:** none.

### Documented-acceptable (NOT A BUG — VERIFIED, no change proposed)
- **Fixed 7d JWT, no refresh/revocation:** matches the single-tenant model; R-03 already makes company authorization per-request so token lifetime is not an authorization boundary. Revisit only if multi-instance/multi-tenant appears.
- **Uniform 401 body:** correct today (no textual leak); only timing leaks.
- **`scryptSync` (sync) on the login path:** blocks the event loop ~43 ms/login. Acceptable at single-tenant scale; a lockout limiter (F-13-1 fix) caps aggregate impact. Async scrypt is optional hardening, not required.
- **HTTPS absence:** deployment concern, not application code; documented in README security note (F-13-4, docs-only, folded into proposed scope).
- **`.env` uses `ADMIN_PASSWORD=admin123` in the *verification stack*:** explicit operator choice in a disposable local env; R-09 already enforces no default at boot. Not a code finding.

## 7. Suite-Collision Analysis (why a limiter is safe to add)

Every suite boots its own server instance (ports 3100–3106) against a disposable DB → limiter state starts fresh per suite. Failed-login counts per suite run: smoke 1, attack_test 1–2, fix_regression/attack2 ≤2, final_regression 0 failed (multi-user suites use correct credentials). A threshold of 10 failed attempts per window cannot collide with any existing suite. The baseline browser suite logs in successfully many times — successful logins must (and will) not count toward, and will reset, the failure counter.

## 8. Proposed R-13 Scope (implementation sketch — NOT implemented)

**Server (no new dependency, no migration, no client change):**
1. `server/src/lib/loginGuard.ts` (new, ~40 lines): in-memory sliding-window counter.
   - Key: `ip + "\n" + username` (both dimensions; attacker rotation of either is blunted, legitimate users unaffected).
   - `recordFailure(key)` / `isLocked(key)` / `reset(key)`; window 10 min, threshold **10 failures**, then **429** with `Retry-After` until the window expires. Successful login → `reset`.
   - Plain `Map`, no timers; lazy sweep on access (bounded by unique-key count; single-tenant scale trivial).
2. `auth.ts` login route:
   - Check `isLocked` **before** user lookup → `429 {"error":"Too many login attempts"}` + `Retry-After`.
   - **Equalize timing:** module-level dummy hash (`hashPassword("…random…")` computed once); when user not found, run `verifyPassword(password, DUMMY)` before returning 401 — both paths now perform one scrypt. Assert ratio collapse in tests.
   - On failure → `recordFailure`; on success → `reset`.
3. README security note: lockout behavior (10/10 min, per IP+username), 429 semantics, exposed-deployment guidance (HTTPS/reverse proxy, this limiter is defense-in-depth, not a substitute).

**Tests:**
- `final_regression.py` R-13 block (~8 checks): 10 failures → 11th 401 → 12th **429**; correct password during lockout → 429 (no bypass); different username same IP → unaffected; different IP same username → unaffected; successful login resets counter (full cycle); 401 body unchanged; timing check — unknown-user latency now within ~2× of valid-user (asserts the dummy-scrypt equalization).
- Browser: no dedicated suite required (login UX unchanged for legitimate users; the 153-check baseline exercises login on every run and fails loudly if the limiter misfires). Optional 1–2 checks only if implementation touches the login page error path — it should not.

**Verification:** typecheck server+client (client untouched but confirm), full Python battery (expect 840 → ~848), browser 208/208, `git diff --check`.

**Explicitly out of scope:** account lockout by email/URL; captcha; persistent (DB) attempt history; multi-node shared limiter store (no such deployment exists — documented in code comment); async scrypt migration; JWT refresh/revocation; audit trail; user-list/role UI.

**Migration requirements:** none. **Backward compatibility:** complete — behavior changes only after 10 failures/10 min from one IP+username pair; 429 response is new but only on the abuse path.

**Risks:** (a) shared-NAT offices could trip the per-IP+username key — mitigation: key includes username, threshold 10, window short; documented. (b) In-memory state resets on restart — acceptable (documented); persistence would be scope creep. (c) Suites must never batch >9 failed logins against one user in one run — verified above.

## 9. Historical Cross-Check

R-09 fixed the *secret* half of exposed-deployment safety (fail-fast boot); R-13 addresses the *online-attack* half. The two are complementary: R-09 made strong secrets mandatory, but mandatory secrets do not slow down guessing of a *weak chosen* password. This is the last open item from the plan's Phase 5 that is implementable without new product scope (audit groundwork deliberately postponed).

## 10. Prioritized Findings

| ID | Area | Finding | Status | Severity | Reproducible | Existing Coverage | Recommended Action | R-13 |
|---|---|---|---|---|---|---|---|---|
| F-13-1 | Auth | No login rate limiting/lockout | CONFIRMED (live) | P3 (P2 exposed) | YES | none | implement limiter | YES |
| F-13-2 | Auth | Timing side-channel → username enumeration | CONFIRMED (live, 20.7×) | P3 | YES | none | dummy-scrypt equalization | YES |
| F-13-3 | Auth | 7d fixed JWT, no refresh | NOT A BUG — VERIFIED (documented) | P4 | — | — | leave | no |
| F-13-4 | Ops | No HTTPS/proxy in default compose | DOCUMENTATION ONLY | P4 | — | — | README note | (docs) |
| F-13-5 | Auth | scryptSync blocks event loop ~43 ms | NOT A BUG — VERIFIED at scale | P4 | YES (timing) | — | leave; limiter caps abuse | no |

## 11. Final Recommendation

Proceed to HUMAN_REVIEW with the scope in §8. Smallest secure shape: one new ~40-line lib + login-route changes + ~8 regression checks + README note. No migration, no client change, no new dependency. This closes both confirmed findings with one mechanism (the limiter) and one constant-work fix (the dummy scrypt), and retires the final Phase-5 hardening item that does not expand product scope.

**R-13 CONFIRMED — INVESTIGATION REQUIRED**
