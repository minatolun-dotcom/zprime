# OPERATOR_NOTES.md — Machine/credential notes

Small operator-maintained notes file for things that live on THIS machine
outside git. Nothing secret belongs in here — the tokens themselves stay in
the ignored `secrets` files documented below. Committed (tracked) file.

## GitHub push tokens (two PATs — do not mix them up)

| Secret file | Path | Repo it works for | Notes |
|---|---|---|---|
| **zprime token** | `/home/popsickle/zprime/secrets` | `minatolun-dotcom/zprime` | Format: `token: <PAT>` line + `github repo:` line. Fine-grained PAT. **Use this one for zprime pushes.** |
| **zcircuit token** | `/home/popsickle/Project/zcircuit/secrets` | `minatolun-dotcom/zcircuit` ONLY | Same format. Authenticates as the same user, reads zprime OK, but **every zprime push 403s** (no Contents:Write there). |

### The 403 that cost an hour (2026-10-07, v1.75.0 push)

Three push attempts against zprime failed with
`Permission to minatolun-dotcom/zprime.git denied` — the credential came from
the zcircuit file. The working token was in the **repo's own gitignored
`~/zprime/secrets`**. Diagnosis recipe, in order:

1. Files named `secrets*` (lowercase) are gitignored by `.gitignore:6-7` —
   they never show in `git status`. That's why the wrong one was easy to
   trust. (`SECRETS.md`/uppercase names are NOT covered — never name a
   token file that; it would get committed.)
2. Check whether a token can write a repo without side effects: a
   deliberately malformed POST to
   `/repos/{owner}/{repo}/contents/x` with `{"message":"probe"}` answers
   **422** (validation error = Contents:Write present) vs **404** (fine-grained
   deny — indistinguishable from unknown repo). `/git/refs` returns 422 for
   anyone on a malformed body — its 422 means NOTHING about permissions
   (learned the hard way).
3. All pushes in the release records use per-command injection
   (`git push https://minatolun-dotcom:$TOKEN@github.com/...`) with output
   filtered through a redaction sed, never stored config.

### Other standing machine facts (from the release ledgers)

- Git identity is set at user level once (2026-10-07,
  `Popsickle <minatolun@gmail.com>`) — the inline `-c user.name=...` dance in
  older ledger entries is retired; plain `git commit` carries it.
- ~~Reboots wipe the compose test rig's env — recreate the app with all three
  `BACKUP_*_ENDPOINT`~~ **FIXED (2026-10-09, Docker persistence pack):** the
  boot warm-up below now restores the three BACKUP_* envs + `compose up -d`
  automatically at every boot — no manual recreate.

## Docker persistence at boot (2026-10-09)

The rig survives reboots unattended:

1. `docker.service` and `docker.socket` both `enabled` (operator ran
   `systemctl enable docker`). `docker-compose.yml` already carries
   `restart: unless-stopped` on all four services (R-16 F-R1) — once the
   daemon is up it self-restores the previously-running containers.
2. `/etc/systemd/system/zprime-stack.service` (static unit — `systemctl enable`
   on it is a SILENT NO-OP; first reboot drill caught this) runs
   `/usr/local/bin/zprime-stack-warm.sh` at boot: exports the three
   `BACKUP_*_ENDPOINT` **rig-only values** (`http://mock-drive:3309` ×2,
   authorize `http://localhost:3309`), then `docker compose up -d` in
   `/home/popsickle/zprime`. WITHOUT this the `${VAR:-}` passthrough bakes
   EMPTY envs and the app silently falls back to real Google.
3. To run stock (real Google) on a real deployment: edit
   `/usr/local/bin/zprime-stack-warm.sh` and DELETE the 3 export lines —
   the yml's `${VAR:-}` passthrough then resolves to empty = factory
   behavior.
