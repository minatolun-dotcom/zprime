# R-67 INVESTIGATION — PDF / XLSX server-side export (the R-66 follow-up)

**Trigger (operator):** "Investigate PDF/XLSX server-side export as the next R-66 follow-up option" — i.e. take the R-66 investigation's explicitly *not-recommended-now* items **G-E (no PDF)** and **G-F (no XLSX)** and study them properly as candidates. Investigation-only; zero production code touched.

**Date:** 2026-09-26 · **Baseline:** v1.57.0 (`bc657a2` tag; main `3af85a3` with the COA print polish) · **Method:** fresh surface re-verification on the released tree (export/print posture, Dockerfile, server/client dependency trees, e-invoice/EWB submission schema, `@fastify/static` usage) + live web research on the PDF and XLSX library landscape as of September 2026 (SheetJS CVE posture, ExcelJS maintenance + transitive-dep findings, pdfkit/pdf-lib/react-pdf maintenance, headless-Chromium-in-container cost).

---

## Executive Summary

**The recommendation stands, and is now evidenced rather than assumed: do not add server-side PDF or XLSX this cycle.** Three findings drive it:

1. **The demand server-side export was meant to satisfy is already served by v1.57.0.** Every report view now exports CSV with provenance meta rows, every view prints cleanly to paper **and to PDF** (any browser's print dialog offers "Save as PDF" — Chrome, Edge, Firefox, Safari all ship it as a first-class destination), and Sales/Delivery Note vouchers print a Tally-style invoice face with GST breakdown and amount-in-words. Tally's own parity story is paper/PDF-of-record — which browser print now covers honestly — not a server binary blob.
2. **XLSX would regress security posture.** SheetJS's npm `xlsx` distribution is frozen at 0.18.5 with known high-severity CVEs (ReDoS + prototype pollution, read-path) and **"no fix available"** on npm — the project moved to self-hosted tarballs and a paid CDN. ExcelJS (the standard replacement) is maintained but carries **known transitive-dep advisories (older lodash/uuid/tmp) flagged in June 2026**, for a format whose only advantage over the shipping CSV+UTF-8-BOM is styling and multiple sheets. Both would put the **server** into the business of parsing/writing binary office formats — a new attack-surface class the repo has never carried — to produce spreadsheets the operator already gets from the CSVs.
3. **Server-side PDF has no zprime use case that browser print doesn't cover better.** zprime is self-hosted single-app: the person who wants the PDF has the browser that just rendered the report. The honest remaining server-PDF use case — **batch/automation** (month-end: every email statement, every cheque, every e-invoice, one command) — is real but unrequested, and would cost either headless Chromium in the runtime image (an enormous, CVE-churning surface: the full Blink/V8 attack plane inside the account app's container) or a pure-JS PDF lib whose invoice quality is years behind the v1.57.0 HTML print face. Zero requests exist for either.

Also found while verifying: **the single strongest server-side artifact is neither PDF nor XLSX — it is the IRP's `SignedQRCode`.** The e-invoice submission ledger (`einvoice_submissions`: irn, ackNo, ackDate, status, error) already stores everything the printed GST e-invoice legally needs **except the signed QR code and the signed-invoice payload**, which NIC's `v1.10` GENIRN response carries and zprime currently discards. That's a compliance-value, ~zero-dependency (the QR is a string to store; rendering is a client `qr` render), zero-attack-surface increment — recorded as **Option D**.

**Proposed direction:** record G-E/G-F as *studied and declined with evidence* (R-46/R-40 precedent — "no release warranted"), and let the operator pick any of the constructive options below. Option D is the best value-per-risk if anything is built; **Option A3** (client-side XLSX via ExcelJS, no server surface) is the honest middle for real spreadsheet-format demand; **nothing is recommended for default implementation.**

---

## 1. Where R-66 left the surface (re-verified on the v1.57.0 tree)

