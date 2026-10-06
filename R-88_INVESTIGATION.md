# R-88 INVESTIGATION — per-company backup/restore (deployment vs one company)

> Operator request (this session): backup/restore should offer an option to back up either the **entire database** or a **single company**.
>
> Baseline: v1.74.1 (R-86 released). Current backups are **deployment-level** — one pg_dump/restore of the whole Postgres, one Drive folder, one schedule, one `backup_settings` singleton, one `backup_runs` trail (`R-85_INVESTIGATION.md`, migration 0024). This investigation scopes what changes for a per-company option and prices it against the existing deployment backup.

## 1. What "entire database vs single company" actually means here

zprime already has the two grains the operator is naming:

- **Entire database** = the current R-85 behavior: `pg_dump` of the whole Postgres instance the app connects to. That instance holds **every** company's tables (`companies`, `ledgers`, `vouchers`, …), the deployment singletons (`backup_settings`, `backup_runs`, `idempotency_keys`, `users`, `user_companies`), and the IRP + payroll + cost-centre tables. A deployment backup captures all of it atomically in one dump.
- **Single company** = one `companies.id` (one `cid`). Everything app-semantically "belonging to that company" is reachable via the `company_id` FK on every company-scoped table.

So the request is **not** "database vs company" as two unrelated things — it is "back up the whole instance, or back up just one `cid`'s slice of it". That distinction matters for the restore contract more than for the backup itself.

## 2. What is company-scoped vs deployment-scoped today (verified against schema)

Verified against `server/drizzle/meta/0024_snapshot.json` (the current post-0024 schema):

**Company-scoped (have `company_id`, FK → `companies.id`, onDelete cascade):**

- `companies` itself
- masters: `groups`, `ledgers`, `voucher_types`, `tds_sections`, `tcs_sections`, `units`, `stock_groups`, `stock_categories`, `godowns`, `stock_items`, `employees`, `pay_heads`, `salary_structures`, `cost_categories`, `cost_centres`
- transactional: `vouchers`, `voucher_entries`, `bill_allocations`, `inventory_entries`, `voucher_cost_allocations`, `audit_events`, `idempotency_keys`, `payslips`, `irp_submissions`, `irp_ewb_ops`
- company-dependent lookup data the app seeds per company: the Tally group backbone, the seeded ledgers (Cash, P&L, IGST/CGST/SGST/CESS, TDS Payable, Salary Payable), the seeded voucher types, units, godowns, stock categories

**Deployment-scoped (no `company_id`, one row / one table for the whole instance):**

- `users` — deployment-level identity; a user reaches a company through `user_companies`
- `user_companies` — the membership junction; this is what "a user belongs to company X" means
- `backup_settings` — singleton `id = 1`; Drive client id/secret/refresh token, folder name, schedule, retention
- `backup_runs` — one audit trail for the whole deployment's backup/restore/connect/disconnect activity
- `idempotency_keys` — per-company rows today, but **the table itself is shared across companies** (its unique index is `(company_id, key)`); on a whole-DB restore it comes back as-is, on a per-company restore it is company-scoped rows

So a "single company" backup is well-defined at the data level: select every table that has `company_id`, filter to that `cid`, and you have the company's full accounting estate. The only wrinkle is the **shared deployment tables** — `users`/`user_companies` in particular — because a per-company restore does not want to disturb other companies' memberships or the deployment admin flag.

## 3. Backup feasibility — per-company pg_dump is not the right tool; per-company SQL is

`pg_dump` dumps a whole database (or whole schema). It has **no per-company filter**. The options for producing a company-sized dump are:

1. **Separate dump database** — create a throwaway DB, copy the company's rows in (plus whatever shared rows it needs), dump that, discard. Heavy, slow, error-prone, and still cannot express "this dump is only company 3" cleanly in the manifest.
2. **Dump the whole DB and filter client-side** — defeats the point; the uploaded artifact would still be the whole instance.
3. **Build the per-company artifact as SQL the same way the app already writes SQL** — the restore path already shells `psql -f`. A per-company backup can be: a normalized SQL dump of **only that company's rows** (masters → dependent tables in FK order, or `pg_dump --table` per table with a `WHERE company_id = $1`), plus a small manifest. This is the clean path and reuses the existing gzip/sha256/manifest/Drive pair machinery.

