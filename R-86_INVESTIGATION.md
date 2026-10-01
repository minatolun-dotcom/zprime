# R-86 Investigation — Can the Google Drive connect be made one-click (UpdraftPlus-style)?

**Status: COMPLETE — awaiting operator decision. Zero production code.**
**Trigger (operator, 2026-10-02):** *"when using updraft plus, you just select google drive and it just opens selection of google account and authentication for google drive and its done. this is just too many step, is there a way to simplify it while still not relying on other external tools like rsync or rclone but builtin tools. research it and document it properly and report it back to me"*
**Baseline:** v1.74.0 (commit `0fb0484`, tag `v1.74.0`). R-85 S2 is live and **working in production on the operator's own deployment** (connected 2026-10-01, first manual backup verified: pair uploaded, sha256 recorded, connect/backup rows in `backup_runs`).

---

## 1. What UpdraftPlus actually does (evidence, not folklore)

The operator's reference point is UpdraftPlus. I fetched its public WordPress plugin source
(`plugins.svn.wordpress.org/updraftplus/trunk/methods/googledrive.php`, 1,861 lines, read this session)
and read the connect path directly.

### 1.1 The built-in app is a hosted relay — the middleman R-85 rejected

Hardcoded in their source:

```php
$this->client_id = '916618189494-u3ehb1fl7u3meb63nb2b4fqi0r9pcfe2.apps.googleusercontent.com';
$this->callback_url = 'https://auth.updraftplus.com/auth/googledrive';
```