- **CSV:** `client/src/lib/csv.ts` — `csvDownload(name, headers, rows, meta?)` with the RFC 4180 serializer, the BUG-009 formula-injection guard (leading `=` `+` `@` always neutralized; `-` only when not a plain number), and UTF-8-BOM for Excel Unicode. Rendered on **all 19 report views** via `ReportActions`, plus Day Book (`daybook-export-csv`) and Audit Trail (`audit-export-csv`), all with meta provenance rows. The R-66 investigation's "2 of 17" gap is closed.
- **Print:** `@media print` block in `client/src/index.css` (Shell header and fkey rails `print:hidden`; buttons blanket-hidden with a `print-keep` escape; cards shadowless + `break-inside: avoid`; `.report-table thead` = `table-header-group`, repeating per page) + the `PrintHead` print-only provenance header on every report view + the COA filter row `print:hidden` (post-release polish `3af85a3`). ChequePrint remains the purpose-built cheque face.
- **Invoices:** `client/src/components/InvoicePrint.tsx` — Tally-style invoice face for Sales/Delivery Note vouchers (company header, Billed-to from the party master, place of supply, inventory table with HSN, duty lines indented, GST summary, amount-in-words via the shared `amountWords()`, narration + signatory), print-only fixed layer + on-screen preview.
- **What still does not exist:** any server route producing a file other than the Tally XML import and the static client bundle; any PDF generation anywhere; any XLSX anywhere.

## 2. The server surface, as found (the "server-side" in the operator's question)

- **Runtime image:** `node:22-alpine`, no Chromium, no fonts stack beyond Alpine's base, no LibreOffice/`soffice`, no wkhtmltopdf. `CMD ["node", "server/dist/index.js"]` — one process.
- **Server dependencies (complete):** `@fastify/{cookie,cors,jwt,multipart,static}`, `drizzle-orm`, `fast-xml-parser`, `fastify`, `fastify-plugin`, `postgres` (postgres.js), `zod`. **Zero** binary/format libraries. `@fastify/static` serves `client/dist` (plus `reply.sendFile("index.html")` for the SPA) — already the one file-serving surface.
- **Client dependencies (complete):** `@tanstack/react-query`, `react`, `react-dom`, `react-router-dom`; vite/tailwind/typescript dev-side. **Zero** export libraries client-side either.
- **JSON-body-only API:** every route is JSON; the only `Content-Disposition` anywhere is `attachment`-style handling for import response errors. No binary responses today.

Adding server-side PDF/XLSX therefore means: new runtime deps, a new response class (binary with `Content-Disposition`), and for PDF either a browser engine in the image or a layout re-implementation. Each option below prices this honestly.

## 3. PDF, honestly (G-E)

### 3.1 The use-case inventory — what would a server PDF be *for*?

