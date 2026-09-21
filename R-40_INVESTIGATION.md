# R-40 Investigation — zprime v1.38.0 · Import Pre-Validation UI

**Status:** investigation complete — implementation NOT started (per protocol).
**Verdict:** `CANDIDATE ALREADY SHIPPED (R-21, v1.20.0) — LIVE-VERIFIED ON v1.38.0. NO P1/P2 DEFECT. REMAINING WORK IS ROADMAP HYGIENE (docs-only).`
**Baseline:** HEAD `09a71e2` (ledger commit on release `5337507` = tag `v1.38.0`, pushed, 40 tags); working tree clean except this report and the intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md`. No source, test, migration, or doc file modified.

---

## 1. Executive Summary

The selected R-40 candidate — "import pre-validation feedback in the UI" — is **already fully implemented**. It shipped as **R-21 (v1.20.0)**, part (B), and every piece was re-verified live in this investigation against the current v1.38.0 tree:

- **Server:** `POST /c/:cid/import/xml?dryRun=1` runs the *identical* single-transaction import path — every parser, `validateEntries` (Dr=Cr), stock-availability, reference/bill/duplicate checks — then throws a sentinel that rolls back the whole transaction and returns the same stats shape with `dryRun: true`.
- **Client:** `ImportXml.tsx` has the **"Validate (dry run)"** button, the blue "Dry run complete — nothing was imported" banner, and the warnings list — exactly the pre-validation feedback the candidate asked for.
- **Tests:** the v1.38.0 release battery contains the 10-check R-21 Python block — **all 10 green** — and `r21_ui.js` (13 checks) is green in the browser battery.

The investigation also found the **other two** non-bug hardening candidates from that same R-04 list are likewise already delivered: the VoucherScreen negative-stock advisory was R-21 part (A), and B-12 backup/restore was closed by R-39 (v1.38.0, yesterday). The action-plan-derived candidate list is therefore **fully dispositioned**.

What actually remains is stale documentation: ROADMAP's candidates region still says the current phase is "R-34 released (v1.33.0)" and still lists these shipped items as open candidates. That is a 3-line docs fix, not an engineering task.

## 2. Baseline Integrity

- `git rev-parse HEAD` → `09a71e238866e144b31cbe2a39c9e9175f3734ab` (docs commit on the v1.38.0 release commit — expected post-release state)
- `git describe --tags` → `v1.38.0-1-g09a71e2`; `origin/main` = HEAD (pushed)
- `git status --short` → only untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md` (intentional) and `scripts/__pycache__/`
- Verification estate at baseline: Python 1229/1229 · browser 494/494

## 3. Candidate Verification (source + live evidence)

**Server (`server/src/routes/import.ts`):**
- Line 85: `DRY_RUN_DONE` sentinel; line 92: whole import in ONE transaction (R-04/B-05 atomicity); line 95: sentinel catch returns `{...stats, dryRun: true}`.
- Lines 527–529: at the end of the full validation pass, `?dryRun=1` stashes the stats and throws the sentinel → **full rollback** — nothing persisted, ever.
- Same `cid()` gate as the real import (non-member → 404, proven by R-21's 10th check).

**Client (`client/src/pages/ImportXml.tsx`):**
- `doImport(dryRun)` posts the same XML to the same endpoint with `?dryRun=1` (file upload and paste modes both supported).
- Buttons: **Validate (dry run)** + **Start Import**; result card shows the stats table (groups/ledgers/units/items/godowns/vouchers/skipped), the blue "nothing was imported" banner in dry-run mode, and the warnings list (`result.errors`).

**Test evidence (fresh, on v1.38.0):**
- `/tmp/rel38-fr.log` (the v1.38.0 release-gate run): `-- R-21: import dry-run pre-validation --` → 10/10 ok, including "dry run persists NOTHING", "unbalanced XML rejected with the real error", "oversell rejected, item named", "real import after dry run succeeds", "non-member dry-run → 404".
- Browser: `r21_ui.js` 13 checks, green in the current browser battery.

## 4. Historical Candidate List — Full Disposition

| Candidate (source) | Reality | Disposition |
|---|---|---|
| Import pre-validation feedback in the UI | R-21 part B (v1.20.0): server dry-run + client Validate button + banner; 10+13 checks | ALREADY SHIPPED — VERIFIED |
| VoucherScreen negative-stock warning | R-21 part A (v1.20.0): amber live advisory from the same chronological source as the R-06 guard; `allowNegativeStock` suppression | ALREADY SHIPPED |
| B-12 backup/restore UX | R-12 guard (v1.14.0) → R-19 re-verification → R-39 close-out (v1.38.0): content checksums + schema fingerprint + cron/drill runbook | ALREADY SHIPPED |
| Graduate audit INV probes into regression blocks | Delivered across R-06/R-21/R-22 blocks in final_regression | ALREADY SHIPPED |

**Conclusion: the R-04-derived non-bug hardening list is fully dispositioned. No defect, no gap.**

## 5. What Genuinely Remains

1. **ROADMAP hygiene (docs-only, P4):** three stale markers — line 50 "Current phase: IDLE — R-34 released (v1.33.0)" (ten releases behind), line 55 candidate list naming B-12 + the two R-21 items as open, line 73 repeating the same two as non-bug candidates. Updating these is the entire actionable scope.
2. **Optional future polish (NOT recommended now):** the dry-run currently reports *counts + warnings*, not a per-record preview (e.g., exactly which voucher numbers would be skipped vs created). This would be an enhancement only if a real operator importing large files asks for record-level review — no evidence of that demand exists. Recorded here so it is not re-invented as a "gap" later.

## 6. Options

- **Option A — docs-hygiene close-out (recommended):** update ROADMAP's three stale lines to reflect v1.38.0 reality and mark the candidates region as fully dispositioned. No code, no tests, no schema. Release as a small patch (v1.38.1-style docs release or folded into the next feature release).
- **Option B — A + per-record dry-run preview:** new server+client scope (preview payload changes, new UI surface, new tests). Rejected for now — no operator demand, violates minimum-scope discipline.
- **Option D — defer:** leave ROADMAP stale; pick a genuinely new candidate next session.

## 7. Non-Bugs Verified

- **"Import errors surface only after commit" — NOT A BUG — VERIFIED:** pre-validation exists end-to-end (server dry-run on the identical transaction path, client preview UI, both regression-guarded since v1.20.0). The candidate's premise was stale documentation, not missing functionality.

## 8. Final Recommendation

**Option A** — a 3-line ROADMAP hygiene fix closing out the action-plan-derived candidate list, with R-40 recorded as "candidate verified already shipped". Then select the next R-item fresh: IRP/EWB production onboarding feedback from real operators, or hold steady.

**NO P1/P2 DEFECT CONFIRMED — CANDIDATE ALREADY SHIPPED; DOCS HYGIENE RECOMMENDED.**
