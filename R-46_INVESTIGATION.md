# R-46 Investigation — zprime v1.44.0 · IRP/EWB Readiness Drill

**Status:** investigation complete — implementation NOT started (per protocol; no production code, tests, migrations, or docs modified).
**Baseline:** HEAD `867b8303ae00fc8eeaf53b7d993f39abdc47963c` = `v1.44.0-2-g867b830` (release commit `dec00ad` = tag `v1.44.0`, pushed, 46 tags); working tree clean except this report and the intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md` + `scripts/__pycache__/`.
**Verdict:** `NO P1/P2 DEFECT CONFIRMED — CONNECTIVITY PRODUCTION-READY PENDING REAL CREDENTIALS` — the full operator journey (payload → credentials → submit → lifecycle) is live-verified 39/39 against the wire-faithful mock. Every drill failure during the sweep was a probe bug or a documented scope boundary, never a product defect.

---

## 1. Executive Summary

R-42 flagged the IRP/EWB runbook as an unexercised surface: the R-28…R-31 suites prove the code, but nothing had walked it as an operator would — from zero credentials to a completed lifecycle. This drill did exactly that against the running v1.44.0 stack (app + db + the `mock-irp` sidecar speaking the real NIC wire format: RSA-encrypted auth, AppKey→SEK handshake, AES-256-ECB payloads, fault injection).

**Result: the connectivity layer is coherent, safe, and honestly scoped.**

- **Fail-fast posture holds everywhere:** no credentials → actionable 400s (`No sandbox IRP credentials configured…`), zero orphan submission rows; EWB-from-IRN without an IRN → `Register the e-invoice first`; production without an explicit endpoint override → refuses rather than guessing a host; EWB-API **always** requires an override (no NIC default exists — documented limitation).
- **Validation ordering is operator-correct:** payload validation (422 with precise fix-it messages) runs **before** credential checks (400) — an operator with broken data is never told to go configure credentials first.
- **Idempotency is real:** duplicate submit → 409 without a network call (eager refusal + DB partial-unique backstop); rejection → verbatim `ErrorDetails` + fix-and-retry works; cancel re-opens the `(voucher, kind)` slot so a fresh EWB can be born; once-ever extension enforced eagerly.
- **Secrets are protected:** AES-256-GCM at rest keyed by `IRP_ENC_KEY`; boot fails fast when encrypted rows exist and the key is missing/rotated (verified live in the R-45 sweep's stack); API responses carry only `*Last4` masks; secrets never appear in submissions history.
- **Authorization is layered:** submissions ride `cid()` (non-member → 404, no existence leak); credential read/write is owner-gated (non-owner → 403).
- **Birth-path routing (R-31) works end-to-end:** IRN-born EWBs lifecycle on eivital v1.10, direct-born (B2C) on ewayapi v1.03 — discriminated by the verbatim response casing stored at birth.

**Non-blocking limitations (documented, by design):** the R-25 EWB-01 *payload* route is B2B-shaped (B2C goes through `generate-direct`); the e-invoice B2C refusal message lists GSTIN/address rather than naming the B2C scope; masked credential rows omit `id` (list-then-delete needs the `environment` field, which the delete route takes); the EWB-API sandbox has no NIC-published default endpoint.

## 2. Baseline Integrity

- `git rev-parse HEAD` → `867b8303ae00fc8eeaf53b7d993f39abdc47963c`; `git describe --tags` → `v1.44.0-2-g867b830`; tag `v1.44.0^{}` = `dec00ad98716ee138792592498b44af3fe50da24` (verified in the v1.44.0 release via for-each-ref + ls-remote).
- Working tree at drill start: clean (`ZLEDGER_PRODUCTION_ACTION_PLAN.md`, `scripts/__pycache__/` untracked and untouched).
- Drill artifacts live in `/tmp/r46_drill.py` (outside the repo) and disposable DB rows (company prefixed `R46 Drill`); nothing in the repository was modified.

## 3. Architecture Review (source evidence)

| Layer | Files | Findings |
|---|---|---|
| Wire/session | `server/src/services/irp.ts` (635 ln) | AUTHTOK handshake (RSA-PKCS1 secrets + random 32-byte AppKey; SEK = AES-256-ECB(AppKey, blob)), per-(creds,gstin) session cache with 6h/1h expiry minus 5-min skew; EWB-portal has its own credential pair, cache namespace, and case-tolerant response parsing. `GENIRN`/`GENEWB` (eivital v1.10) and `GENEWB`/`VEHEWB`/`EXTENDVALIDITY`/`CANEWB` (ewayapi v1.03) |
| Payloads | `einvoice.ts` (232 ln), `ewaybill.ts` (373 ln) | NIC v1.01 e-invoice JSON: B2B mandatory set enforced with per-field messages; `supplyLines()` shared line projection (HSN, UQC mapping, duty-share proportionality); cross-check against `voucherGst` classification (defense in depth). EWB-01 (B2B, from stored data) + direct (B2C) variants |
| Crypto at rest | `server/src/lib/crypto.ts` (76 ln) | AES-256-GCM, `base64(nonce‖tag‖ct)`, 32-byte `IRP_ENC_KEY`, loud auth-tag failures, `_resetIrpKeyCache` test hook |
| Boot check | `server/src/index.ts` (R-28 block) | Counts `irp_credentials`; if >0, probes one blob through `decryptSecret` and **refuses to boot** on failure (R-09 posture) — live-verified as passed on this stack (3 stored credential rows decrypt fine) |
| Routes | `reports.ts` (submit/lifecycle under `cid()`), `companies.ts` (credentials under `requireOwner`) | Structured status mapping: 200 ok / 422 validation / 409 duplicate / 502 IRP-rejection / 400 actionable. `submitEnv` rejects anything but `sandbox\|production` |
| Storage | `irp_submissions` (partial uniques `(voucher,kind) WHERE status IN ('accepted','pending')`), `irp_ewb_ops` (every op attempt verbatim) | Legal record: accepted rows never deleted; cancelled rows retained and status-flipped, which re-opens the idempotency slot |
| Client | `Reports.tsx`, `CompanySettings.tsx`, `DayBook.tsx`, `VoucherScreen.tsx` | Submission UI, settings card, IRN/EWB badges (covered by r28–r31 suites; not re-drilled here — API-level drill was the gap) |
| Mock | `scripts/mock_irp.js` (231 ln) | Speaks the real format; fault injection: `__reject` (per-invoice), `__failaction`, `__expire` (24h window), `__stats`, self-keyed `__pubkey` |

## 4. Live Drill (39/39)

Disposable company `R46 Drill Co` on the running stack; mock sidecar at `mock-irp:3199` (host `:3299`). Full transcript in the session log; highlights:

**Setup (7):** fresh company with seller GSTIN/pincode → seeded units (`Nos`/`Pieces`, R-44) present → buyer ledger (`regular`, GSTIN `29…`, party address/state/pincode) → seeded `IGST` ledger (`dutyHead='IGST'`) → stock item with HSN using the seeded unit (zero setup) → two inter-state B2B sales posted.

**Fail-fast (4):** e-invoice submit without creds → **422 validation-first** (drill initially expected 400 — ordering is: payload correctness before credentials, which is the operator-correct order); EWB-from-IRN without IRN → 400 `Register the e-invoice first`; direct EWB without creds → 400 actionable; **zero orphan submission rows** after all failures.

**Credential lifecycle (4):** list empty → empty secrets rejected (retype rule) → save with mock pubkey + endpoint override + EWB pair → masked response (`clientSecretLast4: "cret"`, no secret material).

**Authorization (3 + 2 implicit):** accountant member reads history (member access works); outsider (member of a different company only) → submit 404 (no existence leak), credential read 403 (owner-gated).

**E-invoice via mock (4):** submit → **IRN returned, accepted**; immediate resubmit → **409 without network** (eager duplicate refusal); mock `__reject` fault → **502 with verbatim ErrorDetails**; retry after rejection → **accepted** (the rejected row permits retry — NIC's one-hour block guarded by our idempotency, not by blocking retries).

**EWB-from-IRN lifecycle (6):** GENEWB accepted → VEHEWB vehicle update → EXTENDVALIDITY accepted → second extension **refused eagerly** (once-ever NIC rule, no network) → CANEWB within 24h accepted → fresh EWB accepted on the re-opened slot.

**Direct B2C EWB (4):** consumer-party sale → e-invoice honestly refuses (`ok=false`) → `generate-direct` on the **EWB-API portal** accepted (`ewayBillNo`) → vehicle update + cancel **route to ewayapi** (R-31 birth-path discrimination proven live for both paths).

**History (2):** submissions recorded verbatim; all statuses within the documented vocabulary (`accepted/rejected/error/cancelled/pending`).

## 5. Probe Bugs vs Product Behavior (NOT A BUG — VERIFIED)

Drill iterations surfaced six behaviors that looked like failures and are not:

1. **Validation-before-credentials ordering** — 422 payload errors precede the 400 credential check. Correct: never send an operator to configure credentials when the voucher itself is broken.
2. **Duty classification requires `dutyHead`/`taxability`** — a hand-created "Output IGST" ledger without `dutyHead='IGST'` (and a sales ledger without `taxability='taxable'`) is invisible to `voucherGst`, so the payload cross-check fails with `classification 0`. The seeded ledgers (R-44 scope) carry the right duty heads; this is the designed data contract, not a bug. The honest error message named the exact mismatch.
3. **Masked credential rows omit `id`** — `maskIrpCreds` drops identifiers; the delete route keys on `environment`, so no functionality is lost.
4. **`R-25 EWB-01` payload route refuses B2C** — the *payload-download* route is B2B-shaped by approved scope; B2C direct EWBs use `generate-direct` (submit path works for B2C, proven accepted).
5. **E-invoice B2C refusal wording** lists missing GSTIN/address rather than naming B2C scope — honest (`ok=false`, actionable), P4 cosmetic at most.
6. **Username uniqueness across drill runs** — 409 on re-run; probe now namespaces per company id.

## 6. Findings Table

| ID | Area | Finding | Status | Severity | Reproducible | Impact | Coverage | Action | R-46 fix? |
|---|---|---|---|---|---|---|---|---|---|
| F-46-1 | Payloads | E-invoice B2C refusal message doesn't name the B2C scope (lists GSTIN/address) | NOT A BUG — VERIFIED (cosmetic wording) | P4 | Yes | None — `ok=false` + actionable errors | drill | optional wording polish | No |
| F-46-2 | Payloads | R-25 EWB-01 payload route is B2B-only; B2C handled by `generate-direct` | CONFIRMED scope boundary (approved Option A) | P4 | Yes | None — direct submit covers B2C | r30/r31 + drill | document in runbook (already implied) | No |
| F-46-3 | Credentials | Masked credential row omits `id` | NOT A BUG — VERIFIED (delete keys on env) | P4 | Yes | None | drill | none | No |
| F-46-4 | Connectivity | EWB-API has no default endpoint (even sandbox) | DOCUMENTED limitation (R-30 design) | P4 | n/a | Operator must set override; runbook documents | r30 | none | No |
| F-46-5 | Runbook | ONBOARDING_IRP_EWB.md matches observed behavior (fail-fast texts, endpoint policy, DR note on IRP_ENC_KEY) | VERIFIED consistent | — | — | — | this drill | none | No |

No P1/P2/P3 findings. No cross-company leak, no secret exposure, no idempotency gap, no silent failure mode.

## 7. Coverage Assessment

- **Existing:** r28 (credentials+e-invoice, 137 ln), r29 (lifecycle, 141), r30 (direct EWB, 157), r31 (birth-path routing, 147) UI suites + final_regression R-24/R-25 payload sections + R-03 authorization regression. The connectivity surface is the best-tested opt-in feature in the repo.
- **Gap found and filled by this drill (investigation artifact only):** a single **sequential operator journey** test — the existing suites exercise features in isolation; nothing previously proved credential-install *after* failed submits, reject-then-retry, and cancel-then-regenerate in one continuous session with the same vouchers. The drill probe (`/tmp/r46_drill.py`, 39 checks) demonstrates the journey; promoting it (or its checks) into a permanent suite is an implementation decision outside investigation scope.

## 8. Runbook Consistency Check

`ONBOARDING_IRP_EWB.md` verified against observed behavior: prerequisite list (two separate portal registrations), public-key conversion instructions, `IRP_ENC_KEY` generation + disaster-recovery role, boot-refusal description, and the "payloads work without credentials" statement — all match the live system. No drift found.

## 9. Final Recommendation

**NO P1/P2 DEFECT CONFIRMED — CONNECTIVITY PRODUCTION-READY PENDING REAL CREDENTIALS.**

The only remaining unknown is behavioral drift against the **real NIC endpoints** (response casing beyond the two mirror families already tolerated, field-level quirks), which by construction cannot be closed without production credentials. The runbook's step-by-step onboarding path is accurate; the fail-fast posture ensures any real-portal surprise surfaces as a verbatim recorded error, not silent corruption.

Recommended disposition: record this drill as the R-42 IRP/EWB thread's readiness evidence. If desired later, a small P4 polish batch (F-46-1/2 wording) could ride along with any future docs release — no release is warranted on this evidence alone.