| Use case | Served today? | Server PDF adds? |
|---|---|---|
| Paper report | yes — print stylesheet (v1.57.0) | no |
| **PDF-of-record from a report** | **yes — browser print → "Save as PDF"** (every major browser ships it as a print destination; R-51's browser-reserved-key posture is untouched because the print path is an explicit button, not a global chord) | no |
| Invoice PDF for emailing | mostly — print → Save as PDF on the invoice face | marginal (one click saved) |
| Batch/automation (month-end: all statements/cheques/e-invoices in one command, cron'd) | **no** | **yes — the one genuine gap** |
| Archival with a deterministic byte-stable PDF | partial (browser PDFs vary by browser/version) | marginal (but "byte-stable archive" is not a stated requirement anywhere in the repo) |

The batch row is the only real case. It is also **unrequested**: no operator message, no suite, no doc-of-record asks for it. Building it now would be R-61's lesson repeated — an implemented-then-unwanted release.

### 3.2 The options and their full cost

**P1 — Headless Chromium in the runtime image (Playwright/Puppeteer + `page.pdf()`):**
- Image cost: +Chromium ≈ 300–450 MB and a V8/Blink CVE treadmill inside the container that serves the ledger. Today's attack surface is Fastify + postgres.js; this adds the most-targeted browser engine on earth as an in-process dependency.
- Container cost: `--no-sandbox` or a seccomp/user-namespace profile (Chromium in Docker needs it), shared-memory sizing, and zombie-process reaping — all new operational failure modes for a self-hosted operator (the README's own posture: "production ready for a single operator/small trusted team").
- Fidelity: the highest possible — a URL prints with the exact v1.57.0 print stylesheet, auth via injected cookie. The one variant that renders the *real* app (InvoicePrint included).
- Verdict: the right answer *if batch PDF ever becomes a requirement* — priced and parked, not built on spec.

**P2 — Pure-JS PDF libs (pdfkit / pdfmake / @react-pdf/renderer / pdf-lib):**
- pdfkit: unmaintained stretches (its own README now suggests `pdf-lib` for some tasks); pdfmake: HTML→PDF quality gap; @react-pdf/renderer: React-facing, but re-implementing InvoicePrint a second time in a second dialect.
- The decisive mismatch: zprime's print faces are HTML/CSS with real layout (tables, indents, print: variants). Any pure-JS lib means **hand-rebuilding the invoice face and every report layout in a second rendering dialect**, then keeping two renderers in sync forever. The R-50 redesign made the faces CSS-first — exactly the thing these libs can't consume.
- Verdict: costs more than it returns at every point; declines to a clear no.

**P3 — Decline (recommended):** browser print→Save-as-PDF is the PDF story, stated in README/PROJECT as such. If batch ever materializes, P1 is the pre-priced design (headless service boundary, `page.pdf()` over the app's own routes, sibling container so the ledger container never carries Chromium).

## 4. XLSX, honestly (G-F)

### 4.1 What XLSX would add over the shipping CSV

Real advantages: multiple sheets in one workbook (GSTR-9's tables! TDS sections!), column widths, number formats, frozen headers, styling. Honest counter: **CSV+UTF-8-BOM already opens cleanly in Excel/LibreOffice** (BUG-009's guard already neutralizes spreadsheet formula injection), meta rows already carry provenance, and the suite verifies content. The gap is cosmetic-to-moderate, and it is a *format nicety*, not a workflow gap — nobody's filing depends on it.

### 4.2 The library field (researched September 2026)

- **SheetJS (`xlsx` on npm): frozen at 0.18.5 on the npm registry** — the project stopped publishing there; releases moved to self-hosted tarballs/CDN (community edition) and a paid CDN. The npm-resident 0.18.5 carries **known high-severity CVEs (ReDoS; prototype pollution — read-path) with "no fix available"** via npm; audit tools (Dependabot/Snyk/GitLab Advisory) flag it structurally. Installing it server-side today means knowingly pinning a vulnerable package in an internet-exposed app — disqualifying under this repo's R-09/production-ready posture.
- **ExcelJS: the standard replacement, maintained** (issue traffic current; the June-2026 tracker shows its own maintainers shepherding transitive-dep bumps). Two honest costs: (a) known transitive advisories (older `lodash`/`uuid`/`tmp`) that resolve via overrides/updates but need watching; (b) a real dependency footprint (xlsx is ZIP + XML machinery) placed wherever it runs.
- Everything else (SheetJS CE from their CDN, closed-source/paid tiers) violates the repo's plain-npm, self-hostable, no-paid-deps posture.

### 4.3 Where could XLSX run? Two placements, different risk

- **X1 — server-side XLSX (what "server-side export" literally asks):** ExcelJS in the server, new `GET /api/c/:cid/reports/:key?format=xlsx` binary-response class, `Content-Disposition: attachment`, and — because ExcelJS *reads* workbooks too — the server now hosts office-file parsing code in an auth-adjacent container. New response class + new dependency class for a cosmetic gain over CSV. **Decline.**
- **X2 — client-side XLSX:** same dependency, but in the browser bundle (where every report's data already lives, and where the export machinery already sits). No server change at all. Costs bundle weight (ExcelJS ≈ ~1 MB min, ~300 KB gz — roughly 3× the current whole JS bundle; lazy-loadable via dynamic import so only exporters pay it) and inherits the transitive-dep watch item — but keeps the attack surface out of the server container and reuses `ReportActions` as the single integration point. **The honest middle if real XLSX demand exists.**
- **X3 — decline (recommended default):** CSV-BOM is the spreadsheet story; re-record it as deliberate.

## 5. The finding the study surfaced instead — IRP SignedQRCode (Option D)

The submission ledger (`server/src/db/schema.ts` `einvoice_submissions`) stores `irn`, `ackNo`, `ackDate`, `status`, `error` — everything the printed GST e-invoice legally needs **except** NIC's `SignedQRCode` (and `SignedInvoice`) fields, which the NIC `eivital v1.10` GENIRN response carries and `services/irp.ts` currently maps away. Consequences: a printed zprime e-invoice carries no QR (B2B recipients expect the IRN QR on the face), and the eventual "print the registered e-invoice" surface (the natural R-66 line item) cannot be completed properly without it.

Shape of the increment (for a future cycle, not this one): store `signedQrCode` (+ optionally `signedInvoice`) additively in `einvoice_submissions` (migration 0017, nullable — zero backfill, pre-R-28 rows honestly null); surface it on the e-invoice status payload; render the QR on the InvoicePrint face for vouchers with an accepted IRN (client-side QR rendering — a tiny pure-JS QR encoder in the client, zero server deps); the e-invoice PDF/printer story then completes through the existing print face. ~Zero attack surface (storing a string the IRP already sent us), real compliance value, natural v1.58.0 candidate.

## 6. Options for the operator

- **Option A1 — server-side PDF via headless Chromium (P1):** price recorded above (image weight, sandbox profile, CVE plane); sibling-container design sketched. **Not recommended now** — zero requests; heavy surface for an unasked capability.
- **Option A2 — server/client pure-JS PDF (P2):** not recommended at any point — second-renderer maintenance forever, fidelity below the HTML faces.
- **Option A3 — client-side XLSX via ExcelJS (X2):** the only XLSX shape worth considering. Lazy-loaded dynamic import in `ReportActions` (an "Export XLSX" beside Export CSV), server untouched, bundle cost paid only when exporting. **Reasonable if the operator actually wants real workbooks** (multi-sheet GSTR-9, styled TB) — v1.58.0-sized. Not recommended on spec: CSV already serves the need.
- **Option A4 — server-side XLSX (X1):** not recommended in any scenario — all of X2's dependency cost plus a new server response class and office-parsing surface in the auth container.
- **Option D — IRP SignedQRCode storage + QR on the invoice face (recommended if anything is built):** the compliance item the study surfaced; additive migration, zero new deps server-side, tiny client QR renderer; completes the e-invoice print story started by R-66. Natural v1.58.0.
- **Option E — decline both G-E and G-F with evidence (recommended default):** record this study; update the R-66 investigation cross-reference; no release warranted per the R-46/R-40 precedent. The export/print surface shipped in v1.57.0 stands as the answer.

## 7. Test plan sketches (only if an option is approved)

- **A3 (client XLSX):** new `r67_ui.js` — export XLSX on a representative view (TB, GSTR-9) → capture download via the driver's CDP download machinery → assert ZIP magic bytes (`PK\x03\x04`) + parseable sheet names via a tiny JS unzip in the suite; CSV/XLSX content equality on the shared row builders; bundle-lazy-load asserted (network: xlsx chunk fetched only on first XLSX export). No server change → run.js/final/smoke untouched by construction.
- **A1 (headless batch, if ever):** sibling container with Playwright; suite asserts auth (no cookie → no PDF), report selection, and byte-sized sanity; the ledger container gains zero new deps.
- **D (SignedQRCode):** extend the R-47 drill — mock IRP emits a `SignedQRCode` string → stored → surfaced on status → QR renders on the print face; pre-R-28 rows (null) render no QR honestly; migration 0017 additive (fresh-install 17/17; backup/restore round-trip guard covers the new column).

## 8. Risks / Open questions / Next step

- **Risks of building now:** dependency + surface cost against zero recorded demand (R-61's implemented-then-rejected lesson); SheetJS-on-npm is disqualifying, ExcelJS carries a watch item; a second invoice renderer (P2) is a permanent maintenance tax.
- **Risks of declining:** none identified — browser print→Save-as-PDF covers the PDF need; CSV-BOM covers the spreadsheet need; both are suite-verified.
- **Open questions for the operator:** (1) is there real XLSX demand (multi-sheet workbooks, styled output) — A3 is the only shape worth building; (2) is batch/automation PDF on any horizon — if yes, P1 is pre-priced; (3) is the SignedQRCode compliance gap (Option D) wanted as v1.58.0.
- **Proposed next step:** operator picks D / A3 / E (or names A1 for a future batch cycle). Per protocol: implementation cycle → gates → fresh-volume estate → release. If E: docs-only record, no release (R-46 precedent).
