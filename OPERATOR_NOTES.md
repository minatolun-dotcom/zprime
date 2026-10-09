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
- Reboots wipe the compose test rig's env — recreate the app with all three
  `BACKUP_DRIVE_ENDPOINT/BACKUP_OAUTH_ENDPOINT=http://mock-drive:3309` and
  `BACKUP_AUTHORIZE_ENDPOINT=http://localhost:3309`, else backup suites
  silently hit real Google.
- `~/.cache/ms-playwright` Chromium at
  `chromium-1148/chrome-linux/chrome`; export `CHROME_PATH=` to it when the
  playwright suites run.
