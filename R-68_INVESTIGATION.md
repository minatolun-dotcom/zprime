# R-68 INVESTIGATION — IRP SignedQRCode: store it from GENIRN, render the IRN QR on the invoice face

**Trigger (operator):** approved from `R-67_INVESTIGATION.md` Option D — "Investigate the IRP SignedQRCode gap (Option D) as the next implementation cycle — store it from GENIRN and render the IRN QR on the invoice face." Implementation cycle to release as **v1.58.0**.

**Date:** 2026-09-26 · **Baseline:** v1.57.0 (tag `bc657a2`) + R-66 polish (`3af85a3`) + R-67 investigation (`3746801`) · **Method:** code-level read of the full R-28…R-31 IRP surface (`services/irp.ts` GENIRN mapping + idempotency + masking, `db/schema.ts` `irp_submissions`, `routes/reports.ts` submit/history wiring, `scripts/mock_irp.js` wire format), the migration chain (`0000…0016` + the gen-00NN.ts programmatic pattern), the v1.57.0 invoice face (`client/src/components/InvoicePrint.tsx`), and the client's current submission consumption (GSTR-1 banners).

---

## 1. The gap, confirmed at code level

NIC's `eivital v1.10` GENIRN response carries, inside the SEK-decrypted `Data`: `Irn`, `AckNo`, `AckDt`, **`SignedQRCode`** (the IRP-signed QR payload string — the legally expected artifact on a printed B2B e-invoice) and **`SignedInvoice`** (the IRP-signed invoice JSON, verifiable offline).

zprime's `submitEInvoice` (`server/src/services/irp.ts` ~:326) maps:

```ts
irn: resp.Irn ?? null,
ackNo: resp.AckNo != null ? String(resp.AckNo) : null,
ackDate: resp.AckDt ?? null,
response: resp,          // ← the FULL decrypted response IS stored verbatim in jsonb
error: ...
```

So today:
- **`SignedQRCode`/`SignedInvoice` survive only buried inside the `response` jsonb blob** — never queryable, never surfaced on any payload, never rendered. Effectively discarded at the contract level.
- The **mock** (`scripts/mock_irp.js` genirn branch) emits `Data = ecbEnc({ Irn, AckNo, AckDt })` — no SignedQRCode — so no suite could have caught this.
- The **schema** (`irp_submissions`: companyId, voucherId, kind, status, irn, ackNo, ackDate, ewbNo, ewbValidUntil, response, error, requestedBy, createdAt) has **no column** for either field.

