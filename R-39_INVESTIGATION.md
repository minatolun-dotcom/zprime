# R-39 Investigation — zprime v1.37.0 · B-12 Backup/Restore

**Status:** investigation complete — implementation NOT started (per protocol).
**Verdict:** `B-12 ALREADY RESOLVED — NO P1/P2 DEFECT. REMAINING WORK IS OPS-DOCUMENTATION COMPLETION + VERIFICATION DEPTH (test/docs only).`
**Baseline:** HEAD `2ab0703` (docs commit on release `d850fc8` = tag `v1.37.0`, pushed, 39 tags); working tree clean except this report and the intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md`. No source, test, migration, or doc file modified.

---

## 1. Executive Summary

The action plan's B-12 entry ("No backup/restore in product", P2, grep-era) is **outdated**. R-12 (released v1.14.0) resolved it exactly as the plan's own fix column prescribed — "Documented pg_dump + verification":

- **Documented:** README "Data & backups" carries the full runbook — `pg_dump` backup command, a guarded drop-recreate-restore procedure (app stopped first), a post-restore verification step, and a whole-volume alternative.
- **Verified:** the `R-12` block in `scripts/final_regression.py` (7 checks, run in every regression battery) executes the exact runbook shape — dump → restore into a scratch DB with `ON_ERROR_STOP=1` → row counts match → scratch dropped — so schema drift that would break a plain-SQL restore fails the suite before release.

There is **no defect to fix**. What genuinely remains is narrower and lower-stakes than the action plan's original P2:

1. **Verification depth:** R-12 proves the restore *applies cleanly* and *row counts match* — it does not prove **content equality** of accounting data (a restore that silently lost a ledger's opening balance would still pass).
2. **Ops guidance gaps:** no scheduled-backup (cron) example; no restore-drill guidance (a backup never test-restored is a hope, not a backup).
3. **Discoverability:** an operator who lives in the UI never learns the runbook exists. A static Gateway reminder card (no server state, no new schema) would close that — but it is optional, not a defect.

The honest engineering posture: this product is a self-hosted, single-operator deployment where `pg_dump` is the *right* tool; an in-app backup feature would add an attack surface, version-skew risk, and a second backup truth for no safety gain.

## 2. Baseline Integrity

- `git rev-parse HEAD` → `2ab0703afff59c55af8db6f569be52bd92a5c9c9` (docs commit on top of the v1.37.0 release commit — expected post-release state)
- `git describe --tags` → `v1.37.0-1-g2ab0703`; tag `v1.37.0` → `d850fc8` verified; `origin/main` = HEAD (pushed)
- `git status --short` → only untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md` (intentional, untouched) and `scripts/__pycache__/`
- Verification estate at baseline: Python 1222/1222 · browser 494/494

## 3. B-12 Claim vs Reality

| Action plan claim (v1.3.0-era grep) | v1.37.0 reality | Disposition |
|---|---|---|
| "Backup / restore: **MISSING** — zero application-level; DB dumps only via ops" | Still zero application-level — **by design** (README: "no product UI needed for a single-operator deployment") | NOT A BUG — VERIFIED (design decision, documented) |
| Fix column: "Documented pg_dump + optional UI export" | Documented ✓ (README §Data & backups) + regression-guarded ✓ (R-12 block) | ALREADY FIXED (R-12, v1.14.0) |
| "Restore should be verified after restore" | Runbook includes a verify step (spot-check a report / compare row counts) | DONE |
| P2 severity | Nothing found that justifies P2 today | Downgraded — remaining items are P3/P4 ops-polish |

## 4. Current Backup/Restore Estate (verified in source)

