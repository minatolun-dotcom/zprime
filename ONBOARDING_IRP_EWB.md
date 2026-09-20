# ONBOARDING_IRP_EWB.md — e-Invoice & e-Way Bill Connectivity Runbook

The operator-facing guide to zprime's NIC connectivity (R-28…R-31): submitting **e-invoices** (IRP, B2B), **e-way bills from IRN** (B2B), and **direct e-way bills** (EWB-API, B2C — no IRN needed), plus the full EWB lifecycle (vehicle update, validity extension, cancellation).

Without any credentials, zprime still **generates and downloads** the NIC JSON payloads (R-24/R-25) for manual portal upload — connectivity is entirely opt-in. This runbook takes you from zero to a proven first submit, per environment.

---

## 1. Prerequisites (before touching zprime)

1. **Portal API access.** The taxpayer (your GSTIN) must have API access enabled on each portal you intend to use:
   - **e-invoice IRP** (e-invoicing) — enabled via the e-invoice portal (einvoic1.gst.gov.in) or your GSP.
   - **EWB system** (e-way bill API, ewaybillgst.gov.in) — a *separate* registration from e-invoicing, even for the same GSTIN. Direct e-way bills (B2C) require this; B2B-only usage does not.
2. **Credentials collected per portal:**
   - IRP: `clientId`, `clientSecret`, `username`, `password`.
   - EWB-API (only for direct e-way bills): `ewbUsername`, `ewbPassword` (the ewaybillgst.gov.in API username/password).
3. **Public key(s).** Each system encrypts your secrets with ITS RSA public key:
   - Download the relevant public key from the portal (typically issued as a certificate); convert to PEM if needed: `openssl x509 -inform DER -in nic_public_key.cer -pubkey -noout > nic_public_key.pem`.
   - Keep the PEM text handy — you will paste it into Company Settings (per environment) or set it as an env default.
4. **A 32-byte encryption key for zprime's credential storage** — `IRP_ENC_KEY` in `.env`:
   ```bash
   openssl rand -base64 32   # put the output in .env as IRP_ENC_KEY=...
   docker compose up -d      # recreate the app so the env applies
   ```
   zprime **refuses to boot** once any company stores credentials and this key is missing/invalid (R-09 posture). **`IRP_ENC_KEY` is part of your disaster-recovery set:** a backup restored without the same key cannot decrypt stored credentials (the honest failure is at submit time; delete + re-enter credentials to recover).

---

## 2. Hosts (what goes in "Endpoint override")

zprime never guesses a production hostname — unknown host = honest refusal with guidance.

| System | Environment | Host zprime uses | Where it comes from |
|---|---|---|---|
| IRP (e-invoice + IRN-born EWB) | sandbox | `https://einv-apisandbox.nic.in` (built-in default) | NIC sandbox — nothing to configure |
| IRP | production | **explicit endpoint override required** | your IRP/GSP's production base URL (varies by IRP/GSP) |
| EWB-API (direct EWBs + lifecycle) | sandbox **and** production | **explicit endpoint override required (always)** | NIC EWB-API host or your GSP's EWB host |

The single override field is shared by both systems (documented R-30 limitation): the CI mock serves both URL families under one host; in production, point the override at the host your GSP documents (a GSP adapter typically fronts both portals; a direct-NIC setup fronts `ewaybillgst.gov.in`'s API host for the EWB system and your IRP's host for e-invoicing — if your IRP and EWB hosts differ, run production submissions against one and switch the override for the other, or front both with a single GSP adapter).

---

## 3. Company Settings setup (per environment)

Company Settings → **IRP / e-Way Bill Connectivity**. The sandbox/production toggle selects which credential row you are editing — each company has one row per environment.

1. Pick the environment tab (start with **sandbox**).
2. Fill: Client ID, GSTIN (exactly 15 chars — the credential row is GSTIN-scoped), Username, Client Secret, Password.
3. Paste the **IRP Public Key PEM** (portal download; alternatively set `IRP_NIC_PUBLIC_KEY` in `.env` as a fleet-wide default — the per-company value wins).
4. Set the **Endpoint override** (see the host table above — mandatory for production and for any EWB-API use).
5. *Direct e-way bills only:* fill the **EWB portal** pair (username + password). Leave the pair blank to keep any stored pair unchanged (the retype rule: stored secrets show only their last 4 digits — retype to rotate, leave blank to keep).
6. **Save IRP credentials.** Read-back is masked (last 4 only) — zprime never re-displays a stored secret.
7. Repeat under the **production** tab when your production credentials arrive. Deleting a row (per environment) is immediate and does not touch submitted records.

