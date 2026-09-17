# R-12 Investigation — zprime v1.11.0 · B-12 Backup/Restore

**Status:** investigation complete — implementation NOT started (per protocol).
**Verdict:** `NO DEFECT CONFIRMED — DOCUMENTED OPERATIONS GAP, WORKING ROUND-TRIP VERIFIED` (B-12 reclassified: P4 ops item; the proposed remedy is documentation + optional product surface, not a bug fix).
**Baseline:** HEAD `31b69cfc4ce239d74e4703ba249b30a52f5e790a` = tag `v1.11.0`; working tree clean except this report and the intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md`. No source, test, migration, or doc file modified. All probe activity used disposable containers and left the stack healthy.

---

## 1. Executive Summary

B-12 claimed *"No backup/restore in product — Not implemented — P2 — Documented pg_dump + optional UI export."* The investigation **confirms the factual claims** (no product backup surface; documentation exists) but **rejects the P2 severity and the "defect" framing**: zprime is a single-container, single-Postgres deployment where the entire data estate is one database, and the documented `pg_dump`/`psql` path is **verified working end-to-end on the live stack** — a full drop-and-restore round-trip on the disposable docker stack reproduced identical data (39 vouchers, 9 companies) with the app healthy immediately after.

The action plan's own remedy — *"Documented pg_dump + optional UI export"* — is precisely what exists (documentation) plus what it marks optional. The genuine question for R-12 is a **product decision**, not an engineering defect: whether zprime needs a UI backup surface at all, given that (a) the deployment model is self-hosted single-operator, (b) Docker-volume-level backup is the standard practice for this class of deployment, and (c) an in-app "backup" endpoint that streams the entire database would introduce a new, highly sensitive authorization surface (full cross-company data dump) for marginal benefit over `docker compose exec db pg_dump`.

**Recommendation: do not build an in-product backup feature now.** Close B-12 by (1) strengthening the README's backup section into a real runbook (verified commands, restore-into-empty-DB nuance, volume-level alternative, verification step), and (2) adding a lightweight dump/restore round-trip check to the test rig so the documented path cannot silently rot. Both are ops/docs/test work — no source changes, no migration.

## 2. Baseline Integrity

- `git rev-parse HEAD` → `31b69cfc4ce239d74e4703ba249b30a52f5e790a`
- `git describe --tags` → `v1.11.0`
- `git status --short` → `?? ZLEDGER_PRODUCTION_ACTION_PLAN.md` only (intentional)
- Test baseline at v1.11.0: Python 831/831, browser 208/208 (RELEASES.md)

## 3. B-12 Original Claim (action plan §15)

> | B-12 | No backup/restore in product | Not implemented | P2 | grep | Documented pg_dump + optional UI export |

And §17.10: *"Minimum work before production-ready: … and a documented backup/restore path"* — i.e. the plan itself defines the requirement as **a documented path**, not a product feature.

## 4. What Exists Today (verified)

| Item | State | Evidence |
|---|---|---|
| Data storage | All data in one Postgres 16.14 database in the `pgdata` named volume | `docker-compose.yml:8-9,32`; `select version()` = PostgreSQL 16.14 |
| Documented backup command | **Yes** — README "Data & backups" section | README.md:77-79: `docker compose exec db pg_dump -U zprime zprime > backup.sql`; restore via `psql` |
| Product backup/restore endpoint | **None** | No route serves a DB dump; no `Content-Disposition`/`attachment` anywhere in `server/src` |
| Product data export | Per-report CSV only, client-side (`csvDownload` in `client/src/lib/csv`) — reports surface, not a backup | `Reports.tsx:12,109,324,452` |
| Backup scripts in repo | None | no `scripts/*backup*` |
| Authorization surface for a hypothetical dump endpoint | Would be new: `user_companies.role` is membership metadata (default `owner`); there is no global-admin gate today — a `/backup` endpoint would need one or it would hand any company member a full-DB dump | `schema.ts:25` (`role` default owner), `plugins/auth.ts` (cid() membership check, no global role) |

## 5. Live Round-Trip Verification (v1.11.0 stack)

1. **Pre-state:** 39 vouchers, 9 companies in the live `zprime-db-1`.
2. `docker exec zprime-db-1 pg_dump -U zprime zprime > /tmp/r12_backup.sql` → exit 0, 93,212 bytes, 23 `CREATE TABLE`, 22 `COPY` sections.
3. `docker stop zprime-app-1` → `DROP DATABASE zprime` → `CREATE DATABASE zprime`.
4. `cat backup.sql | docker exec -i zprime-db-1 psql -U zprime -d zprime` → clean apply (final lines: ALTER TABLE… constraints).
5. Post-restore: **39 vouchers, 9 companies — identical**. App restarted → HTTP 200.

The identical round-trip was also proven inside the disposable test rig (`zprime-test-pg`: dump → restore into a scratch database → row counts match → scratch dropped). This proves both the documented command and a CI-feasible verification shape.

**One documentation nuance found:** the README's restore command (`cat backup.sql | docker compose exec -T db psql -U zprime zprime`) **assumes the database already exists and is empty-compatible**. On a fresh volume, `POSTGRES_DB=zprime` creates it — fine — but restoring over a live database with existing schema fails on `CREATE TABLE` collisions. The runbook must state: stop app → drop/recreate DB (or use a fresh volume) → restore → start app. This nuance is the only genuine "gap" between the documentation and a safe operator path.

## 6. Coverage of Backup-Related Paths

None in any suite — expected, since there is no product surface. No test asserts anything about backup/restore. The proposed round-trip check (see §9) would be the first.

## 7. Security Review

No new surface exists today, so no exposure. **Note for any future in-product backup feature:** a dump endpoint is a full-data-estate disclosure; with the current R-03 membership model (`role` as metadata, no global admin), it must not be built without a deliberate global-authorization decision. This is additional evidence for deferring the feature rather than building it casually. **R-03 security status: GREEN (no regression).**

## 8. Product Decision Assessment

- **Deployment model:** self-hosted, Docker Compose, single operator (the R-03 Model C owner). Docker-volume backup (`docker run --rm -v zprime_pgdata:/data …` or compose-level snapshots) is the norm for this class and already "works" without product code.
- **Risk of in-app backup surface:** high sensitivity (entire DB), needs a new global-role concept, saves marginal effort vs one shell command. Against zprime's minimalism philosophy (keyboard-first accounting, no ERP clutter), a settings-page backup button is scope creep today.
- **Documentation quality:** the single README line is real but thin — no restore-into-existing-DB warning, no verification step, no volume-level alternative. This is the actionable gap.

## 9. Findings Table

| ID | Area | Finding | Status | Severity | Reproducible | Existing Coverage | Evidence | Recommended Action | R-12 candidate |
|---|---|---|---|---|---|---|---|---|---|
| B-12 | Operations | No in-product backup/restore surface | CONFIRMED but by design | **P4** (downgraded from P2: documented pg_dump path verified working; product surface not warranted now) | yes | none (no surface) | §4, §5 | Close as ops item; strengthen docs | YES — docs/test only |
| F-12-1 | Documentation | README restore command omits the drop-or-fresh-DB prerequisite; restoring over a live DB fails | CONFIRMED (docs gap) | P3 (operator could lose time, not data) | yes (live-verified failure mode exists) | n/a | §5 | Rewrite "Data & backups" as a verified runbook | YES |
| F-12-2 | Test rig | No automated check that the documented backup path keeps working (e.g. migration/schema changes breaking plain-SQL restore) | TEST-COVERAGE GAP | P4 | yes | none | §6 | Add dump→restore→row-count round-trip check to the test rig | YES (optional) |
| F-12-3 | Future scope | In-product backup endpoint would require a global-admin authorization concept that does not exist | OBSERVATION | P4 | n/a | n/a | §7 | Explicitly out of scope; prerequisite documented | no |

## 10. Non-Bugs Verified

- **The documented backup path works** — full drop-and-restore round-trip live-verified with identical data and a healthy app (NOT A BUG — VERIFIED).
- **No product backup surface** is a design consequence of the single-operator self-hosted model, not a defect.

## 11. Out-of-Scope Items

- In-product backup/restore UI or endpoint (needs global-role prerequisite; contrary to current minimalism).
- Point-in-time recovery / WAL archiving (enterprise-grade; not warranted for the deployment model).
- S3/cloud backup integrations.
- Per-company export beyond the existing per-report CSV (that is a reporting feature, not backup).

## 12. Final Recommendation

**NO P1/P2 DEFECT CONFIRMED — OPS DOCUMENTATION + OPTIONAL TEST-HARDENING RECOMMENDED**

R-12, if approved, is a **docs + test-only change** (no source, no migration, no client):

1. **README "Data & backups" → verified runbook:** backup command (verified), restore procedure with the stop-app → drop/recreate-DB → restore → start-app sequence, a "verify after restore" step (row counts / app health), and the volume-level alternative for full-state snapshots.
2. **Optional round-trip check** in the test rig (shape already proven in §5): dump `zprime-test-pg` → restore into a scratch DB → assert company/voucher counts match → drop scratch. ~5 checks; protects the runbook against future schema/migration drift (e.g. extension or ownership changes) that could silently break plain-SQL restore.

Severity of doing nothing: P4 — real operators have a working, documented path; the gap is polish, not safety.
