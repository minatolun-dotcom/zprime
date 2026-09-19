# R-29 Investigation — zprime v1.27.0 · EWB Lifecycle Operations

**Status:** investigation complete — implementation NOT started (per protocol).
**Verdict:** `R-29 CONFIRMED — GENUINE PRODUCT GAP, FULLY SCOPED` (not a defect: R-28 delivered the approved birth-of-EWB scope; the lifecycle half is the natural continuation).
**Baseline:** HEAD `4dc1bbc` = tag `v1.27.0`, pushed, clean tree (only the five ledger docs recording v1.27.0 + the intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md`). No source, test, migration, or doc file modified for this investigation.

---

## 1. Executive Summary

R-28 closed the *birth* of the e-way bill: generate from IRN (`GENEWB`), persist `ewb_no`/`ewb_valid_until`/verbatim response, hard idempotency. But the moment an EWB exists, an operator with a vehicle breakdown, a transshipment, or a data-entry mistake must **leave zprime** for the EWB portal — zprime cannot update the vehicle, extend validity, or cancel. The NIC API surface for exactly these three operations rides the same authenticated/encrypted action envelope R-28 already implements (`irpAction(creds, action, payload, path)`), and the schema already stores everything needed to do it safely. This is the smallest possible completion of the connectivity story: three service functions, three routes, one additive ops-ledger table, mock extensions, and a compact UI surface.

**Verdict: not a defect — the approved R-28 Option A scoped birth-only. R-29 proposes completing the lifecycle, opt-in under the same credentials/posture.**

---

## 2. What v1.27.0 actually does today (verified in source)

- `services/irp.ts` — auth handshake (AppKey/SEK AES-256-ECB, RSA PKCS#1), session cache (6h/1h), `GENIRN` + `GENEWB` actions, **hard idempotency** (partial-unique `(voucher_id, kind) WHERE status='accepted'/'pending'` + eager refusal + 10-min stale-pending self-heal), verbatim `irp_submissions` rows. `irpAction` already accepts `(creds, action, payload, path)` — a lifecycle action is a one-call addition, no new wire code.
- `irp_submissions` carries `ewb_no`, `ewb_valid_until`, `response` (verbatim JSONB), `requested_by`, `created_at`. The partial-unique design means **an EWB lifecycle op is an operation on the accepted row, not a new submission** — no idempotency rework.
- Routes: `/einvoice/:id/submit`, `/ewaybill/:id/submit`, `/submissions` — all cid-gated (404 non-members), error mapping 422/409/502 with human-readable `error` (R-28 fix).
- Mock IRP: `/eivital/v1.10/{auth,genirn,genewb}` + `__stats`/`__reject` switches.
- UI: GSTR-1 B2B rows carry `submit` (e-inv) and `ewb` (generate) actions; the `einvMsg` banner surface already renders results.

**Gap:** no `VEHEWB`, no `EXTENDVALIDITY`, no `CANEWB`, no ops history, no cancel-rebirth path.

---

## 3. NIC regulatory constraints (grounded via web research)

| Op | Action | NIC rule (source: einv-apisandbox endpoint list; GSTN advisory coverage; Rule 138 summaries) |
|---|---|---|
| Update Part-B / vehicle | `VEHEWB` | **Repeatable** — every vehicle change (transshipment, breakdown swap) is logged by NIC with a timestamp; EWB number unchanged. Payload: `ewbNo` + `vehicleNo` + `fromPlace` + `fromState` (+ optional trans doc). |
| Extend validity | `EXTENDVALIDITY` | **Only within 8 h before → 8 h after expiry** (16-h window); **one extension per EWB, ever**; requires reason enum (vehicle breakdown / law and order / accident / natural calamity / transshipment / others) + **remaining distance** (+ optionally updated vehicle). Validity recalculated from remaining distance. |
| Cancel EWB | `CANEWB` | **Within 24 h of generation only**; blocked once verified at a checkpost; only by the generator; reason enum (duplicate / data entry mistake / order cancelled / others) + remark. The EWB number is permanently retired; a **fresh EWB must be generated** for the movement. |

Also noted (adjacent, important): GSTN Advisory 661 — **Ship-To GSTIN mandatory in EWB Part-A from 1 Aug 2026** (already in force; today is 2026-09-19). This affects the R-25 `GENEWB` payload path. **R-29 implementation must verify the generated payload satisfies current NIC validation** (e-invoice payload's ship-to handling) — flagged as an implementation-time check, not silently ignored.

---

## 4. Security / concurrency review

- All ops ride the existing reports-plugin cid() gate → non-members get 404; company scope enforced by resolving the submission row **by `(companyId, voucherId, kind)`** — a guessed voucher ID from another company finds nothing.
- Actor stamping: every op row records `requested_by` (R-22 pattern); credentials never appear in any request/response.
- Idempotency semantics preserved: ops never create `irp_submissions` rows; the accepted-row unique index stays the single birth-control mechanism.
- **Cancel-rebirth (the one behavior change):** cancelling flips the accepted EWB row's status `accepted → cancelled` (row retained verbatim — the legal record is not deleted; same posture as `cancelled_by` vs deletion). This correctly re-opens `(voucher_id,'ewaybill')` so a fresh GENEWB can be born. Attempting ops on a cancelled EWB is refused eagerly (no network call).
- **Eager guards (fast honest errors before NIC):** second extension ever → refuse; cancel of non-accepted/cancelled → refuse; ops on another company's EWB → impossible by lookup. The 24-h cancel window and the 8-h extend window are **time-of-day sensitive and enforced by NIC**; zprime adds an eager pre-check where deterministic (cancel vs `created_at + 24h`, using our submit time as the documented approximation) and surfaces NIC's verbatim rejection otherwise. No false "success" is ever fabricated.
- Concurrency: single-row `UPDATE … WHERE status='accepted'` guards; two simultaneous cancels → one wins, loser gets the eager refusal.

---

## 5. Proposed scope (yours to approve)

**Option A (recommended) — full lifecycle:**
1. **Migration `0013_r29_ewb_ops.sql` (additive):** `irp_ewb_ops` — `id, company_id FK cascade, submission_id FK, op (vehewb|extend|cancel), request jsonb, response jsonb, requested_by FK set null, created_at`. One ops-ledger table; verbatim persistence matches the R-28 legal posture. Plus `irp_submissions.status` gains the documented `'cancelled'` value (text column — no DDL change, CHECK-free by current design).
2. **`services/irp.ts` +3 functions:** `updateEwbVehicle`, `extendEwbValidity`, `cancelEwb` — each: resolve accepted EWB row by (company, voucher) → eager guards → `irpAction` with the NIC action → op row recorded verbatim → accepted-row fields updated (`ewb_valid_until` on extend; `status='cancelled'` on cancel).
3. **Routes:** `POST /api/c/:cid/reports/ewaybill/:voucherId/vehicle|extend|cancel` (cid-gated, same 422/409/502 error mapping).
4. **UI (minimal):** GSTR-1 B2B rows — when the voucher has an accepted EWB, show the EWB number + three link-actions (Update vehicle / Extend / Cancel) with compact prompt dialogs; results on the existing banner surface. Submission history endpoint already exposes ops via the submissions row + could list ops per voucher (small addition).
5. **Mock IRP:** 3 new endpoints with the same SEK-encrypted envelope + `__stats` counters + a `__expire` switch to age a submission past 24 h for the window test.
6. **Tests:** final_regression +~22 (happy paths ×3, verbatim op records, extend-once guard, cancel→fresh-GeneWB rebirth, eager refusals, 24-h window via SQL-dated fixture, cross-company 404); new `r29_ui.js` +~10 checks through the real UI; mock-driven, no network.
7. **Implementation-time verification (adjacent):** confirm the R-25 GENEWB payload passes current NIC Ship-To validation; document the finding either way.

**Option B (reduced):** vehicle-update + cancel only (extend's 8-h window and once-ever semantics are the trickiest; postpone). ~⅔ the scope.

**Blast radius:** low — additive migration (one table), ~3 service functions + 3 routes + small UI panel, mock/test extensions. GENIRN/GENEWB paths byte-unchanged; idempotency model untouched except the documented cancel-rebirth. No accounting math, no posting engine.

**Proposed release: v1.28.0 — "EWB lifecycle: vehicle update, extension, cancellation (opt-in)".**

---

## 6. Non-bugs verified

- The absence of lifecycle ops in v1.27.0 is **not a defect** — R-28's approved scope was birth-of-EWB; the services' own header documents the posture.
- `GENEWB`'s existing Part-B-as-query-params design is fine for generation; lifecycle ops need different request shapes, which is why they are separate routes rather than GENEWB flags.

## 7. Out of scope

Consolidated EWB (CEWB — transporter-side), multi-vehicle split, EWB closure facility (deferred by GSTN), e-invoice cancellation, transporter-enrolment flows, RFID, production IRP onboarding, any accounting change.

---

## 8. Final recommendation

Proceed with **Option A** unless you want the reduced Option B. The decision is yours; no code has been touched.
