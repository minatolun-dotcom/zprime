# R-19 Investigation — zprime v1.18.0 · B-12 Backup/Restore UX

**Status:** investigation complete — no implementation (per protocol).
**Verdict:** `B-12 ALREADY CLOSED — VERIFIED` (closed by R-12 at v1.12.0 as a P4 ops item; disposition re-verified live on v1.18.0 including the new 0007 schema). **No defect exists.** The only actionable output is a one-row ROADMAP correction (stale candidate row). An in-product backup UI remains available **only** as an explicit product decision overriding R-12's documented security recommendation.

**Baseline:** HEAD `61564a2b047af8fec7eb117a5de163f205c1366d` = tag `v1.18.0`; working tree clean except this report and the intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md`. No source, test, migration, or doc file modified. Probes used a scratch database (created and dropped) and left the stack healthy.

---

## 1. Executive Summary

R-19 was opened to investigate "backup/restore UX (B-12)" — believed to be the last undispositioned finding from the production action plan. The investigation discovered the premise was **stale roadmap bookkeeping**: **B-12 was already fully investigated, dispositioned, and closed by R-12 (released as v1.12.0)**:

- **R-12 (v1.12.0) reclassified B-12 from P2 → P4** ("documentation/operations gap", not a defect) after live-verifying the documented `pg_dump` → drop → restore → verify path end-to-end (identical data after restore, app healthy).
- **What shipped in v1.12.0:** the README "Data & backups" section rewritten as a verified runbook (backup command, restore sequence with the stop-app → drop/recreate prerequisite, row-count verification step, volume-snapshot alternative with tradeoffs), plus **6 regression checks** in `final_regression.py` guarding the exact runbook shape against schema drift. Those 6 checks are still green inside today's 611.
- **The product-surface question was already decided:** F-12-3 (in-product backup endpoint/UI) was explicitly **out of scope with its security analysis documented** — a full-database dump endpoint is a cross-company data surface requiring a global-admin authorization concept zprime deliberately does not have (R-03 scope), and restore is inherently destructive. Recommendation recorded: *"do not build an in-product backup feature now."*

**Fresh evidence gathered this session (not inherited):** the round-trip was re-run live on the v1.18.0 stack — through migration 0007's new `audit_events` table — with `ON_ERROR_STOP=1`: zero drift, counts match, scratch dropped. The v1.12.0 disposition **holds unchanged on v1.18.0**.

## 2. Baseline Integrity

- `git rev-parse HEAD` → `61564a2b047af8fec7eb117a5de163f205c1366d`
- `git describe --tags` → `v1.18.0`
- `git status --short` → `?? ZLEDGER_PRODUCTION_ACTION_PLAN.md` only (intentional)
- Verification baseline at v1.18.0: Python 893/893, browser 228/228 (RELEASES.md)

## 3. B-12 Original Claim (action plan §15)

> | B-12 | No backup/restore in product | Not implemented | P2 | grep | Documented pg_dump + optional UI export |

And §17.10: *"Minimum work before production-ready: … and a documented backup/restore path"* — the plan's own requirement is **a documented path**, which R-12 delivered and regression-guarded.

## 4. R-12 History (v1.12.0, 2026-09-15-era) — what was already done

From `R-12_INVESTIGATION.md` and the v1.12.0 RELEASES.md entry:

1. **Live round-trip verified** on the disposable stack: full dump → drop/recreate → restore → identical row counts (39 vouchers / 9 companies) → app healthy immediately after.
2. **The real defect found and fixed:** the README restore procedure had omitted the stop-app → drop/recreate prerequisite (restoring over a live schema fails on `CREATE TABLE` collisions). Rewritten as a verified runbook.
3. **Drift guard shipped:** `final_regression.py` R-12 block (6 checks) — dump succeeds; scratch DB created; plain-SQL restore applies with `ON_ERROR_STOP=1` (future schema changes that break plain-SQL restore fail the battery, not an operator's restore); restored company + voucher counts match; scratch dropped clean.
4. **F-12-3 explicitly rejected** with rationale: no global-admin authorization concept exists (R-03 established only per-company membership); a dump endpoint would expose every company's data through one surface; restore-over-live-data is destructive; the target operator already has superior tooling (`docker compose exec db pg_dump`, volume snapshots).

## 5. Live Re-Verification on v1.18.0 (this session)

Executed against the running compose stack, exercising the **post-0007 schema** (24 tables, `audit_events` included):

| Step | Command shape | Result |
|---|---|---|
| Backup | `docker compose exec db pg_dump -U zprime zprime > /tmp/r19_probe.sql` | 105,178 bytes; 24 `CREATE TABLE`; `audit_events` present |
| Scratch restore | drop/recreate `r19_probe` DB → `psql -v ON_ERROR_STOP=1` | exit **0**, zero errors — **no schema drift from migrations 0006/0007** |
| Data integrity | counts in restored DB | `audit_events` **48**, `vouchers` **39** — match source |
| Cleanup | drop scratch | clean; stack healthy |

The documented runbook is correct and drift-free on the current release. The regression guard (6 checks, still in the battery) will keep catching future drift at every release gate.

## 6. The Only Remaining Gap

`ROADMAP.md`'s "Upcoming candidates" table still lists:

> | later | Backup/restore UX (B-12 P2) | action plan | ops | pg_dump guidance exists in README; product surface absent |

This row is **stale on two counts**: B-12 is closed (v1.12.0, P4), and the README no longer contains mere "guidance" but a verified, regression-guarded runbook. (The ROADMAP release-history table already records R-12 correctly; only the candidates row was never retired.)

**Proposed one-line correction:** mark the row `✅ DONE (v1.12.0) — closed as P4 ops: verified runbook + 6-check drift guard; in-product surface declined (F-12-3, documented)`.

## 7. If the Human Wants a Backup UI Anyway (explicit override of R-12)

Available as a deliberate product decision, **not** recommended. Requirements it would impose:

- **Authorization:** a global-admin concept (or operator-only env-var-gated endpoint) — a new authorization tier beyond R-03's per-company membership, previously declined to avoid scope creep.
- **Restore semantics:** in-product restore means replacing the live database under a running app — either the runbook's stop/drop/restart choreography automated (container control from inside the app is not clean) or an in-place destructive truncate/restore transaction with migration-state reconciliation. Both carry real risk for marginal benefit over the documented path.
- **Backup delivery:** streaming a full dump through the app process (memory/timeout bounds, Content-Disposition download) is straightforward but reintroduces the cross-company dump surface.
- **Honest cost/benefit:** the target deployment model (single operator with Docker access) already has the superior tool; a UI surface primarily serves hypothetical operators *without* Docker access — not a population zprime currently documents or supports.

## 8. Non-Bugs Verified

- **"No backup/restore in product" is TRUE and CORRECT** — by explicit, documented product decision (F-12-3, R-12), re-affirmed by this investigation's security review of what the feature would require. NOT A DEFECT.

## 9. Out-of-Scope Items

- Building any backup/restore UI or endpoint (unless the human explicitly overrides R-12 — see §7).
- Any change to the README runbook (it is correct and regression-guarded).
- Automated scheduled backups (host-level concern; cron + the documented command is the standard answer).

## 10. Final Recommendation

1. **Accept the B-12 closure as final** — no feature work.
2. **Approve the one-row ROADMAP correction** (§6) — the only change R-19 needs; it retires the stale candidate so future sessions stop re-selecting a closed item.
3. Return to IDLE and choose the next R-item from genuinely open candidates (company audit timeline, masters actor columns, UI hardening pair, or the postponed GST family).

---

**Final verdict:** `B-12 ALREADY CLOSED — VERIFIED · NO DEFECT · ONE STALE ROADMAP ROW TO CORRECT`