- Their **built-in app is UpdraftPlus's own Google OAuth client**, and the consent redirect goes to
  **`auth.updraftplus.com` — a server UpdraftPlus (TeamUpdraft) operates** — which forwards the
  authorization code back to the WordPress site. Their own settings template shows a privacy-policy
  disclosure for exactly this ("Please read this privacy policy for use of our Google Drive
  authorization app (none of your backup data is sent to us)").
- **Their "expert" path is precisely zprime's current flow**: their template prints
  "Follow this link to your Google API Console… create a Client ID… You must add the following as the
  authorised redirect URI: `<site>/wp-admin/?action=updraftmethod-googledrive-auth`". Every WP site
  must even use a **separate Google project** ("you cannot re-use your project… for each site").
- So the honest comparison is: **zprime today = UpdraftPlus's expert path, minus nothing.**
  The one-click path exists *only because a third party runs a relay*.
- R-85 already rejected this on the record: a vendor-hosted OAuth relay **contradicts the
  self-hosted / no-phone-home posture** and the documented threat model (the operator's backup
  metadata — file names, sizes, timing, folder — would flow through someone else's server).
  UpdraftPlus mitigates it contractually ("none of your backup data is sent to us"), not architecturally.
- zprime is **self-hosted by design**; its operator *is* the administrator. A relay would put a
  third party inside the backup trust chain of every deployment — a permanent liability purchased
  to remove a one-time 10-minute setup.

### 1.2 The other "it just works" precedent (rclone) is being retired by Google

rclone — the tool the operator explicitly does not want to require — historically shipped a
**shared built-in client_id**, its own one-click story. From rclone's official Drive docs
(rclone.org/drive/, fetched 2026-10-02):

> "Leave blank to use rclone's shared client_id… **The shared client_id is being retired and will
> stop working during 2026**, so creating your own is now strongly recommended."

rclone is telling its entire user base to migrate to **exactly the flow zprime v1.74.0 already has**
(create your own client ID). Google's direction of travel is against shared/embedded clients;
building zprime's one-click on a shared client in 2026 would be building on a deprecated cliff edge.

### 1.3 Is there any Google API to create the OAuth client for the user? — No

- OAuth client creation is **console-only**. The only programmatic path ever exposed was
  `gcloud iap oauth-clients create` (Identity-Aware Proxy specific), which Google's own docs now
  mark **deprecated** ("should not be used for new IAP setup").
- There is no API by which zprime could create a Google project + OAuth client on the user's behalf.
  Any "fully automatic" connect must therefore ride on a **pre-existing** client — i.e. a relay
  (§1.1) or a shared/embedded client (§1.2, retiring).

### 1.4 Google platform facts that bound the solution space

Fetched from official Google documentation this session:

| Fact | Source | Consequence for zprime |
|---|---|---|
| `drive.file` is a **non-sensitive** scope | developers.google.com/workspace/drive/api/guides/api-specific-auth | No security assessment, no restricted-scope verification — the lightest possible regime. But non-sensitive ≠ auto-approved (see next row). |
| Any app in production that hasn't completed verification shows the **"Unverified app"** interstitial | support.google.com/cloud/answer/7454865; developer reports confirm even `drive.file`-only apps see it | The **Advanced → Go to zprime (unsafe) → Allow** click is unavoidable for a self-created personal app. This is Google's designed self-use path. |
| Verification status is **per OAuth client** (per Google project) | Cloud console model | Verification could only ever be completed by a **specific, named publisher** — impossible for a general-distribution self-hosted app (each deployment would still need its own project anyway). |
| `http://localhost` redirect URIs are permitted (Google-exempt from HTTPS); **the redirect URI must match exactly**; up to 100 URIs per client | OAuth docs + WorkOS analysis of Google's strict matching | The current fixed callback works for every localhost deployment without any Google-side edits. |
| Loopback **IP** flow (`127.0.0.1`) is being deprecated by Google (MITM concerns); `localhost` remains the supported spelling | developers.google.com/identity/protocols/oauth2/resources/loopback-migration | Reinforces keeping `localhost`, never `127.0.0.1`, in any redirect URI. |

---

## 2. Where the real friction is (measured on the operator's own setup, 2026-10-01)

The operator's actual connect session — which **succeeded** — consisted of:

1. Create GCP project (once, ~2 min)
2. Enable Drive API (once, ~30 s)
3. Consent screen + **publish to "In production"** (once, ~2 min) ← *the step that generated both
   support round-trips (redirect mismatch first, then the Testing-mode 403)*
4. Create OAuth client + paste redirect URI (once, ~2 min)
5. Paste client ID + secret into zprime → Connect → Google sign-in → Allow (per deployment)

**Steps 1–4 are one-time per Google account/deployment and never again** (the client survives
independent of zprime upgrades; the refresh token survives until revoked). The recurring cost is
step 5 only — which is already UpdraftPlus-parity (their flow needs a click-through too, plus their
settings-save dance). The friction the operator felt is **front-loaded into a one-time setup** —
and both of the operator's actual failures (redirect mismatch, Testing-mode 403) were **Google-side
configuration steps**, not zprime steps. No zprime-side change can remove Google's own console.

---

## 3. Options

### Option A — Decline the relay/shared-client one-click; keep native OAuth (no code change)

Keep the R-85 design. Rationale: the one-click UX is **only** achievable via a third-party relay
(UpdraftPlus model — rejected in R-85 on posture, and now empirically confirmed to be a relay by
their own source) or a shared client (rclone model — **Google is retiring it during 2026**). zprime's
current flow *is* UpdraftPlus's expert path, byte-for-byte the same steps; the operator's two
stumbling blocks were Google-console configuration, not zprime complexity.

**Cost:** none. **Risk:** none. **What it does not do:** remove the one-time GCP console work.

### Option B — Reduce the one-time setup inside zprime's control: guided wizard hardening (client-side only, ~1 release)

The GCP console cannot be automated (§1.3) and Google will always show the unverified-app
interstitial (§1.4). What zprime *can* do is make the remaining steps error-proof and fewer:

1. **Copy-paste everything as one block**: a single "Copy setup checklist" button that copies the
   project name, the Drive API link (deep link straight to the enable page:
   `console.cloud.google.com/apis/library/drive.googleapis.com`), the consent-screen steps, the
   exact redirect URI, and the client-creation deep link
   (`console.cloud.google.com/apis/credentials/oauthclient`) as a numbered checklist.
2. **Inline troubleshooting for the two known failure modes**: if the operator reports
   `redirect_uri_mismatch` or `access_denied` (the exact errors hit this session), the page shows
   targeted one-line fixes ("the redirect URI must be exactly `<callback>`"; "publish the consent
   screen to In production").
3. **Pre-checks before Connect**: disable the Connect button until clientId matches the
   `.apps.googleusercontent.com` shape and a secret is present, with a hint when disabled.
4. De-emphasize nothing security-relevant: In-production warning stays verbatim (it is the
   7-day-trap fix).

**Cost:** client-only (Backups.tsx + strings), one small release, r85_ui extended by a handful of
checks. **Risk:** negligible. **What it does not do:** the GCP console steps still exist — they are
Google's, not zprime's.

### Option C — Vendor relay with opt-out (REJECTED — do not select)

Build `auth.zprime.example`-style hosted relay so every deployment can one-click, with the current
native flow kept as "expert mode". **Rejected, and the operator should know why it stays rejected**
even though it is the only path to true UpdraftPlus parity:

- Contradicts the core product posture: self-hosted, no phone-home, the R-85 investigation's
  explicit rejection — *this investigation confirms with primary evidence that the UpdraftPlus
  one-click IS the relay* (their source, `auth.updraftplus.com`), not a Google feature zprime lacks.
- Requires operating a permanent internet service (domain, TLS, availability, abuse surface) —
  new infrastructure class for the project, a standing security target, and a trust chain where the
  relay sees every deployment's connect metadata.
- Google is simultaneously retiring shared clients (§1.2); the industry direction is *toward* the
  flow zprime already has.
- A self-hostable product shipping a mandatory-ish cloud dependency for its backup feature would
  also break the "works fully offline/airgapped" property.

### Option D — Shared/embedded client_id compiled into zprime (REJECTED — do not select)

Ship one Google OAuth client for all zprime deployments (rclone-style). **Rejected:** Google is
retiring shared client IDs **during 2026** (rclone's own docs, §1.2) — building on it now would
break every deployment within the year; Google's stated reason (quota abuse, MITM exposure) applies
equally to a shared zprime client; and it centralizes revocation risk (one Google action kills
every deployment's backups at once).

---

## 4. Recommendation

**Option B** (guided-setup hardening), with **Option A** as the honest floor if the operator prefers
zero further work. The evidence supports being explicit with the operator:

- The one-click they admire is a **third-party relay** (UpdraftPlus's own source proves it) —
  architecturally at odds with a self-hostable app, and R-85 already rejected it for cause.
- The no-tool alternative (shared client) is being **retired by Google in 2026** (rclone's docs).
- The current flow has already **worked once** on this deployment; its cost is a one-time ~10-minute
  Google-console configuration that no in-app change can eliminate, and both of the operator's
  stumbling blocks were Google-side settings with one-line fixes (which Option B bakes into the UI).

## 5. Verification plan (if Option B is approved)

Standard cycle per `DEVELOPMENT_PROTOCOL.md`: extend `r85_ui.js` (checklist copy affordance,
troubleshooting triggers, pre-check gating), full estate at baseline counts, typecheck + build,
no schema/migration, no server change → no Docker upgrade drill beyond the standard fresh-install
suite pass; release as a patch/minor per the operator's preference at approval time.

---

*Investigation-only. No production code was changed. Primary sources: UpdraftPlus plugin source
(SVN trunk, fetched 2026-10-02), rclone.org/drive, developers.google.com (scopes, unverified apps,
loopback migration), support.google.com (unverified apps), Google Cloud console capability checks
(oauthClients.create deprecated/IAP-only).*
