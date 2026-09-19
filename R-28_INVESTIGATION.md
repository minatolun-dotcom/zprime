# R-28 Investigation — zprime v1.26.0 · Live IRP/EWB Connectivity

**Status:** investigation complete — implementation NOT started (per protocol).
**Verdict:** `R-28 CONFIRMED — GENUINE PRODUCT GAP, FULLY SCOPED` (not a defect: R-24/R-25's stateless posture was an approved scope decision; this R-item deliberately changes it, opt-in).
**Baseline:** HEAD `3e0fb41c5e46edeb9c56b718ca567bdc556658a6` = tag `v1.26.0`; working tree clean except the five ledger docs recording the v1.26.0 release (ride with the next commit, per convention) and the intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md`. No source, test, migration, or doc file modified for this investigation.

---

## 1. Executive Summary

v1.23.0 (R-24) and v1.25.0 (R-25) gave zprime **e-invoice (NIC v1.01) and e-way bill (EWB-01) payload generation** — but deliberately stateless: the operator downloads JSON and uploads it to their portal by hand. The service header states the posture explicitly: *"zprime does not talk to the IRP/GSP network, holds no credentials, and accepts no callbacks."*

R-28 proposes the opt-in next step: **zprime submits those same payloads to the IRP/EWB system itself** — storing per-company credentials encrypted at rest, managing the NIC authentication-token lifecycle, persisting IRN/acknowledgements (a legal requirement: *"an invoice without IRN will not be a legal document"*), and enforcing idempotency so no voucher is ever submitted twice (NIC blocks users who fire duplicate transactions for one hour).

Everything additive: the R-24/R-25 generate + download paths remain unchanged and credential-free. A deployment that never configures credentials behaves exactly as v1.26.0 does today.

## 2. Current State (verified against v1.26.0 source)

| Surface | State |
|---|---|
| `services/einvoice.ts` | NIC v1.01 payload from `voucherGst()` + shared `supplyLines()` projection; strict all-at-once validation; stateless |
| `services/ewaybill.ts` | EWB-01 Part-A/Part-B from the same projection; stateless |
| Server HTTP client | **None** — zero outbound calls anywhere (`grep fetch/axios/undici/http.request` → nothing). Node 22 → global `fetch` available, no new dependency needed |
| Crypto | **None in use** — Node `crypto` stdlib covers everything the NIC wire format needs (AES-256-ECB for SEK/payload, RSA PKCS#1 for password/AppKey), no new dependency |
| Credential storage | **None** — schema has no credentials table; no `process.env` beyond DATABASE_URL/JWT_SECRET/ADMIN_*/PORT/MIGRATIONS_DIR/CLIENT_DIST |
| CompanySettings | Page exists (client `CompanySettings.tsx`); `PUT /companies/:id` membership-gated (R-03) — the natural home for credentials UI |
| Deployment | docker-compose `.env` → environment (JWT_SECRET pattern from R-09: fail-fast in-process if missing/insecure) — the precedent for an encryption-at-rest key |
| Submissions | No IRN/ack persistence exists; audit_events (R-18) proves the same-tx event pattern |

## 3. NIC Authentication & Wire Model (grounded in official sandbox docs)

From `einv-apisandbox.nic.in` FAQs and GSP documentation:

- **Credentials:** Client-Id + Client-Secret (per PAN, shared across state GSTINs) and Username + Password (**per GSTIN** — a multi-state business has one credential set per unit; zprime's per-company storage maps cleanly onto this).
- **Auth handshake:** the calling app generates a random 32-byte **AppKey** (AES key); the request carries base64(AppKey RSA-encrypted with the NIC public key, `RSA/ECB/PKCS1Padding`) and base64(password RSA-encrypted). The response returns `{ Authtoken, Sek (AES-256-ECB-encrypted WITH the AppKey), ExpInHrs, ValidUntil }`.
- **Token lifecycle:** valid **6 hours production / 1 hour sandbox**; re-requesting returns the SAME token until expiry; `ForceRefreshAccessToken` is for the 10-minutes-before-expiry window. Best practice (their words): **store token + SEK + expiry and reuse** — which shapes our session-cache design.
- **Payloads:** every POST body is AES-256-ECB/PKCS5-encrypted with the decrypted SEK; responses are SEK-encrypted and must be decrypted with the same SEK.
- **Anti-abuse:** firing the same transaction multiple times → the system **blocks the user for one hour** → idempotency guard is a hard correctness requirement, not a nicety.
- **EWB from IRN:** a dedicated API generates the e-way bill **from the IRN + Part-B** — the natural chaining once an e-invoice is registered.

## 4. Proposed Scope (Option A — your approval needed)

**Migration `0012_r28_irp_connectivity.sql` (additive):**
- `irp_credentials` — one row per company (unique company_id): environment (`sandbox`/`production`), clientId, clientSecret (encrypted), gstin, username, password (encrypted), endpoint override (for mock/test IRPs), appKey material NOT stored (regenerated per session), actor provance (R-17 pattern), timestamps.
- `irp_submissions` — companyId FK, voucherId FK (set null preserves history), kind (`e-invoice`/`ewaybill`), status (`accepted`/`rejected`/`error`), irn, ackNo, ackDate, irpResponse JSON **verbatim**, error JSON, requestedBy actor, timestamps; index (companyId, createdAt). Written in the SAME transaction as the state it records (R-18 pattern).

**`lib/crypto.ts`:** AES-256-GCM encrypt/decrypt for credentials at rest, key from `IRP_ENC_KEY` env (32-byte, base64) — **fail-fast at boot if credentials exist and the key is missing** (R-09 posture). GCM (authenticated) for OUR storage; NIC's ECB is their wire format only. Masking helper: responses never return plaintext secrets.

**`services/irp.ts`:** per-company+environment session cache (token + decrypted SEK in memory, expiry-aware, ForceRefresh window); wire-format encrypt/decrypt; `submitEInvoice(companyId, voucherId)` (re-projects `eInvoicePayload()`, hard idempotency check: a voucher with an accepted submission is refused without a network call); `submitEwayBillFromIrn(voucherId, partB)`; `getByIrn`. Every response stored verbatim in `irp_submissions`.

**Routes (all cid-gated, non-member → 404):** `POST /reports/einvoice/:voucherId/submit`, `POST /reports/ewaybill/:voucherId/submit`, `GET /reports/submissions?voucherId=`, credentials PUT/DELETE under company settings (masked reads).

**Client:** CompanySettings IRP section (masked form, environment toggle); GSTR-1 e-inv/e-way cells gain "submit" beside "generate"; status chip (IRN/ack) + submission history on the voucher.

**Tests:** in-suite **mock IRP server** (real HTTP: auth → token/SEK, generate → encrypted response, error catalogue, duplicate-submit block simulation); +~30 Python checks (handshake, encrypted-at-rest DB proof, no-credential-leak in any response, idempotency replay refusal, EWB-from-IRN, membership 404s, R-24/R-25 download paths byte-unchanged without credentials); `r28_ui.js` ~12 checks.

**Proposed release: v1.27.0 — "IRP connectivity foundation (sandbox-safe)".**

**Blast radius:** one additive migration, one new service + crypto lib, four routes, two UI surfaces. No accounting math, no posting engine, no existing report keys, no change to generate/download behavior. The one posture change — talking to a network, storing credentials — IS the feature and is opt-in.

## 5. Risks & Honest Limitations

1. **NIC endpoints/keys are portal-gated** (sandbox credentials require a notified taxpayer/GSTIN registration). zprime cannot obtain universal test credentials → the implementation ships with the mock IRP for CI and an endpoint-override field so an operator with real sandbox credentials tests in their own environment. Public-key PEM supplied via env/config, never hardcoded.
2. **Duplicate-submission 1-hour block** → the idempotency guard ships in the same commit and is regression-proven.
3. **Credential storage is the security-critical surface** — GCM + env key + masked reads + no-logging, each with a dedicated check; the `secrets*` gitignore discipline continues.
4. **Legal duty to persist IRN** → `irp_submissions` is the compliance answer; submission history is not deletable once accepted (documented).
5. **Out of scope (documented):** GSP-intermediary flows beyond endpoint config, QR/signature rendering, IRN-cancellation API (additive later), auto-retry queues, GSTR-1/3B portal upload APIs, production credential procurement.

## 6. Non-Bugs Verified

- "zprime doesn't submit to IRP" is **NOT A BUG — VERIFIED**: it was the explicitly approved R-24/R-25 Option-A posture, documented in both service headers and both releases' ledger entries. R-28 supersedes it by decision, not by defect.

---

**Decision requested:** approve Option A (foundation as scoped), adjust (e.g. EWB-from-IRN deferred), or reject. On approval → IMPLEMENTATION per protocol.
