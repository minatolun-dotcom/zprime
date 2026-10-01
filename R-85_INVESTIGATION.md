# R-85 INVESTIGATION — In-app backups to Google Drive (UpdraftPlus-style), restore included

**Status: INVESTIGATION COMPLETE — ZERO PRODUCTION CODE. Awaiting operator approval (R-67/R-83/R-84 precedent: ROADMAP "(no release)" row, no tag, no release).**

**Operator request (2026-10-01):** "for online backup i want this feature: in wordpress we have a plugin called updraft plus backup, this allows user to backup/restore backups to and from google drive without needing any other apps like rsync or rclone in the main system, everything needed should be available with the zprime app. is this possible and how. research"

## Method

As-built audit of the v1.73.0 tree (server deps, `crypto.ts` secrets-at-rest, auth model, boot flow, Dockerfile runtime stage) against the **official Google documentation fetched this session** — developers.google.com OAuth2 (`/identity/protocols/oauth2`), Drive web-server flow (`/identity/protocols/oauth2/web-server`), Drive scopes (`/workspace/drive/api/guides/api-specific-auth`) — plus the official UpdraftPlus docs (teamupdraft.com Google Drive guides) and the well-documented failure modes surfaced across the practitioner ecosystem (n8n, make.com, Stack Overflow threads).

## The UpdraftPlus model (what the operator is asking for)

WordPress + UpdraftPlus = **backup/restore living entirely inside the app's own admin UI**: (1) connect a cloud destination once (Google Drive via OAuth — Google consent screen, tokens held by the plugin); (2) a schedule dumps the DB, compresses it, uploads it to Drive (files land in an `UpdraftPlus` folder), and prunes old remote copies; (3) from the same page, browse the remote backups, download, and restore with integrity checks. No rsync, no rclone, no shell on the host. The operator wants exactly this for zprime.

## Verdict: POSSIBLE — fully in-app, no host tools, no vendor middleman

Everything needed lives inside zprime (server routes + a Dockerfile line). Node 22 has built-in `fetch` and `zlib`; the existing `crypto.ts` gives AES-256-GCM secrets-at-rest with the R-09 fail-fast posture; the one real gap is that the runtime image (node:22-alpine) ships **no `pg_dump`/`psql`** — solved by adding `postgresql16-client` to the Dockerfile's runtime stage (one `apk add`, ~15 MB; the server then spawns `pg_dump`/`psql` as child processes with an args array — no shell, no injection surface). The DB is currently 11 MB; gzipped dumps will be 1–3 MB — trivial for Drive's multipart/resumable upload API.

## As-built facts the design builds on

- **Secrets at rest:** `crypto.ts` (R-28) already does AES-256-GCM (nonce + authTag + ciphertext), boot-time fail-fast when encrypted rows exist and the key is missing (`IRP_ENC_KEY`), masking at the routes layer. The backup feature reuses this module and the same key/env (one deployment encryption key), with the same boot probe added for backup rows.
- **Auth model:** `users` = (id, username, password_hash) — **no admin/role flag exists** (every user has full company access; deployment-level surfaces like Company Settings → Users are company-scoped). Backups are **deployment-level** (the whole Postgres instance), so they need an explicit admin gate: additive `users.is_admin` (default false; the seeded admin set true; Company Settings → Users gains a transfer-ownership/admin checkbox for the operator).
- **Process model:** single-process by design (login-throttling note); an **in-process scheduler** (minute-resolution check against the stored schedule) is the natural fit — no new dependency, survives via the app's own lifetime, state persisted in DB.
- **Audit:** `recordAuditEvent` exists and would cover config changes, connect/disconnect, manual backup, and restore.
- **Precedent patterns to reuse:** R-28 masked credential read-back (retype-to-change), env-only endpoint override (mock-irp sidecar + suites), additive migrations chained via the gen-00XX one-shot helpers, boot fail-fast probes.

## External research findings (the decisive ones)

