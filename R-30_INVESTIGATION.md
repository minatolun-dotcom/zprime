# R-30 Investigation — zprime v1.28.0 · EWB Deepening (Direct Generation)

**Status:** investigation complete — implementation NOT started (per protocol).
**Verdict:** `R-30 CONFIRMED — GENUINE PRODUCT GAP, FULLY SCOPED` (not a defect — the approved deepening of R-28/R-29's EWB story).
**Baseline:** HEAD `a1b7d9bb0f6a5ce1c323dd260b3152f17c80b7c0` = tag `v1.28.0` (pushed); working tree clean except this report, the CONTINUE.md handoff, and the five ledger docs recording v1.28.0 (ride with the next commit). The intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md` is untouched.

---

## 1. Executive Summary

R-28 gave zprime **IRN-born EWBs** (generate from an accepted e-invoice); R-29 gave those EWBs a full lifecycle. Both paths share one hard precondition: an **accepted e-invoice**, which only exists for B2B supplies (buyer GSTIN mandatory). The deepening gap: a **B2C sale above ₹50,000 legally requires an e-way bill** (Rule 138 — movement of goods, regardless of buyer registration), and zprime cannot produce one today — `ewaybillPayload()` refuses without a buyer GSTIN, and the IRN path is B2B-only by law.

R-30 proposes **direct EWB generation** (NIC EWB-API `GENEWB`, non-IRN) for vouchers that are EWB-eligible but not IRN-eligible — the classic case being the inter-state B2C invoice. The wire work reuses the R-28 envelope almost entirely; the genuinely new pieces are (a) a **separate EWB-portal credential set** (the EWB system is a different NIC portal with its own auth) and (b) the direct payload's mandatory address/pincode fields, for which source data already exists (R-24 groundwork) but must be honestly validated.

## 2. Baseline Integrity

- `git rev-parse HEAD` → `a1b7d9bb0f6a5ce1c323dd260b3152f17c80b7c0` = `v1.28.0^{}` ✓
- `git describe --tags` → `v1.28.0` ✓; remote `origin/main` matches (pushed at release)
- No source/test/migration changes made during this investigation.

## 3. Current EWB Surface (v1.28.0)

| Capability | State | Path |
|---|---|---|
| EWB birth from IRN | DONE (R-28) | `GENEWB` with `irn` in payload, from accepted `irp_submissions` (kind=e-invoice) |
| EWB vehicle update | DONE (R-29) | `VEHEWB`, repeatable, ops-ledgered |
| EWB validity extension | DONE (R-29) | `EXTENDVALIDITY`, once-ever, 8-h window |
| EWB cancellation | DONE (R-29) | `CANEWB`, 24-h window, remark required |
| **Direct EWB (no IRN)** | **MISSING** | `ewaybillPayload()` (services/ewaybill.ts) demands `party.gstin`; nothing else fills the gap |
| Transporter assignment | MISSING | `UPDATETRANSPORTER` — niche; see scope options |
| EWB fetch/print | MISSING | `GETEWBBYNO` — nice-to-have; stored verbatim response already covers re-viewing our own EWBs |

## 4. The Regulatory Gap (grounded)

- **Rule 138 / EWB rules:** an e-way bill is required for movement of consignments valued above ₹50,000 — the obligation attaches to the **movement**, not the buyer's registration. Inter-state B2C sales (and branch transfers, when zprime grows them) are squarely in scope.
- **NIC EWB API v1.03** (`docs.ewaybillgst.gov.in/apidocs/version1.03`) is a **separate system** from the e-invoice IRP:
  - different portal, different credentials (EWB-portal username/password — 2FA-eligible),
  - auth: `AUTHTOK` + `SEK` with the same RSA-public-key / AES-256 pattern and ~6-h token life as the IRP flow (mastergst EWB API reference, Vayana GSP docs),
  - `GENEWB` direct payload (no IRN): `userGstin`, `supplyType`, `subSupplyType`(+`subSupplyDesc`), `docType`/`docNo`/`docDate`, from/to blocks (name, `addr1`, stateCode, **pincode**; `gstin` optional for B2C), item list (productName, hsnCode, qty, unit, taxableValue, rate…), and `vehicleList` (`vehicleNo`, `fromPlace`, `fromStateCode`, `transMode`).
- The Ship-To advisory from R-29 (GSTN Advisory 661, mandatory since 2026-08-01) applies to Part-A here too — implementation-time payload check, not silently ignored.

## 5. Data Availability Audit (the honest part)

| Direct-payload field | Source | Status |
|---|---|---|
| `userGstin`, from-state | `companies.gstin` / `stateCode` | present (R-24 proven) |
| `docType/docNo/docDate` | voucher + voucher type | present |
| from addr1/pincode | `companies.address` / `companies.pincode` | **exist but optional** — must honestly refuse when blank |
| to name/stateCode | `ledgers.name` / `partyState` | present |
| to GSTIN | `ledgers.gstin` | optional — legitimately absent for B2C |
| to addr1/pincode | `ledgers.partyAddress` / `partyPincode` | **exist but optional** (R-24 groundwork) — must honestly refuse when blank |
| items (HSN, qty, value, rate) | R-25 payload aggregation | proven — reusable as-is |
| vehicle block | R-28 `EwaybillParams` | proven |

So: **no schema additions are needed for payload data**. The only schema question is the credential set.

## 6. Credential Model (the genuinely new decision)

`irp_credentials` is scoped to the e-invoice portal (`username`/`passwordEnc` + client id/secret). Direct EWB needs a **second credential set**. Two additive shapes:

- **(a) sibling columns** on `irp_credentials` (`ewb_username`, `ewb_password_enc`) — one row per company/env, simplest, matches "one connectivity panel";
- **(b) new table `ewb_credentials`** — cleaner separation, two panels.

Recommendation: **(a)** — the masking/read-back/encryption machinery (`crypto.ts`, last-4 routes) is row-shaped today; adding nullable columns is the smaller blast radius and the UI can present it as a second section of the existing panel. Both shapes are additive and safe.

## 7. Security / Concurrency Review

- All new routes cid-gated like R-28/R-29 (404 for non-members; `req.userId` only).
- Idempotency: direct EWB is still `kind='ewaybill'` on `irp_submissions` — the existing partial-unique design carries over **unchanged**; a concurrent second GENEWB loses on the insert.
- R-29 lifecycle ops apply to direct EWBs **as-is** (they operate on the accepted row; nothing in the ops code cares how the EWB was born). This is the payoff of R-29's design.
- Credential storage reuses AES-256-GCM + boot-time fail-fast (R-09 posture) verbatim.
- No accounting math, no posting engine, no migration of accounting data. GENIRN/GENEWB-from-IRN paths byte-unchanged.

## 8. Scope Options

**Option A — full deepening (~v1.29.0):**
1. Migration 0014: `ewb_username`/`ewb_password_enc` on `irp_credentials` (additive, nullable).
2. `services/ewaybillDirect.ts` (or extension of ewaybill.ts): direct payload builder with all-at-once honest validation (address/pincode gaps listed together, R-24 style).
3. `services/irp.ts`: EWB-portal session (AUTHTOK/SEK, 6-h cache — parallel to the IRP session, keyed separately), `generateEwbDirect()`.
4. Routes: `POST /reports/ewaybill/:voucherId/generate-direct` (+ credential PUT/GET/DELETE extension for the EWB section).
5. UI: CompanySettings EWB-credentials section; GSTR-1/Sales rows get a birth action for EWB-eligible-but-not-IRN-eligible vouchers (B2C).
6. Mock IRP: `genewb` direct endpoint (self-keyed sidecar already shipped in R-29).
7. Tests: ~24 Python (happy path, honest refusals for missing address/pincode, idempotency, cross-company 404, lifecycle interplay) + ~10 browser.

**Option B — reduced:** items 1–5 only for the core gap (direct GENEWB); defer transporter/print. **Recommended** — UPDATETRANSPORTER is niche (we assign our own transporters at birth), and GETEWBBYNO adds little given the verbatim stored response.

**Option C — postpone:** R-28/R-29 already cover B2B fully; B2C EWBs could wait for real operator demand. Honest, but the inter-state B2C case is common enough that the gap will bite.

## 9. Non-Bugs Verified

- `ewaybillPayload()` refusing without buyer GSTIN is **correct** for the IRN path (e-invoices are B2B-only) — NOT A BUG — VERIFIED. The gap is that no *other* path exists; that is the R-30 scope, not a defect.
- R-29 ops working uniformly on IRN-born and (future) direct-born EWBs: verified by design inspection — ops are row-shaped, not birth-path-shaped.

## 10. Out of Scope

- Branch-transfer/stock-transfer vouchers (no such voucher type exists yet — would be a new feature, not deepening).
- Consolidated EWBs (multiple consignments), EWBs assigned by transporters.
- Print/PDF rendering (browser print of the stored response is adequate).
- Any change to accounting or GST calculation logic.

## 11. Final Recommendation

Proceed with **Option B (recommended)** or Option A on your instruction. Blast radius is low: one additive migration (nullable credential columns), one new service path + session cache parallel to the existing one, 2–3 cid-gated routes, honest validation, mock + test extensions. Proposed release: **v1.29.0**.

The decision is yours: approve Option B, upgrade to Option A, adjust, or reject/postpone.
