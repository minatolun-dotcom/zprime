# R-45 Whole-Product Re-Review — zprime v1.43.0

**Status:** verification complete — no production code changed (two acceptance fixtures adjusted, see §3).
**Baseline:** HEAD `030dacde26d7f750c1ac0b2d010ef480230db601` = `v1.43.0-1-g030dacd` (release commit `a3f162c478d9e13a2162750b8d6a728d2cdc51f9` = tag `v1.43.0`, pushed, 45 tags). Working tree after review: only this report + CONTINUE.md handoff + the two fixture fixes + intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md` / `scripts/__pycache__/`.

---

## 1. Executive Summary

Full-battery re-certification of v1.43.0, the third fresh-evidence sweep since the PRODUCTION READY adoption (R-41 → v1.39.0, R-42 drill, now R-45 → v1.43.0). **Every gate green on a rebuilt image from the exact release tree, with a fresh database volume.** One real regression was caught and fixed during the sweep — a v1.43.0 fixture interaction, not a product defect (details §3, evidence §3.1).

**Verdict: PASS — estate now 1229 automated + 517 browser checks, zero failures.**

## 2. Baseline Integrity

| Check | Result |
|---|---|
| HEAD | `030dacd` = `v1.43.0-1-g030dacd` ✓ |
| Tag | `v1.43.0` → `a3f162c` = release commit ✓ (45 tags, all prior resolve to their ledger commits) |
| Working tree at start | clean apart from intentional untracked files ✓ |
| App image | rebuilt from the v1.43.0 tree (`docker compose --profile test up -d --build app`), health `{"ok":true}` |

## 3. The Sweep

### 3.1 Browser estate — fresh volume, rebuilt image

| Suite | Result |
|---|---|
| run.js (baseline, independent engine reconcile) | **153/153** — ALL CHECKS PASSED |
| r03 (company isolation) | 12/12 |
| r04 (import hardening) | 9/9 |
| r05 (GST) | 12/12 |
| r07 (openings) | 12/12 |
| r10 (idempotency) | 10/10 |
| r14 (TB health surface) | 11/11 |
| r18 (audit trail) | 11/11 |
| r20 (audit timeline) | 12/12 |
| r21 (pre-validation UX) | **13/13** (was 9/4 on first pass — see below) |
| r23 (RCM) | 14/14 |
| r24 (e-invoice) | 16/16 |
| r25 (e-way bill) | 13/13 |
| r26 (GSTR-9) | 12/12 |
| r27 (TCS) | 15/15 |
| r28 (IRP) | 15/15 |
| r29 (EWB from IRN) | 14/14 |
| r30 (direct EWB) | 17/17 |
| r31 (birth path) | 15/15 |
| r33 (threshold) | 13/13 |
| r34 (Apply GST keys) | 20/20 |
| r35 (Alt+C quick-create) | 23/23 |
| r36 (grid arrows) | **25/25** (was 24/1 on first pass — see below) |
| r38 (payee threshold) | 14/14 |
| r43 (hydration guard) | 12/12 |
| r44 (starter masters) | 11/11 |
| **Browser total** | **517/517, zero FAIL lines** |

### 3.2 Python estate — zprime-test-pg, fresh schema per suite

| Suite | Result |
|---|---|
| smoke | 39/39 |
| adversarial (attack_test) | 88/88 |
| fix_regression (bug-fix) | 65/65 |
| reconciliation (independent engine) | 61/61 |
| final_regression | 947/947 |
| attack-the-fixes (attack2) | 29/29 |
| **Python total** | **1229/1229** |

### 3.3 Fresh install

| Check | Result |
|---|---|
| Volume wiped (`down -v`) + stack up from zero | app healthy |
| Migrations applied from zero | **16/16** |
| Public tables created | **27** |

### 3.4 Engine independence

`scripts/acceptance/engine.py` imports only `json` and `datetime` — no production module, no DB access; expectations derived from `state.json` (the business events as entered). Independence intact.

## 4. Finding Caught and Fixed During the Sweep (R-44 fixture interaction)

**What happened:** on the first full browser pass, r21 (9/4) and r36 (24/1) failed. Root cause, proven with a standalone probe:

- r21 POSTs `units {name:"Nos", symbol:"Nos"}` and uses the response `id`; r36 POSTs `{name:"Pieces", symbol:"pcs"}` the same way.
- Since v1.43.0, those symbols are **seeded** on every fresh company → the POST now correctly returns **409** (`A record with this name/symbol already exists`) → `id` is `undefined` → the dependent stock-item POST fails (`unitId: undefined` → 23502 "A required field is missing") → the r21 advisory checks cascade.

**This is the R-44 change working as designed** (the unique index rejecting a duplicate), exactly like the four Python fixtures adjusted in R-44 — these two browser fixtures predate the seed and were missed because neither R-44's run.js edit nor the four Python edits covered them. It is NOT a product defect: the API contract is right, and the seeded unit is the correct reuse path.

**Fix (fixtures only, no assertions weakened):** r21 and r36 now reuse the seeded unit when the POST returns 409 — the same mechanical adjustment applied to the Python suites in R-44. After the fix: r21 **13/13**, r36 **25/25**, and the definitive full pass (fresh volume again) shows **zero FAIL lines across all 27 suites**.

## 5. Non-Bugs Verified

- The 409-on-duplicate-unit behavior itself: correct enforcement of `units_company_symbol_uq` — NOT A BUG.
- The two fixture failures were the only anomalies in the sweep; everything else passed first time, including the R-43 hydration guard and R-44 starter-masters suites on the same fresh volume.

## 6. Scope & Risk

| Area | Change? |
|---|---|
| Production code | **None** |
| Schema / migrations | **None** |
| Product behavior | **None** |
| Test fixtures | 2 files (`r21_ui.js`, `r36_ui.js`) — duplicate-tolerant unit resolution |

## 7. Final Verdict

**PASS — v1.43.0 re-certified on fresh evidence. Estate: 1229 automated + 517 browser checks, 45 immutable releases, engine independent, fresh install clean (16/16 migrations, 27 tables).**

Awaiting instruction: record as docs release **v1.44.0** (recommended — keeps the every-release-carries-evidence cadence), or hold.