1. **OAuth redirect URI:** Google's official web-server flow doc — "Redirect URIs must use the HTTPS scheme… **Localhost URIs (including localhost IP address URIs) are exempt from this rule**." ⇒ `http://localhost:3000/api/backups/oauth/callback` is registrable on a free GCP project. **This deployment (app on localhost, browser on the same machine) does the consent dance natively.** LAN-IP deployments (`http://192.168.x.x`) cannot register a non-HTTPS redirect — their operator does the one-time consent from the server machine's localhost, or puts the app behind HTTPS first (the redirect URI then registers normally).
2. **The 7-day token trap:** official Google OAuth2 doc — an OAuth consent screen left in **"Testing"** publishing status issues refresh tokens that **expire in 7 days**. The setup wizard MUST walk the operator to set the consent screen to **"In production"** (publishing requires no verification review for the non-sensitive `drive.file` scope). The server also detects the 7-day-expiry failure signature (`invalid_grant` after exactly ~7 days) and surfaces an actionable banner ("republish your consent screen or reconnect").
3. **Scope discipline:** `https://www.googleapis.com/auth/drive.file` — per Google's own scopes page, per-file consent; **the app can only see files it created** (plus files the operator explicitly opens with it). A leaked token cannot read the operator's other Drive documents. Backups go to a folder `zprime-backups` (created on first run).
4. **UpdraftPlus's own auth model** — two shapes: their vendor-hosted "Sign in with Google" relay (the plugin redirects through teamupdraft.com's OAuth client), or the operator's own GCP project (client ID + secret pasted into the plugin settings). The relay shape requires zprime (or its publisher) to run a hosted OAuth proxy — **rejected** (see options).
5. **Service accounts — the tempting shortcut that fails:** research shows SAs cannot own files in a personal Drive ("Service accounts don't have storage quota and can't own any files"), free personal Gmail has no Shared Drives (the reliable SA surface), and practitioners widely report `storageQuotaExceeded` walls when SAs upload into shared personal folders. **SA is only reliable on Google Workspace Shared Drives.** Rejected for a single-operator free-Gmail deployment.
6. **Drive upload mechanics:** multipart upload (`uploadType=multipart`) covers small files; resumable (`uploadType=resumable`) is the same API family if dumps ever grow. Listing/deleting by name prefix (`zprime-*.sql.gz`) implements remote retention. 750 GB/day upload quota is irrelevant at this scale.

## Recommended design (Option A + full scope)

**Auth: native OAuth 2.0 with the operator's OWN free Google Cloud project** — no vendor proxy, no middleman, no phone-home (matches zprime's self-hosted posture and its threat model, which already contains one opt-in outbound integration: NIC IRP/e-Way Bill).