**Verdict on backup generation**: feasible. The existing engine already:
- spawns `pg_dump`/`psql` with `PG*` env (no secrets in argv) — R-85 posture preserved
- gzips to a temp file, sha256s the `.gz` bytes, uploads a dump+manifest pair, prunes by keep-newest-N
- writes a `backup_runs` row

For per-company, the generation changes from "spawn `pg_dump` of the whole DB" to "craft a company-scoped SQL artifact and gzip it". The surrounding pipeline (gzip → sha256 → manifest → pair upload → prune) is shared. The manifest needs one new field: `scope: "deployment" | { kind: "company"; cid: number; name: string }` so the restore UI and the restore engine know what a file contains before anything is touched.

A concrete, low-risk generation shape (to be confirmed in implementation, not blessed here):

- Write a SQL file with `SET` session options + `BEGIN;` + per-table `COPY company_scoped_table (cols…) FROM stdin;` rows for that `cid` only, in dependency order, then `COMMIT;`. Inventory valuation depends on `inventory_entries` + `stock_items` opening state, so the COPY order must respect the FK chain the app already respects on import (masters first, then vouchers/entries/allocations/inventory, with the FK targets present). This is the same ordering concern R-04 solved for XML import — the app already has a defined table ordering for restorative writes; reuse it rather than inventing a new one.
- Alternatively, reuse `pg_dump --schema` + per-table `WHERE` clauses. Either way the artifact is a **company-only SQL+gz** that can be restored into a DB that still contains the other companies untouched.

**What the artifact must also carry** (company-only restore needs it, deployment restore does not):

- The company row itself (`companies.cid`) — the restore target.
- Any rows the company's data depends on that live **outside** the company scope. The cleanest answer here is: per-company backup does **not** try to carry deployment identity (users/memberships) or the shared singletons. Restoring company 3 into an instance that already has company 3 is "replace company 3's data". Restoring company 3 as a **new** company into an instance requires a target `cid` decision — see §5.

## 4. Restore feasibility — the hard part, and why deployment restore and company restore are different operations

### 4.1 Deployment restore (today) — "swap the whole DB"

Today's `restoreBackup`:

1. download dump + manifest
2. sha256-verify the `.gz` against the manifest (refuses on mismatch)
3. gunzip, strip the PG17 `transaction_timeout` preamble
4. `psql -f` against a **freshly recreated app database**: terminate connections, `DROP DATABASE IF EXISTS`, `CREATE DATABASE`, then run the dump
5. write a `backup_runs` restore row

This is **all-or-nothing at the instance level**. It is the right tool for "restore the whole deployment to a point in time". It is the wrong tool for "restore company 3 and leave companies 1, 2, 4 alone", because step 4 destroys the other companies too.

### 4.2 Company restore — must not touch other companies' data

A company restore needs a different engine step:

1. download + verify the per-company pair (same sha256 contract)
2. gunzip, strip preamble
3. **apply into the existing app database, scoped to one `cid`**, in a transaction or a carefully ordered set of statements that:
   - deletes/marks-target rows for that `cid` in the company-scoped tables (in reverse-FK order or via `DELETE … USING` / truncate-with-where where safe), then inserts the backup's rows
   - does **not** touch other `cid` rows
   - does **not** touch deployment tables (`users`, `user_companies`, `backup_settings`, `backup_runs`) except for appending its own audit row
4. write a `backup_runs` restore row with `scope: company, cid: N`

The accounting risk here is real but contained: a per-company restore is exactly as accounting-safe as the data inside the backup. If the backup was a correct point-in-time snapshot of that company, restoring it restores that company to that point. The invariant that must hold afterward is: **other companies' data is byte-for-byte unchanged**, and **the restored company's TB/valuation is internally consistent** (which it is, because it came from a real zprime DB). This is exactly the kind of claim the independence engine should verify on a disposable DB with 2+ companies (see §7).

### 4.3 The one place company restore can go wrong: shared-identity and numbering

Two subtle points:

- **Numbering counters** (`voucher_counters`) are company-scoped (composite `(company_id, voucher_type_id, fy)`), so a per-company restore carries its own counters and they restore cleanly for that company. No cross-company collision.
- **Voucher number uniqueness** is scoped `(company_id, voucher_type_id, fy, number)` with the `is_optional` partial indexes. A per-company restore cannot collide with another company's vouchers by construction. Good.
- **The shared tables problem**: `users` and `user_companies` are deployment-scoped. A per-company backup cannot and should not restore membership. So "restore company 3" never changes who can access company 3 — membership is a separate deployment concern. This is the correct isolation posture: backups carry accounting data, not identity. The one exception is the restore audit row itself, which writes to the shared `backup_runs` with the actor who triggered it.