4. **Pull-in symlink (the load-bearing bit):**
   `/etc/systemd/system/docker.service.wants/zprime-stack.service →
   ../zprime-stack.service` — created BY HAND because the unit is static.
   A static unit ignores `systemctl enable`; the first reboot drill proved
   the missing symlink (warm-up never fired, app came back with EMPTY
   BACKUP_* env). Re-check after any systemd surgery:
   `systemctl list-dependencies docker.service | grep zprime`.
5. A short-lived `zprime.user.service` glue unit (cross-bus ordering anchor)
   was installed then deliberately disabled + its file deleted — the
   user-manager timer can't be ordered against system docker.service from a
   system-bus unit; the 02:30 `zprime-backup.timer` (user) runs fine as long
   as you log in, which has already been the observed pattern (it never ran
   unattended anyway).

Verify after a reboot (one-shot script: `bash ~/zprime-boot-verify.sh`,
13 checks, exit 0 = PASS):

```bash
systemctl is-enabled docker docker.socket   # enabled
systemctl is-active zprime-stack.service    # active (exited) = warm-up ran
docker compose ps                           # 4 containers Up healthy
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/   # 200
docker exec zprime-app-1 env | grep BACKUP_ # all 3 rig mock URLs present
```

Drill history: reboot #1 (pre-FIX) failed 6/13 — app container came back
`Exited` with empty env because the static unit was never pulled in; after
the symlink, the start path re-verified 13/13 (app 200, all three envs
restored by the warm-up). In-session `systemctl restart docker.service`
did NOT re-fire the wants chain (BusyBox-style timeout on stop) — only a
fresh boot or explicit `systemctl start zprime-stack.service` does.
Operator accepted the state without a second live reboot (2026-10-09) —
next real reboot is the final proof.

## Transaction guarantees (R-89, 2026-10-10 docs-only follow-up)

Summarised from the audit in `R-89_INVESTIGATION.md` — the voucher write path
promises the following, enforced in code + suites and verified live on the
running rig (live probes, scratch company data):

1. **Atomicity** — every voucher mutation (create/edit/accept/cancel/uncancel/
   delete) is ONE database transaction; the audit event rides the same
   transaction. A failed posting leaves NO partial state (body, counter draw
   and event all roll back together). Probe: unbalanced voucher rejected with
   a clean 400, Day Book row count unchanged.
2. **Dr = Cr always** — a voucher that does not balance to the paisa is
   rejected (±0.004 dust tolerated per the documented rule; ±0.01 rejected).
   Probe: 0 unbalanced vouchers across all live posted rows.
3. **Race-safe numbering** — voucher numbers come from a counter row advanced
   under `UPDATE … RETURNING` row lock with FY-bucket scoping; a unique index
   is the final authority. Probe: 24 concurrent auto-numbered saves → 24
   distinct contiguous numbers, zero collisions.
4. **Idempotent creation** — the same `x-idempotency-key` header identifies
   ONE business event; replays (even 8 concurrent) return the original
   voucher instead of posting a duplicate.
5. **Paisa precision** — all monetary arithmetic is 2-dp integer-safe
   (`r2()`); probe: 1100.10 round-trips float-exact.
6. **Company isolation (R-03)** — every voucher read/write is behind company
   membership; a foreign-company id resolves to a neutral 404 (no existence
   leak). Probe: cross-company fetch → 404.
7. **Bill-wise & stock integrity** — party ledgers serialise under FOR UPDATE
   (deadlock-free, sorted by id); against-allocations must match sign, stay
   ≤ the open bill, and settled bills can never be resurrected on
   cancel/delete; stock mutations replay a chronological chain and are
   rejected when the AFTER-chain has more invalid steps than the BEFORE
   (same guard shared by the XML import path).

Known benign observations (F-89-1/F-89-2, no action): auto-numbering's
burn-on-collision retry cap is 5 attempts under pathological contention
(returns 409, no corruption); OPTIONAL-draft detail reads pay one extra
`nextNumber` peek query.

### Other standing machine facts (continued)

- `~/.cache/ms-playwright` Chromium at
  `chromium-1148/chrome-linux/chrome`; export `CHROME_PATH=` to it when the
  playwright suites run.