**Setup wizard** (Company-agnostic, deployment-level): Settings gains a **Backups** card (admin-only):
1. Step-by-step GCP instructions rendered in-app: create project → enable Drive API → OAuth consent screen → External → **publishing status "In production"** (the 7-day-trap fix, explained in-line) → create OAuth **Web application** client → add the exact redirect URI shown for copy-paste: `http://localhost:3000/api/backups/oauth/callback` (or the deployment's own HTTPS origin).
2. Paste Client ID + Secret → masked read-back, retype-to-change (R-28 pattern).
3. **Connect Google Drive** → Google consent (offline access, `drive.file`) → callback exchanges the code → **refresh token stored AES-256-GCM encrypted** → status chip "Connected".

**Scheduled backups:** daily or weekly at HH:MM, retention N (both remote and local staging), toggle on/off. Backup run = spawn `pg_dump` (in-image client, args array, DATABASE_URL to the compose `db`) → gzip (node zlib) → write `zprime-YYYY-MM-DD_HHMMSS.sql.gz` + a sidecar **manifest JSON** (created-at, app version, pg_dump --version, plain-SQL, sha256, byte count) → upload both to Drive → prune beyond retention (remote + local) → record in **`backup_runs`** (kind backup/restore, trigger schedule/manual, status, sizes, sha256, drive file id, error). Same shape feeds a "Back up now" button.

**In-app restore (the half that makes it UpdraftPlus-equivalent):** from the same page, list remote backups (name/date/size) → pick one → download → **verify sha256 against the manifest (refuse on mismatch)** → typed confirmation ("RESTORE") → spawn `psql` (in-image client): connect to the `postgres` database, terminate other connections, drop/recreate the `zprime` database, run the dump (psql handles the dump's `COPY FROM stdin` natively — no driver-level COPY work) → **audit event + `backup_runs` row** → the app's pool reconnects lazily (postgres.js recreates sockets; verified in the suite). The operator stays logged in; the page reloads to the login screen (fresh DB = fresh session store semantics re-verified in suite).

**Restore-after-total-loss path** (the real disaster scenario): new machine → `docker compose up` (app boots, migrates, seeds admin) → log in → Settings → Backups → paste the GCP client ID/secret again (they live in YOUR Google Cloud console — they survive machine loss by design) → Connect → the `zprime-backups` Drive folder is visible immediately (`drive.file` + same client) → pick the latest → restore. Documented in the wizard footer. (Same property UpdraftPlus has: the plugin's config doesn't survive a site loss either — the cloud credentials do.)

**Schema (migration 0024, additive, gen-0024.ts):** `backup_settings` (single row: client_id, client_secret_enc, refresh_token_enc, folder_name default 'zprime-backups', schedule_kind daily|weekly, schedule_hhmm, retention_count, enabled boolean, last_run_at); `backup_runs` (id, kind backup|restore, trigger schedule|manual, status ok|error, started_at, finished_at, file_name, file_size, sha256, drive_file_id, error text); `users.is_admin` boolean NOT NULL DEFAULT false (seeded admin → true; zero backfill risk — every existing row honest as non-admin until the operator promotes someone in Company Settings → Users).

**Dockerfile:** runtime stage gains `postgresql16-client` (apk). Suites get a **mock Drive sidecar** (scripts/mock_drive.js — the mock-irp pattern: node script, compose `--profile test`, env-only `BACKUP_DRIVE_ENDPOINT` override that the code reads from env and NEVER from the API/UI — SSRF posture: no user-controllable destination URLs, Google hosts are fixed in code).

## Options priced

- **A — Native OAuth, operator's own GCP project (RECOMMENDED):** no middleman; least-privilege `drive.file`; free; works today on this localhost deployment; the wizard carries the operator through a one-time ~10-minute GCP setup.
- **B — Vendor-hosted OAuth relay (the UpdraftPlus hosted-app shape): REJECTED.** Requires zprime to run a hosted OAuth proxy; contradicts the self-hostable/no-phone-home posture and the threat model (e-invoicing is deliberately direct-to-NIC).
- **C — Service account: REJECTED with evidence.** Free personal Drive + SA = quota/ownership traps (SAs can't own files; Workspace Shared Drives are the reliable surface; `storageQuotaExceeded` widely reported). Only robust on Workspace.
- **D — rclone bundled in the image: REJECTED.** An extra binary + its config-file semantics to do what ~200 lines of native `fetch` + the existing crypto module do; still needs a GCP client for Drive anyway.
- **Scope options:** **S1 = backup only** (connect + schedule + upload + history + local staging integration); **S2 = backup + in-app restore (RECOMMENDED — the feature is only honest with restore included; UpdraftPlus equivalence is the request).** The restore path is destructive and gets its own gated suites (sha-verify refusal, typed confirmation, audit, post-restore parity vs a seeded live DB — the R-12 hash-compare discipline).

## Accounting & security review (pre-implementation posture)

- **Accounting: zero impact.** Backups are deployment-level; no voucher/report/valuation path is touched; the TB is unreachable. The restore path is validated by the same content-hash discipline the suite already uses for the R-12/R-39 backup guard.
- **Security:** tokens + client secret AES-256-GCM at rest (existing module + key; boot fail-fast probe added for backup rows); secrets never logged, masked read-back; **admin-only** via `users.is_admin` (a company user without the flag gets neutral 404s — no existence leak); restore is sha-verified + typed-confirm + audited; **no user-controllable destination URLs** (Google hosts fixed in code; mock endpoint is env-only); new outbound dependency (googleapis.com) documented in the threat model alongside NIC IRP; dump files land in the operator's own Drive (their account security — 2FA recommendation — now also protects the backups).

## Acceptance criteria (for the implementation cycle)

1. Admin-only Backups card renders; non-admin users get neutral 404s on every `/api/backups/*` route.
2. Wizard end-to-end: paste client → Connect → Drive consent → connected chip; masked read-back + retype-to-change on both secrets; Disconnect revokes + wipes stored tokens (audited).
3. "Back up now" produces: local `zprime-*.sql.gz` + manifest with matching sha256 + a Drive file inside `zprime-backups` + a green `backup_runs` row; failure paths (Google unreachable, bad token) record error rows and surface actionable messages.
4. Schedule: due-time fires within a minute; retention prunes remote + local beyond N; disabled schedule fires nothing.
5. Restore round-trip: seeded live DB (vouchers + postings + logo + IRP-shaped encrypted rows) → backup → mutate live data → restore the earlier backup → **all postings-bearing tables hash-identical to the pre-mutation state** (R-12 discipline); sha-mismatch dump REFUSES to restore; typed confirmation required; audit events recorded.
6. The 7-day-trap: wizard carries the "In production" step; an `invalid_grant` on upload surfaces the actionable banner; suites prove the message.
7. Full estate green at baseline + the new backup suite; Docker upgrade-from-v1.73.0 verified (migration 0024 additive over a real release DB).

## Open items for the operator

1. **Approve Option A + scope S2** (or trim to S1).
2. The one-time **GCP project setup is yours** (~10 minutes, free; the wizard walks every click). Google account = where backups live; enable 2FA on it.
3. The existing **local staging backups (systemd timer) stay** — belt and braces; the Drive copies are the off-disk layer this machine currently lacks.

**Next step: operator picks → approved items → implementation cycle.**