- **README `## Data & backups`** (lines 82–110): `docker compose exec db pg_dump -U zprime zprime > backup.sql`; restore = stop app → drop/create DB → `psql` the dump → start app; verify via report spot-check or row-count query; whole-volume `tar` snapshot alternative with an explicit "prefer pg_dump" recommendation.
- **`scripts/final_regression.py` R-12 block** (lines 2061–2110): 7 checks — dump succeeds (>10 KB), scratch DB created, restore applies with `ON_ERROR_STOP=1` (catches ownership/extension/constraint drift), company + voucher row counts match, scratch dropped (clean rig). Runs in every full regression battery.
- **Compose topology:** `db` (Postgres, owns `pgdata` volume, ships `pg_dump`) and `app` (Node, no DB tooling, no superuser powers) — the app container cannot dump or destroy the DB directly, which is the correct blast radius.
- **Client:** no backup/restore surface anywhere (grep of `client/src` = zero hits outside IRP/EWB payload downloads and per-report Export CSV). Closest precedent for an ops-aware surface: the Gateway **Books Health** card (R-14).
- **Scheduling:** no cron/systemd example anywhere; no backup-retention guidance.

## 5. Gap Analysis (evidence-based)

1. **Content-equality gap (P3, test-only):** R-12 compares `count(*)` on companies/vouchers. A restore that preserved row counts but corrupted values (rounding, a dropped `CHECK`, an extension behaving differently) would pass. A per-table content checksum comparison (live vs restored) inside R-12 would upgrade the guarantee from "shape survived" to "data survived" — cheap, deterministic, and it stays out of production code.
2. **Scheduling guidance (P4, docs-only):** the runbook assumes a human remembers to run the dump. A 5-line cron example (host-side cron hitting `docker compose exec db pg_dump`, timestamped file, retention note) is the standard completion of such a runbook.
3. **Restore-drill guidance (P4, docs-only):** one paragraph — "rehearse the restore quarterly; R-12 proves the path works on every release, but only a drill proves *your* backup file restores."
4. **Discoverability (optional UX):** a static Gateway card (title, one-line rationale, copy-to-clipboard dump command, link to README section) with **no server round-trip and no state** would inform UI-first operators. Rejecting any "last backup" tracking: that requires a backup registry (new schema/state) and would create a second source of truth about files the server cannot see.

## 6. Options

- **Option A — close-out, test/docs only (recommended):** extend R-12 with content-equality checksums (per postings-bearing table, live vs restored) + 2–3 new checks; README gains the cron example + restore-drill paragraph. No server file, no client file, no schema.
- **Option B — A + static Gateway "Backups" card:** adds the discoverability surface; client-only, no server round-trip; ~4–6 browser checks in a small `r39_ui.js` (card renders, command matches README verbatim, link navigates).
- **Option C — in-app backup download endpoint:** rejected — needs pg tooling in the app image or a JS dumper, new auth surface for sensitive data, version-skew risk, and contradicts the documented single-operator design. Would re-open a settled decision without a defect motivating it.
- **Option D — defer:** record B-12 as resolved and move on; do the docs the next time ops reality demands it.

## 7. Proposed R-39 Scope (Option A, or B if approved)

- `scripts/final_regression.py` R-12 block: +2–3 checks — `md5`/`pg_checksum`-style comparison of postings-bearing tables (`vouchers`, `voucher_entries`, `ledgers`, `stock_items` + valuation-bearing tables) between live and restored scratch DB; a check that the restored DB's schema matches the live one (e.g. `pg_dump --schema-only | checksum`).
- `README.md` §Data & backups: cron scheduling example + restore-drill paragraph (docs commit only).
- If Option B: `client/src/pages/Gateway.tsx` static card + `scripts/acceptance/r39_ui.js`.
- Full gates before RELEASE_REVIEW; no migration; no accounting surface.

## 8. Non-Bugs Verified

- **"Zero application-level backup" — NOT A BUG — VERIFIED:** deliberate, documented design for a self-hosted single-operator product; R-12 exists precisely to keep the documented path trustworthy.
- **Restore requires DROP DATABASE first — NOT A BUG — VERIFIED:** plain-SQL restores collide on `CREATE TABLE` against an existing schema; the runbook's stop-app step prevents concurrent writes. Standard pg_dump practice.
- **No backup scheduling in product — DOCUMENTATION/OPERATIONS ONLY:** host cron is the correct layer for a compose deployment; see gap 2.

## 9. Final Recommendation

Close B-12 properly with **Option A** (verification depth + runbook completion — test/docs only). Option B is a reasonable small addition if UI-first operators are expected; Option C stays rejected absent a real operator requirement.

**B-12 ALREADY RESOLVED — NO P1/P2 DEFECT. Option A close-out recommended.**
