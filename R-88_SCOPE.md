# R-88 SCOPE — per-company backup/restore (approved, Option A)

Approved by operator: proceed with Option A from `R-88_INVESTIGATION.md`.

## Approved scope

Per-company **manual** backup and **in-place** restore, on the existing deployment-level Backups surface, admin-only, shared Drive folder with scoped artifact names + scoped manifests, extended `backup_runs` with a scope column. The existing deployment backup/restore, Drive connect/disconnect, settings masking, and deployment schedule are untouched.

### In scope

1. **Migration 0025 (additive)** — extend `backup_runs`:
   - `scope_kind`: text, NOT NULL, default `'deployment'` — values `deployment` | `company`
   - `company_id`: integer NULLable, FK → `companies.id` ON DELETE set null — populated only for `scope_kind = 'company'`
   - backfill: set existing rows to `scope_kind = 'deployment'` (they are all deployment runs) — an explicit one-time UPDATE in the migration, not a silent assumption
   - index for the company-picker + isolation queries: `backup_runs_company_idx` on `(company_id)` where relevant; a company-run history query filters by `scope_kind = 'company' AND company_id = $1`
2. **Manifest contract extension** — every backup manifest gains a top-level `scope` field:
   - deployment: `{ scope: "deployment" }`
   - company: `{ scope: { kind: "company", cid: <number>, name: <string> } }`
   - The restore UI and restore engine read `scope` before touching anything; a company artifact carries the target `cid` and company name.