Consequence: a printed zprime e-invoice (v1.57.0's InvoicePrint) carries **no IRN QR**, and NIC's own compliance posture (the rule behind "an invoice without IRN will not be a legal document" — already quoted in the schema comment for R-28) expects the signed QR on the face.

## 2. Design decisions (each the smallest honest shape)

### D1 — Storage: dedicated columns, not just the jsonb blob
`irp_submissions.signedQrCode text` + `irp_submissions.signedInvoice text` (both nullable). Migration **0017** via the established programmatic pattern (gen-0017.ts → `ALTER TABLE "irp_submissions" ADD COLUMN …`, additive-only, no backfill — every pre-R-68 row stays null and renders no QR, honestly). The verbatim `response` jsonb keeps carrying the full blob unchanged (R-28's legal-record contract untouched); the columns make the fields first-class: queryable, maskable, renderable.

**Why store SignedInvoice too:** it arrives in the same response, is the offline-verification complement to the QR (a verifier app checks the QR signature against the SignedInvoice payload), costs one nullable column, and skipping it would guarantee a second migration later. `maskSubmission()` is a documented passthrough ("the row is safe to return — secrets never live here") — signed payloads are IRP-issued public artifacts of an accepted invoice, not secrets; the named-function comment already anticipates field additions.

### D2 — Seeding: only on the accepted GENIRN path
`submitEInvoice`'s accept branch adds `signedQrCode: resp.SignedQRCode ?? null, signedInvoice: resp.SignedInvoice ?? null`. Rejected/error rows stay null (the IRP issued nothing). **No backfill and no GETIRN fetch** — NIC's offline tooling re-fetches by IRN, but adding a fetch path is a separate feature; this cycle records what we already receive. EWB paths (GENEWB/ewayapi) untouched — the QR is an e-invoice artifact.

### D3 — Surfacing: the row already flows
`submissionHistory` returns masked rows; `/reports/submissions?voucherId=` is read by the client. The invoice face needs the accepted e-invoice row for the voucher: VoucherScreen (or InvoicePrint) fetches `/api/c/:cid/reports/submissions?voucherId=<id>` and picks `kind === "e-invoice" && status === "accepted" && signedQrCode`. Query enabled only for printable Sales/Delivery-Note vouchers in edit mode. Zero new routes.

### D4 — Rendering: `qrcode.react` (researched)
- **`qrcode.react`** — the standard React QR component; **zero runtime dependencies** (React peer only); renders pure **SVG** (scales and prints crisply — canvas does not belong on paper); stable/maintained (last npm release Dec 2024, no advisories; 12-month quiet is release cadence, not abandonment — the codebase is feature-complete).
- Sizing: the GST e-invoice QR spec is a 10×10 mm QR on the face; we render ~84px print (≈ 22 mm at 96dpi — comfortably scannable) with `includeMargin`, black-on-white.
- Placement on the face: bottom strip beside the amount-in-words/narration block — **"IRN: <irn>" (truncated) + QR + Ack No/Date** — only when an accepted e-invoice with a QR exists. No QR for plain vouchers, cancelled/rejected submissions, or pre-R-68 rows (null column ⇒ no QR, honest).

### D5 — Mock fidelity
`scripts/mock_irp.js` genirn branch emits `SignedQRCode` (a deterministic base64 string derived from the IRN — not a real cryptographic QR payload, and the mock makes no such claim) + `SignedInvoice` in `Data`, mirroring the real NIC response shape. Compose mounts `./scripts` read-only into the sidecar, so a docker restart picks the change up without a rebuild.

## 3. Scope of change (file-by-file)

| File | Change |
|---|---|
| `server/src/db/schema.ts` | `irpSubmissions` + `signedQrCode text`, `signedInvoice text` (nullable, documented) |
| `server/scripts/gen-0017.ts` | one-shot: prev := cur minus the two columns → `0017_r68_signed_qr.sql` + `meta/0017_snapshot.json` + journal idx 17 (gen-0013 pattern, expected entries check → 17) |
| `server/drizzle/0017_r68_signed_qr.sql` | `ALTER TABLE "irp_submissions" ADD COLUMN "signed_qr_code" text; ADD COLUMN "signed_invoice" text;` (additive) |
| `server/src/services/irp.ts` | GENIRN accept branch stores both fields (3 lines) |
| `scripts/mock_irp.js` | genirn `Data` += `SignedQRCode`, `SignedInvoice` |
| `client/package.json` | + `qrcode.react` |
| `client/src/components/InvoicePrint.tsx` | submissions query + `IrnQrStrip` component on the face (IRN line + SVG QR + ack) |
| `client/src/pages/VoucherScreen.tsx` | pass the submissions query result through to InvoicePrint (or InvoicePrint owns the query — decided at implementation: InvoicePrint owns it, keyed on voucherId, keeps VoucherScreen untouched) |
| `scripts/final_regression.py` | R-28 block additions: response carries SignedQRCode; column persisted non-null after accept |
| `scripts/acceptance/r46_drill.js` | +1–2 checks: submission payload exposes signedQrCode; re-run idempotency intact |
| `scripts/acceptance/r68_ui.js` | new suite: end-to-end — mock IRP accept → invoice face shows IRN + QR (svg present) + ack; voucher without e-invoice shows no QR; print media keeps the strip visible |

## 4. What does NOT change

- GENIRN/GENEWB/ewayapi request payloads and the auth handshake (byte-identical).
- Idempotency (accepted-row re-read returns the stored row — now with QR fields — with zero network calls).
- EWB lifecycle, direct EWB, credentials, masking (passthrough already).
- The verbatim `response` jsonb contract.
- No accounting surface; no client bundle except InvoicePrint + the QR component.

## 5. Risks / open questions

- **Risks:** a fresh `qrcode.react` dep (client-only, zero transitive deps — smallest possible supply-chain surface); mock change must keep r28/r29/r30/r31/r46 green (additive fields only — assertions count calls, not payload keys).
- **Open questions:** none blocking — column names, QR size/placement, and the deterministic mock payload are implementation details within the approved scope.
- **Verification plan:** typecheck server+client · build · `r68_ui.js` new · r46_drill green · final_regression R-28 block green (948→~952) · full fresh-volume estate · release as v1.58.0 per protocol.
