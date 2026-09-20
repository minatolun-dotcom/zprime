# R-32 Investigation — zprime v1.30.0 · IRP/EWB Production Onboarding Runbook

**Status:** investigation complete — implementation NOT started (per protocol).
**Verdict:** `R-32 CONFIRMED — GENUINE OPERATOR-ENABLEMENT GAP, FULLY SCOPED` (documentation + one honest-validation surface; no accounting risk, no schema change).
**Baseline:** HEAD `7d916e4d63303ee266ba6d7e3ddf818ec878de1a` = tag `v1.30.0`; working tree clean except this report and the intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md` (plus the five ledger docs recording v1.30.0, riding with the next commit per convention). No source, test, migration, or doc file modified by this investigation.

---

## 1. Executive Summary

R-28…R-31 built the complete IRP/EWB connectivity stack — credentials at rest, sandbox/production environments, e-invoice submission, IRN-born and direct-born EWBs, full lifecycle with birth-path routing. **Every machine step is proven.** What does not exist is the **operator-facing path to production**: nothing in the repository tells an operator which hosts to use, where public keys come from, how the two portals differ, what to do when a submit fails with an NIC error code, or how to rotate credentials.

Evidence of the gap, from the code itself:

- `README.md` (116 lines) mentions IRP connectivity **zero** times. Its only env-var guidance is `JWT_SECRET`/`ADMIN_PASSWORD`; `IRP_ENC_KEY` appears only as a bare line in `.env.example`.
- `PROJECT.md` line 43 still declares e-invoice/e-way bill **absent** — stale by ten releases (it was written pre-R-24; the "PARTIALLY IMPLEMENTED" and "OUT OF SCOPE" lists were never updated after R-23…R-31 delivered RCM, TCS, e-invoicing, EWBs, GSTR-9, and audit).
- The CompanySettings connectivity card is honest but terse: field labels carry one-line hints ("portal download; else IRP_NIC_PUBLIC_KEY env"), and the EWB sub-section's one note admits the shared-host ambiguity: *"the EWB-API host is the same endpoint override above (it serves both portals for the mock; production hosts differ)"* — which is precisely the trap an operator hits first.
- NIC error codes surface verbatim (good — R-28's design), but nothing maps the common ones (3001-class validation, 3095 duplicate-submit lockout hour, 3105 cancel-window, 3120 extend-once) to what the operator should do next.

This is not a defect — it is the documented "production credential procurement" out-of-scope line from R-28 now becoming the highest-value work, exactly as the roadmap anticipated.

---

## 2. What Exists Today (verified surfaces)

| Surface | File | State |
|---|---|---|
| Sandbox IRP default host | `services/irp.ts:73` | `https://einv-apisandbox.nic.in` hard-coded for sandbox when no override |
| Production IRP host | `services/irp.ts:74-77` | **fail-fast refusal** — production requires an explicit endpoint override (correct: hosts vary by IRP/GSP) |
| EWB-API host | `services/irp.ts:80-92` | **always requires an override** (sandbox AND production) — honest, but the runbook must say what the production host is |
| Public key | `services/irp.ts:126-129, 211-213` | CompanySettings PEM field → `IRP_NIC_PUBLIC_KEY` env → `EWB_NIC_PUBLIC_KEY` env; fail-fast with actionable message |
| Encryption at rest | `lib/crypto.ts` | `IRP_ENC_KEY` 32-byte base64, boot fail-fast R-09-style, generation hint in the error text |
| Environments | `CompanySettings.tsx:139-145` | sandbox/production toggle, separate credential rows, per-env delete |
| Masking | `CompanySettings.tsx:150-156, 169-171` | client secret + passwords masked last-4, retype-to-change rule |
| Error surfacing | `Reports.tsx` banners | verbatim IRP/`errorDetails` on 422/409/502 |
| Mock | `scripts/mock_irp.js` | both URL families under one host (the CI-only simplification) |

---

## 3. The Gaps (what an operator cannot discover)

