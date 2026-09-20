# R-31 Investigation — zprime v1.29.0 · EWB Production Variants

**Status:** investigation complete — implementation NOT started (per protocol).
**Verdict:** `R-31 CONFIRMED — GENUINE PRODUCTION-FIDELITY GAP, FULLY SCOPED` (documented R-30 limitation, now closed by design; no accounting risk — connectivity layer only).
**Baseline:** HEAD `da9e2c480e8c4c41cff8378dfa836076af604a2c` = tag `v1.29.0`; working tree clean except this report and the intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md` (plus the five ledger docs recording v1.29.0, riding with the next commit per convention). No source, test, migration, or doc file modified by this investigation.

---

## 1. Executive Summary

R-30 shipped **direct e-way bills** (non-IRN, B2C) — but its report documented one limitation deliberately left open: **lifecycle ops (veh/ext/can) for direct-born EWBs ride the e-invoice system's (eivital) endpoints**, because R-29's ops were built row-shaped and birth-path-agnostic *on purpose* — at the time, every EWB was IRN-born, so eivital was always correct.

R-30 changed that: a direct-born EWB legally lives on the **EWB-portal system (EWB-API v1.03)**, not the e-invoice system. In production, a lifecycle op sent to the wrong system's endpoint would fail with an opaque NIC error (or worse, silently target the wrong record namespace on a GSP that hosts both). The mock collapses both systems under one host, so tests cannot distinguish — **the gap is invisible in CI and would only surface in the field**.

The fix is a **birth-path routing rule**: lifecycle ops detect which system the EWB was born on and address that system's endpoints, using credentials and session machinery that R-30 already built.

---

## 2. Where the Gap Lives (code evidence)

All three R-29 ops hard-bind the **eivital** endpoints, regardless of how the EWB was born:

| Op | File:line | Endpoint today |
|---|---|---|
| `updateEwbVehicle` | `server/src/services/irp.ts:529` | `irpAction(creds, "VEHEWB", req, "/eivital/v1.10/vehewb")` |
| `extendEwbValidity` | `server/src/services/irp.ts:559` | `irpAction(creds, "EXTENDVALIDITY", req, "/eivital/v1.10/extendvalidity")` |
| `cancelEwb` | `server/src/services/irp.ts:594` | `irpAction(creds, "CANEWB", req, "/eivital/v1.10/canewb")` |

Birth path is **recoverable from stored data** — the accepted row's verbatim `response` blob carries the casing each system emitted at birth:

- **IRN-born** (R-28 `/eivital/v1.10/genewb`): response has `EwbNo` (PascalCase), `EwbDt`, `ValidUpto`.
- **Direct-born** (R-30 `/v1.03/ewayapi`): response has `ewayBillNo` (lowercase), `ewayBillDate`, `validUpto`, `alert`.

The service already tolerates both casings defensively (`resp.ewayBillNo ?? resp.EwbNo`, line 436) — so the discriminator is **additive and safe**.

One more wrinkle: a **direct-born EWB's lifecycle credentials** must be the EWB pair (`ewbUsername`/`ewbPasswordEnc` → `ewbAction` → `ewbSessions`), not the IRP pair. R-30 already built the full EWB session/transport (`ewbFetch`/`ewbAction`/`ewbSession`, lines 186–270) — routing reuses it unchanged.

---

## 3. Production Reality (grounded)

- The two systems are **separate NIC portals** with separate credentials and separate auth (R-30 grounded this: EWB-API v1.03 auth = own AUTHTOK/SEK, ~6 h, lowercase envelope).
- The published **EWB-API v1.03 surface has the same three lifecycle verbs** under `/v1.03/ewayapi` with `action` = `VEHEWB` / `EXTENDVALIDITY` / `CANEWB` (the API is action-dispatched through one endpoint, exactly like GENEWB — Chartered Information's list of EwayBill APIs confirms: Update Part-B/Vehicle, Extend Validity, Cancel e-Way Bill; NIC's own error-code list numbers them 3001/3011/382-class).
- **Payload shapes are field-compatible** with the R-29 v1.10 shapes (ewbNo, vehicleNo, fromPlace/fromState, reasonCode/remark, remainingDistance) — v1.03 uses lowercase JSON keys and lowercase response envelope (`status`/`data`/`errorDetails`), which `ewbAction` already tolerates.
- The 24-h cancel window and 8-h extend window are **portal rules**, identical in both systems — zprime's eager guards stay exactly as they are.

**Conclusion:** this is not new connectivity — it is **correct endpoint + credential selection** for EWBs that already exist in the data model.

---

## 4. Proposed Design (minimal, additive)

### 4.1 Birth-path detection (pure function, testable)

```ts
type EwbBirthPath = "eivital" | "ewayapi";
function ewbBirthPath(ewbRow: any): EwbBirthPath {
  const r = ewbRow?.response ?? {};
  return r.ewayBillNo != null ? "ewayapi" : "eivital";
}
```

Fallback is `eivital` — every pre-R-30 EWB row (which can only be IRN-born) and any row whose response predates R-30 keeps today's behavior byte-for-byte.

### 4.2 Routing table (in `EwbCtx`)

`loadAcceptedEwb` gains one derived field:

```ts
interface EwbCtx { creds: IrpCredsRow; ewbRow: any; ewbNo: string; birth: EwbBirthPath }
```

Each op then selects the dispatcher:

```ts
const wire = ctx.birth === "ewayapi" ? ewbAction : irpAction;
const resp = await wire(creds, ACTION, req, pathFor(ctx.birth, ACTION));
```

where `pathFor` maps: `eivital` → `/eivital/v1.10/{vehewb,extendvalidity,canewb}` (unchanged), `ewayapi` → `/v1.03/ewayapi` (the single action-dispatched endpoint; `action` carries the verb).

### 4.3 Credential resolution (the one real decision)

- `ewayapi`-born: creds **must** be the EWB pair — `ewbAction` already fails fast with R-30's honest message when the EWB credentials are missing (a direct-born EWB cannot exist without them, so this is belt-and-braces).
- `eivital`-born: unchanged — IRP creds via `loadCreds`.

No new credential columns. No schema change. **Migration: none.**

### 4.4 What does NOT change

- The `irp_ewb_ops` ledger (op names, verbatim request/response, actor) — records stay system-agnostic; the wire path is derivable from the submission row.
- All eager guards (no-accepted-EWB, once-ever extend, 24-h cancel window, reason enums, remark-required).
- Idempotency, masking, routes' shape and error mapping.
- UI: zero changes — the veh/ext/can buttons already work; only the wire they fire on changes.

---

## 5. NOT A BUG — VERIFIED (discipline items)

1. **`irpAction` used for direct-born lifecycle in v1.29.0** — correct *at release time*: it was the documented R-30 limitation, mock-verified end-to-end. R-31 upgrades fidelity; it does not repair a regression.
2. **`EwbDt` stored into `ewbValidUntil` at IRN-path birth (line 375–376)** — looks odd but is v1.10's response shape (`EwbDt` = generation date; `ValidUpto` follows for GENEWB). Behavior identical since R-28; reports surface `ewbValidUntil` only as informational. Not touched by R-31.
3. **Mock collapses both systems under one host** — correct test-infra simplification; the *discriminator* is response casing, which the mock already emits faithfully per system.

---

## 6. Scope Options

**Option A (recommended) — birth-path routing, full fidelity (≈ v1.30.0)**
- `irp.ts`: `EwbBirthPath` type + `ewbBirthPath()` + `EwbCtx.birth` + per-op dispatcher/path selection (~40 lines).
- `mock_irp.js`: teach `/v1.03/ewayapi` to speak `VEHEWB`/`EXTENDVALIDITY`/`CANEWB` (lowercase envelope, same guards: once-ever extend, 24-h cancel via `ewbBornAt`) — ~35 lines, mirrors the existing v1.10 branches.
- Tests: ~10 Python checks (per-op routing for both birth paths: correct endpoint hit, once-ever/cancel-window guards still fire, ops ledger rows carry identical shape) + ~4 browser checks (direct-born EWB lifecycle through the real UI still green — now provably on the v1.03 wire via `__stats`).
- Blast radius: **low** — no migration, no accounting math, no UI change; fallback preserves pre-R-30 behavior byte-for-byte.

**Option B — Option A + response-casing tolerance audit** (recheck every `resp.X` in the EWB paths for both casings; small hardening pass, +3 checks).

**Option C — defer** — acceptable only if no operator will run direct-born EWBs against production before the next release; the limitation stays documented.

---

## 7. Required Verification (for the chosen scope)

1. Typecheck server + client.
2. Full Python battery (existing suites must remain green; new R-31 block rides `final_regression.py`).
3. Browser battery on fresh volume (all scenario suites once; r29 + r30 suites re-prove lifecycle on both birth paths).
4. Adversarial: ops against a voucher with no accepted EWB → 400; extend-twice → eager 422 on both paths; cancel after mock-expiry → verbatim NIC error on both paths.
5. `__stats` proof: direct-born veh/ext/can hit `ewbDirectCalls`-adjacent counters (or a new `ewbVehCalls/ewbExtendCalls/ewbCancelCalls` triple) while IRN-born ops keep the eivital counters — **proving the routing, not just the happy path**.

---

## 8. Out of Scope

- Transporter-assign, multi-vehicle, consolidated EWB, print/PDF, EWB closure (NIC has them; zprime has no product surface for them yet).
- Production EWB host discovery / onboarding runbook (separate ops concern).
- Any change to accounting, GST computation, voucher state, or schema.

---

## 9. Final Recommendation

**Approve Option A.** It closes R-30's one documented limitation with ~40 lines of routing, a mock extension, and ~14 new checks — no schema, no accounting surface, full backward compatibility. Release candidate: **v1.30.0**.