3. **Company backup generation (server service path)**
   - Manual trigger from the Backups page with scope = "company" + company picker.
   - Produces a company-scoped SQL artifact (only that `cid`'s rows across all company-scoped tables, in restorative dependency order — masters first then transactional, the same ordering family the app already relies on for restorative writes), gzipped, sha256 of the `.gz`, manifest with `scope: { kind: "company", cid, name }`, uploaded as a dump+manifest pair into the shared Drive folder.
   - Reuses the existing gzip/sha256/manifest/pair-upload/prune machinery; adds one new generation path, not a new pipeline.
   - Writes a `backup_runs` row with `kind = 'backup'`, `trigger = 'manual'`, `scope_kind = 'company'`, `company_id = <cid>`, `status` ok/error, file name/size/sha256/drive file id, actor.
4. **Company restore (server service path)**
   - Manual trigger: pick a company-scoped remote backup (filtered to company scope in the UI) and confirm.
   - Download dump + manifest, sha256-verify the `.gz` against the manifest (refuse on mismatch — same integrity contract as deployment restore), gunzip, strip the PG17 `transaction_timeout` preamble (same version-skew guard).
   - Apply the artifact **scoped to one `cid`** into the **existing** app database — delete+insert that company's rows in restorative dependency order inside one transaction (or an ordered statement set with the same all-or-nothing intent), leave every other company's rows untouched, never touch `users`/`user_companies`/`backup_settings` except appending the restore audit row.
   - Guard: the artifact's `scope.cid` must match the chosen target company; if the instance has no company with that cid, reject with an actionable message (no copy-in in v1).
   - Writes a `backup_runs` row with `kind = 'restore'`, `trigger = 'manual'`, `scope_kind = 'company'`, `company_id = <cid>`, status ok/error.
5. **Routes (admin-gated, same posture as today)**
   - `POST /backups/run` extended with an optional scope body: `{ scope: "deployment" }` (default, current behavior) or `{ scope: "company", companyId: <cid> }`. Non-company scope body rejected by zod; company scope requires a valid in-instance company.
   - `POST /backups/restore` extended with the same scope shape plus the existing typed-confirm + in-flight + 409 guards; company restore additionally validates `scope.cid` matches the artifact and that the target company exists in the instance.
   - `GET /backups/remote` extended to return scope on each pair (so the UI can filter/render by scope); company-scoped pairs surfaced for company restore.
   - Existing deployment routes unchanged in behavior.
6. **Client — Backups page**
   - A scope selector at the top of the run-now section: **Entire database** (current, default) vs **One company**.
   - When "One company" is chosen, a company picker lists the deployment's companies (read from a lightweight companies list — name + id; the picker is for the admin to choose which company to back up/restore).
   - Company run: "Back up now" becomes "Back up <company name> now" with the chosen company shown; the run-now busy/error messages name the scope.
   - Remote list rendered with a scope column/indicator (Deployment vs <company name>), and the Restore button on a company pair opens a **company-aware** restore confirm modal ("Restore <company name> from <backup> — company <name> is replaced to the backup point; other companies are unchanged. The app reloads after the restore completes.").
   - The existing deployment restore wording stays for deployment pairs.
   - No new chords (letter/digit space saturated, R-53c). No new Gateway surface (Backups stays where it is).
7. **Suite — new `r88_ui.js` section** (not weakening any existing suite)
   - Per-company manual backup round-trip on a disposable multi-company DB: pick company A, back it up, assert a company-scoped pair appears in the remote list with the right scope, assert the manifest on disk/mock carries `scope: { kind: "company", cid, name }`.
   - Per-company restore round-trip: restore company A from that pair, assert company A is back at the backed-up state (acts + vouchers + inventory state as of the backup), assert company B (the other company in the rig) is **byte-for-byte unchanged** (its masters + vouchers + inventory state identical before/after the company restore), assert `backup_runs` has a company-scoped restore row with the right cid.
   - Scope reject: attempt to restore a company artifact whose `cid` does not exist in the instance → actionable reject (no silent no-op, no copy-in).
   - Deployment backup/restore still works unchanged (regression anchor): a deployment backup still captures all companies; a deployment restore still replaces the whole instance (asserted on the same rig before/after).
   - In-flight + 409 guards apply to company runs too.
   - Baseline counts recorded in the release record.

### Out of scope (deferred, explicit)

- Per-company scheduling, per-company retention, per-company Drive folders.
- Non-admin company-backup authorization (page stays admin-only).
- Copy-in-as-new-company restore.
- Any change to accounting semantics (none expected; verify, do not invent).

## Acceptance criteria

1. An admin can back up one company manually and get a company-scoped Drive pair whose manifest records the correct cid + company name.
2. An admin can restore that pair and the target company returns to the backed-up state.
3. Restoring one company does **not** alter any other company's data (asserted directly on a multi-company disposable DB).
4. A company artifact whose cid is not present in the instance is rejected with an actionable message.
5. Deployment backup/restore behavior is byte-equivalent to before for the deployment path (regression anchor).
6. Every route still admin-gated with neutral 404 for non-admins; in-flight + 409 + typed-confirm guards apply to company operations.
7. Migration 0025 applies cleanly on a fresh schema and on an upgrade-from-v1.74.1 schema; existing `backup_runs` rows read as deployment scope.
8. No new npm dependency; no host tool; no new outbound dependency beyond R-85's Google Drive.

## Regression plan

- Run the full estate green, every suite exactly once, on a fresh schema: run.js ALL PASSED, smoke, final_regression, attack, fix, reconcile, attack2, all r-suites incl. r85_ui baseline, personas — plus the new r88_ui section at its recorded baseline.
- Verify upgrade-from-v1.74.1: seed from a tagged v1.74.1 image / current image with 0025 applied, then exercise both deployment backup/restore (unchanged) and per-company backup/restore on pre-upgrade multi-company data.
- Verify typecheck server+client clean, build clean, git diff --check clean.
- The independence rule applies to the accounting-verification part of the restore assert (expected restored state derived independently, not by re-reading zprime's own query path).

## Release gate

One implementation commit + one annotated tag; RELEASES.md + ROADMAP.md + CONTINUE.md + STATE.md updated. No release if any existing suite regresses or the isolation assertion fails.