1. **No onboarding document at all.** There is no doc that walks: enable API access on the NIC portals → collect the four IRP credentials (clientId, clientSecret, username, password) + the EWB pair → download the portal public key (a `.pem` from the portal, converted to PEM) → set `IRP_ENC_KEY` → paste credentials per environment → first-submit checklist → what each failure class means.
2. **Two-portals-one-field ambiguity.** The endpoint override serves IRP in sandbox (with a built-in default) and EWB-API always. In production an operator must know: IRP host is their IRP/GSP's; EWB-API host is NIC's EWB API (or their GSP's EWB host). The settings hint says "production hosts differ" but not *where to get them*.
3. **NIC error-code decode table.** Verbatim errors are right for a machine, terse for a human at 6 pm on filing day. A short table — 3001/3011 (validation), 3005-class auth, 3095 (duplicate hour lockout — wait), 3105 (24-h cancel window — wait), 3120 (already extended — no retry), 4002 (missing field — zprime bug or stale payload) — belongs beside the runbook.
4. **PROJECT.md staleness.** Ten releases of drift in the product's own self-description (RCM/TCS/e-invoice/EWB/GSTR-9/audit listed as absent or out-of-scope while shipped). Any operator reading PROJECT.md to decide whether zprime can do e-invoicing gets the wrong answer.
5. **No first-submit smoke path.** The suites prove the machinery, but an operator has no documented "create a test company → sandbox credentials → submit a ₹1 invoice → see the IRN banner → cancel the EWB" walkthrough proving their credential setup before touching real books.

**NOT A BUG — VERIFIED (discipline items):**

- The production fail-fast refusals (`irp.ts:74-77, 88-92`) are **correct design** (R-28/R-30 grounded: no stable, verifiable NIC production constant exists; guessing hostnames is worse than refusing). Not changed.
- The shared endpoint-override field is a **documented R-30 limitation**, consciously retained (two fields with partial applicability would be more confusing, not less). The runbook, not a schema change, is the right fix.
- Verbatim error surfacing is correct (never paraphrase a legal record). The decode table is additive documentation, not a re-mapping.

---

## 4. Proposed Scope Options

**Option A (recommended) — Runbook + in-app pointer + PROJECT.md truth-pass (≈ v1.31.0)**
- **New `ONBOARDING_IRP_EWB.md`** (the runbook): prerequisites (portal API access, IRP_ENC_KEY), per-portal credential tables (IRP vs EWB-API), host table (sandbox IRP default / production IRP "your IRP or GSP" / EWB-API "NIC EWB API or GSP"), public-key sourcing (portal download → PEM conversion), step-by-step CompanySettings setup per environment, first-submit smoke walkthrough, NIC error-code decode table, credential rotation procedure (retype rule + per-env delete), backup/restore note (IRP_ENC_KEY is part of the disaster-recovery set — losing it makes stored credentials undecryptable).
- **README pointer:** a short "IRP / e-Way Bill connectivity" section (≤10 lines) linking the runbook + the `.env.example` IRP_ENC_KEY lines.
- **PROJECT.md truth-pass:** update the architecture/status lists to reflect v1.30.0 reality (RCM, TCS, e-invoice, EWB incl. direct birth + lifecycle, GSTR-9, audit trail all IMPLEMENTED; keep genuine gaps: e-invoice cancellation, consolidated EWB, GSTR-2B, etc.).
- **One honest in-app surface:** CompanySettings connectivity card gains a compact help note listing the three host facts (sandbox IRP default exists; production IRP host comes from your IRP/GSP; EWB-API host from NIC/GSP) — no behavior change.
- **Tests:** +2 Python checks (README mentions IRP_ENC_KEY; runbook exists and names both portals) — deliberately tiny; docs-first release. Browser: no change (settings text only).
- Blast radius: **near-zero** — one client string, two docs, one test file. No schema, no server code paths, no accounting surface.

**Option B — Option A + error-code enrichment in the 502 banner** (server appends the decoded meaning from a static map when the NIC errorCode matches the table). Small blast radius (one helper + tests), but it changes an honest verbatim surface — the runbook alone may be the better home for the decode table. Recommended only if the operator feedback loop justifies it.

**Option C — defer** — acceptable; connectivity is sandbox-proven and the operator population today is single-user. But this is the last cheap increment: every future connectivity feature (e-invoice cancel, GSP flows) will inherit the same undocumented-onboarding tax.

---

## 5. Required Verification (for the chosen scope)

1. Typecheck + full Python battery (docs-only should move exactly the +2 checks).
2. Browser battery on fresh volume (settings text change must not disturb r28/r30/r31 locators — verified by the suites themselves).
3. Runbook accuracy pass: every command/field/host in the doc checked against the actual code (the same discipline as the R-12 backup runbook).
4. PROJECT.md diff reviewed against the R-23…R-31 changelog entries (no invention, no omission).

---

## 6. Out of Scope

- Any change to credential storage, masking, session caching, or the endpoint-override field (R-28/R-30 design stands).
- Error-banner re-mapping or i18n of NIC messages (Option B territory, deferred).
- Automated production host discovery (no verifiable NIC constant exists).
- E-invoice cancellation, consolidated EWB, GSTR-2B, portal-upload APIs (existing roadmap exclusions).

---

## 7. Final Recommendation

**Approve Option A.** The connectivity stack is machine-complete but operator-blind; the runbook closes the last honest gap between "works in CI" and "deployable in the field," and the PROJECT.md truth-pass stops the product's own documentation from contradicting ten releases of shipped reality. Release candidate: **v1.31.0**.