## 5. Restore target semantics — the UX/contract decision that shapes everything

A per-company restore has two distinct use cases, and they need different wording/guards:

**A. Replace company X with its backup (in-place)** — the deployment already has company X; the operator wants company X back to how it was at backup time. Other companies untouched. This is the common "I messed up company X, roll it back" case.

- Guard: the backup's `scope.cid` must equal the target company id (or the UI must name the target explicitly). Cannot restore a company-3 backup onto company 7 silently.
- Collision rule: the restore replaces that company's rows; if the company exists, it is replaced in place. Other companies untouched.
- Audit wording: "Restore company X from <backup> — company X is replaced to the backup point; other companies are unchanged."

**B. Restore a company as a new company (copy-in)** — the backup is company X from another instance (or the same instance at an earlier point) and the operator wants it as a **new** company Y in the current instance. This is a different, rarer operation — more like "import this company's data" than "roll back".

- This raises the same questions as any cross-instance move: new `cid`, new numbering counters, possibly new party ledger names colliding with existing names in the target instance, new item names, etc. Naming uniqueness is per-company already (`ledgers_company_name_uq`, `stock_items_company_name_uq`, etc.), so a copy-in is safe from intra-instance collisions **within** the company scope, but the operator may still want a fresh name.
- Cost: this is more than "restore" — it is closest to a company-import feature. If in scope, it is its own slice of work and should be priced separately.

**Recommended contract for R-88 (see §8):** ship **A (in-place company replace)** as the per-company restore, explicitly not B. B ("restore this backup as a brand-new company") is a different feature boundary and can be a later request if wanted. This keeps R-88's restore semantics parallel to the deployment restore (a roll-back-to-a-point-in-time), just scoped to one company.

## 6. Schedule & retention — share the existing schedule or per-company?

This is the biggest scope question and I am not assuming an answer.

Today's schedule is a **deployment singleton**: one `schedule_kind`/`schedule_hhmm`/`schedule_dow`/`retention_count`/`enabled` in `backup_settings`, one scheduler tick that runs **one** `pg_dump` of the whole DB. That is simple and correct for "back up the whole instance nightly".

For per-company, the options:

- **Shared schedule, two backup types**: keep one schedule, but when it fires, either back up the whole DB **or** back up one chosen company (a new "default backup scope" setting: deployment vs company + which company). One artifact per run either way. This is the smallest change and preserves the existing "one schedule, one retention bucket" model. Downside: you cannot independently schedule "company A nightly, company B weekly".
- **Per-company schedules**: a company backup has its own frequency/retention. This implies either (a) multiple Drive folders (one per company, or one folder with per-company subfolders) or (b) one folder with per-company naming, plus per-company retention bookkeeping. More flexible, more surface, more pruning complexity.

**Assessment**: a per-company **manual** backup+restore is low-risk and high-value and can ship on the shared schedule model (or no schedule at all for company backups initially). **Per-company scheduling** is a meaningful extension to the scheduler + retention model and should be a separate decision, not folded into the first per-company release by default.

**Recommended scope (see §8):** per-company **manual** backup and restore first. Leave per-company scheduling as an explicit later option unless the operator says schedule-per-company is wanted now. The existing deployment schedule continues to work unchanged for whole-DB backups.

## 7. Security & isolation posture

The current backups surface is **deployment-admin-only** (`requireAdmin` on every route; non-admins get a neutral 404; `users.is_admin` is the gate). For per-company, the question is whether the scope picker changes who can see/restore what.

Options:

- **Keep the whole Backups page admin-only**, and the per-company picker is just a scope selector inside an already-admin surface. This is the smallest change and preserves today's threat model: backups are a deployment-administrator function. The picker shows the deployment's companies (read from `companies`) so the admin can choose which one to back up/restore.
- **Per-company visibility by membership**: a non-admin who belongs to company X could back up/restore only company X. This is a finer-grained authorization model and would require a new gate (company-admin-or-owner can back up their company; restore still destructive enough to gate carefully). This is a different authorization surface and should be an explicit choice, not an accidental side effect.

**Recommended posture (see §8):** keep Backups admin-only for R-88, picker reads the deployment's companies for the admin. If the operator wants non-admins to trigger their own company backup later, that is a new authorization feature and should be priced as such. Nothing in R-88 weakens the existing admin gate.