---

## 4. First-submit smoke test (sandbox, disposable books)

Prove the whole setup before touching real books:

1. Create a test company (e.g. "Sandbox Test Co") with your sandbox GSTIN, address, and pincode — e-invoice/EWB payloads validate seller address+pincode all-at-once.
2. Add a B2B buyer ledger (GSTIN + address + state + pincode) and an item with HSN + GST rate.
3. Post an inter-state Sales voucher (e.g. ₹1,000 + IGST 18%).
4. Reports → GSTR-1 → the B2B row → **submit** → expect the green banner *"e-invoice accepted — IRN …"*. Failures surface verbatim NIC errors in an amber banner (see §5).
5. **ewb-gen** on the same row → *"e-way bill accepted — EWB …"* (the e-way bill born from the IRN — no Part-B needed; add vehicle via **ewb-veh**).
6. For direct EWB (B2C): create a B2C party (no GSTIN, but address + state + pincode), post a Sales voucher, and use the **ewb** action on the B2C row → *"e-way bill (direct) accepted"*.
7. Lifecycle drill: **ewb-veh** (vehicle update) → **ewb-ext** (validity extension — once per EWB ever, 8-h window) → **ewb-can** (cancel — 24-h window, remark required). After a cancel the birth action returns (the EWB is honestly retired; the record is kept verbatim).
8. Every attempt (success AND failure) is recorded verbatim: voucher-level history in the GSTR-1 row/Audit trail, ops rows in the `irp_ewb_ops` ledger.

Once steps 4–8 pass in sandbox, repeat the setup under the production tab with production credentials — the workflow is identical.

---

## 5. NIC error-code decode (what the amber banner means)

zprime shows NIC's errors verbatim (they are part of the legal record). The common classes:

| Code class | Meaning | Operator action |
|---|---|---|
| 3001 / 3011 / 4002 | payload validation (missing/invalid field) | fix the master data the message names (party pincode, item HSN, vehicle no…) and retry |
| 3xxx auth (auth failed / invalid token) | credentials or public key wrong, or token expired | zprime re-authenticates automatically per session; persistent failures → re-check credentials + public key for THAT environment |
| 3095 | duplicate submit (NIC blocks resubmission of the same document ~1 h) | wait; zprime's own idempotency makes accidental resubmits return the stored result locally with **zero** network calls — this code means a *different* client submitted the same document |
| 3105 | outside the 24-h cancellation window | the EWB can no longer be cancelled on the portal; the record stays verbatim |
| 3120 | already extended once | NIC rule — one extension per EWB ever; generate a fresh EWB for the remaining movement |
| 382 | EWB expired at extend time | extension window is 8 h before → 8 h after expiry; outside it, a fresh EWB is required |
| transport/decrypt ("unreachable", "non-JSON") | host/override wrong or network down | check the endpoint override and the host's reachability; nothing was submitted — retry is safe |

A rejected submit (Status 0 with error details) marks the row `rejected` — fix and retry; a transport failure marks it `error` — also retryable. Neither consumes the voucher's submission slot; an *accepted* record is permanent and only a cancellation changes it.

---

## 6. Credential rotation & revocation

- **Rotate any secret** via the retype rule: type the new value over the masked field and Save. Stored-but-unchanged pairs (left blank) are preserved — no churn.
- **Revoke a compromised environment:** Settings → the environment tab → Remove credentials. The row is deleted immediately; previously submitted IRN/EWB records are retained (they are legal records and are never deleted).
- **Rotate `IRP_ENC_KEY`:** delete all stored credential rows first, rotate the key in `.env`, recreate the app, re-enter credentials. (A key change with stored rows makes them undecryptable by design — authenticated encryption refuses wrong keys rather than failing silently.)

---

## 7. Where the records live

- `irp_submissions` — one row per (voucher, kind): verbatim request/response, IRN/ack, EWB number + validity, status (`pending`/`accepted`/`rejected`/`error`/`cancelled`). Accepted rows are immutable legal records.
- `irp_ewb_ops` — every lifecycle op attempt, verbatim, success AND failure (R-29).
- `irp_credentials` — per company + environment, secrets AES-256-GCM encrypted at rest (`lib/crypto.ts`). Secrets never appear in logs or API responses (masked last-4 only).

See also: `README.md` (deployment + backups), `PROJECT.md` §Connectivity (architecture).