**Isolation contract that must be suite-verified (non-negotiable):**

- Restoring company X does not alter any row in any company-scoped table where `company_id != X`.
- Restoring company X does not alter `users`, `user_companies`, `backup_settings`, or any other deployment-scoped table except appending its own `backup_runs` audit row.
- Restoring company X into an instance that has **no** company X (i.e. target company missing) is rejected cleanly with an actionable message, unless the chosen contract explicitly supports copy-in (not in v1 scope).
- A deployment backup still captures everything (including all companies), and a deployment restore still replaces the whole instance. The two scopes are independent and do not regress each other.

## 8. Accounting impact

**Zero by design, but must be verified on the restore path.**

- Backup is a dump of already-booked data; it does not post anything. No Dr/Cr movement.
- Restore replays already-booked data. A deployment restore replays a whole-DB snapshot (already proven byte-identical TB pre/post in R-85's upgrade drill). A company restore replays one company's snapshot; the **other companies must end with identical TB/valuation to before the restore**, and the restored company must end at the backed-up state.
- Inventory valuation, GST report figures, bill-wise outstanding, cost-centre allocations, payroll slips, IRP submissions for the restored company all come back as they were at backup time — because they are stored data, restored verbatim. The one thing to verify is that the restore ordering reproduces the same valuation the source DB had (i.e. the artifact is applied in an order that reproduces the source's inventory state, not some intermediate state). This is the same class of concern as R-04 import ordering and the existing restore's `psql -f` ordering — the app already has a defined restorative-order dependency; the company artifact must respect it for the company's tables.

## 9. Storage & Drive organization for per-company artifacts

The current Drive folder holds pairs named `zprime-<timestamp>-<tail>.sql.gz` + `.manifest.json`. That naming already encodes "deployment backup, timestamped". For per-company, the cleanest approach is to keep one folder but make the name/scope explicit:

- Deployment backup: `zprime-<timestamp>-<tail>.sql.gz` (scope = deployment, unchanged)
- Company backup: `zprime-<cid>-<company-slug>-<timestamp>-<tail>.sql.gz` with manifest `scope: { kind: "company", cid, name }`

Pruning stays "keep newest N pairs" globally (shared retention) unless/until per-company retention is chosen — see §6. Mixing deployment + company pairs in one folder is fine as long as the manifest records the scope and the restore UI filters/display by scope. The existing `listRemote` already groups by base name and expects a dump+manifest pair; that logic generalizes.

If the operator wants **separate Drive folders per company** (cleaner isolation, independent retention), that is a settings extension (per-company folder name) and is optional for v1. I would not add it unless asked — shared folder with scoped names is enough for the first release and less settings surface.

## 10. Migration shape (draft, not blessed)

R-85 added migration 0024 (additive). R-88 would add one more additive migration (0025) with:

- New bookkeeping table for **per-company run history** (or extend `backup_runs` with optional `scope` columns). Two sub-options:
  - **Option 1 — extend `backup_runs`**: add `scope_kind` (`deployment` | `company`), `company_id` NULLable FK to `companies`. Deployment rows keep `company_id` NULL; company rows carry it. One audit trail, simpler, but the table's semantics widen.
  - **Option 2 — new `company_backup_runs` table**: separate trail for company-scoped runs. Cleaner isolation of the two concerns, but two history surfaces to render/assert.
  - Recommendation: **Option 1 (extend `backup_runs`)** — the audit trail is "everything this deployment's backup subsystem did", and scope is a property of a run, not a separate subsystem. Less surface, one history table to assert on.
- Optional: a `backup_settings` extension for the "default backup scope" (deployment vs company + company id) if the shared-schedule model is chosen. If per-company backups are manual-only at first, this setting is not needed yet.

No existing table is altered in a destructive way; 0025 is additive like 0024. As with every migration here, verify **both** a fresh-install apply and an upgrade-from-the-last-release apply (current release = v1.74.1, so upgrade-from-v1.74.1).

## 11. What changes vs what stays

**Stays (do not touch):**

- Deployment backup/restore behavior (whole-DB pg_dump/restore, sha256 contract, in-flight lock, scheduler for deployment scope, Drive pair upload/prune, OAuth connect/disconnect, settings masking).
- `backup_settings` singleton meaning for the Drive connection + deployment schedule.
- The admin gate and neutral-404 posture.
- The manifest sha256 + verify-before-touch contract (this is the load-bearing integrity guarantee and must apply to company artifacts too).

**New:**

- A per-company backup generation path (company-scoped SQL artifact → gzip → sha256 → manifest with `scope: company` → pair upload).
- A per-company restore path (download → verify → apply scoped to one `cid`, leave other companies untouched → audit row).
- A scope picker in the UI: "Entire database" (current) vs "One company" (new picker reading the deployment's companies). Manual trigger for company scope first; deployment schedule unchanged.
- Extended `backup_runs` (or new table) to record scope on company runs, and a history render that shows scope.
- New/extended routes: company backup run, company restore (with the same typed-confirm + in-flight + 409 guards), company remote list (or a scope filter on the existing list).
- New testid suite section (per-company manual backup/restore round-trip on a multi-company disposable DB; isolation assertions that other companies are untouched; scope-reject when target company missing).

## 12. Options

### Option A — per-company manual backup + in-place restore, admin-only, shared Drive folder, shared deployment schedule untouched (RECOMMENDED)

- Ships the operator's actual ask: "I want to back up either the whole DB or one company."
- Lowest-risk path: reuses gzip/sha256/manifest/Drive/pair/prune, reuses the admin gate, reuses the existing deployment schedule, adds one scoping layer + one scoped restore engine.
- Restore contract is "replace company X in place; other companies untouched" — parallel to deployment restore's "replace the instance".
- Deferred cleanly: per-company scheduling, per-company retention, per-company Drive folders, non-admin company-backup authorization, copy-in-as-new-company — all separable later requests.

### Option B — Option A + per-company schedule + per-company retention + optional per-company Drive folder

- More flexible, more settings surface, more pruning complexity, more suite coverage.
- Only worth it if the operator wants independent per-company schedules now. Otherwise it is scope creep on top of the ask.

### Option C — per-company backup only, restore stays deployment-only

- Half the ask. Backing up one company but only being able to restore the whole DB is not a satisfying endpoint and would likely prompt a follow-up restore request immediately. Not recommended unless the operator explicitly wants backup-only first.

### Option D — decline; keep deployment-only backups

- Defensible if the operator's real need is "I have one company and the whole-DB backup already protects it". But the ask explicitly names a single-company option, and the data model supports it cleanly, so decline would be a decision to not meet the ask, not a feasibility constraint.

## 13. Recommended option

**Option A**: per-company **manual** backup + **in-place** restore, admin-only, shared Drive folder with scoped artifact names + scoped manifests, extended `backup_runs` with a scope column, deployment schedule and deployment backup behavior unchanged.

Rationale: it is the smallest change that meets the ask, it preserves every existing guarantee (sha256 integrity, admin gate, deployment restore, scheduler), and it isolates the risk to the one new thing that matters — the company-scoped restore not touching other companies — which is exactly what the suite must prove on a disposable multi-company DB.

## 14. What I need from the operator before implementation

1. Confirm the restore target contract: **in-place company replace** (Option A) is the right semantics, and copy-in-as-new-company is out of scope for now. If copy-in is wanted, it is a separate scope.
2. Confirm scheduling: per-company backups are **manual-only** for the first release (deployment schedule unchanged), unless you want per-company scheduling now (Option B).
3. Confirm authorization: Backups page stays **deployment-admin-only** for R-88 (picker shows companies to the admin). If you want non-admins to back up their own company, say so and it becomes an explicit authorization feature.
4. Confirm Drive organization: shared folder with scoped names is fine for v1, unless you want per-company folders.
5. Confirm retention: shared keep-newest-N across deployment + company pairs for v1, unless you want per-company retention.

Once those are settled, implementation writes `R-88_INVESTIGATION.md` -> approved -> migration 0025 (additive) -> company backup/restore service paths -> scoped routes -> UI scope picker + company picker -> new suite section -> verify on disposable multi-company DB (including the isolation assertions) -> upgrade-from-v1.74.1 drill -> release.

## 15. Dependencies / posture notes

- Reuses R-85's in-image `postgresql16-client` (`pg_dump`/`psql`) posture — no host tools.
- Reuses the existing AES-256-GCM secret-at-rest (`crypto.ts` / `IRP_ENC_KEY`) — no new secret plumbing.
- Reuses the existing Drive `drive.file` scope + fixed hosts + env-only mock posture — no new outbound dependency.
- New outbound dependency: none beyond what R-85 already introduced (Google Drive). Accounting: zero impact by design; verify restore isolation + per-company TB/valuation on disposable DB.
