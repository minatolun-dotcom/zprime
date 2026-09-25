# R-66 INVESTIGATION — Export & printing support study

**Trigger (operator):** "do we have export/printing support? research it." — investigation-only; no production code touched.

**Date:** 2026-09-25 · **Baseline:** v1.56.0 (`75a5c04`) · **Method:** source inspection of the client export path (`client/src/lib/csv.ts`), every report view in `client/src/pages/Reports.tsx`, `ChequePrint.tsx`, print-CSS grep, server route grep (`Content-Disposition`/attachment/`xlsx`/pdf libraries), README/PROJECT.md claim audit, plus the TallyPrime parity research already grounded in this repo (`TALLYPRIME_SHORTCUTS_REFERENCE.md` §12, R-30/R-31 print notes).

---

## Executive Summary

**Yes — zprime has real export and printing support, but it is narrow and uneven.** There is exactly one export format (client-side CSV), one print surface (cheque face), and zero PDF/Excel/server-side export anywhere. The README's blanket claim — "Reports (all with period picker, Alt+F1 detailed/condensed, **CSV export**, drill-down)" — is **an overclaim in the same class R-64 caught for F-keys**: CSV export exists on **2 of 19 report views** (Trial Balance; Sales/Purchase Register). The other 17 report views, Day Book, Audit Trail, and Salary Register have no export at all.

Printing is one purpose-built surface: **Cheque Printing** (Gateway item J) renders a fixed-width cheque face with amount-in-words (Indian system) and prints via `window.print()` with Tailwind `print:block`/`print:hidden` classes — no `@media print` block exists in `index.css`, so **any other screen printed with Ctrl+P produces browser chrome and un-styled tables**. There is no voucher/invoice printing, no report printing, no e-invoice PDF.

Recommended direction (operator's pick below): **Option A — close the CSV overclaim first** (spread `csvDownload` across the 17 uncovered report views + honest README), optionally followed by a generic print-stylesheet for reports. This is small, suite-friendly, and matches the operator's standing preference for precise, honest increments.

---

## 1. The export stack, as found (client-side, one format)

`client/src/lib/csv.ts` (whole file, 56 lines) is the entire export machinery:

- `csvField()` — RFC 4180 field serialization + **formula-injection guard** (leading `=`, `+`, `@` neutralized with an apostrophe; leading `-` neutralized only when NOT a plain number, so `-1234.56` accounting data survives; leading tab/CR guarded too). This is the post-BUG-009 hardened version (BUG_REPORT.md listed the original minimal escaping; the hardening shipped).
- `csvBody()` — headers + rows → CRLF-joined CSV string.
- `csvDownload(name, headers, rows)` — prepends a UTF-8 BOM (Excel Unicode), builds a `Blob`, clicks a synthetic `<a download>`, revokes the object URL. **Everything happens in the browser**: no server involvement, no request, no endpoint.
- `textDownload(name, text, mime)` — same blob pattern for text (used only for e-invoice / e-way-bill JSON payloads, R-24/R-25).

Both helpers' doc comments say "Used by every report's Export CSV button" — that comment is the overclaim's other half.

### Who actually calls it (complete grep of `client/src`)

| Call site | Surface | Format |
|---|---|---|
| `Reports.tsx:141` → `TrialBalanceView.onCsv` (button at :399) | Trial Balance | CSV, includes R-60 Prev Year columns when toggled |
| `Reports.tsx:146` → `RegisterView.onCsv` (button at :535) | Sales Register / Purchase Register | CSV (`Date, No, Party, Amount, GST`) |
| `Reports.tsx:643` → `textDownload` | e-invoice JSON / e-way-bill JSON per voucher (GSTR-1 view buttons) | JSON (compliance payload, not a report export) |

That is the whole list. Nothing else in the client exports anything.

## 2. Per-report export coverage (the honest table)

From the `ENDPOINTS`/`TITLES` registry (`Reports.tsx` ~:1220/:1241) + the view-by-view button grep:

| Report view | Export CSV | Notes |
|---|---|---|
| Balance Sheet | **NO** | tree view, no button |
| Chart of Accounts (R-63) | **NO** | tree + filter, no button |
| Profit & Loss | **NO** | no button (incl. R-60 compare columns) |
| **Trial Balance** | **YES** | incl. R-60 compare columns; the reference implementation |
| Ledger Vouchers | **NO** | running-balance rows, no button |
| Group Summary | **NO** | |
| Cash / Bank Book | **NO** | |
| **Sales Register** | **YES** | flat 5-col row set |
| **Purchase Register** | **YES** | same view |
| Stock Summary | **NO** | |
| Bills Receivable | **NO** | per-party cards + nested bill tables |
| Bills Payable | **NO** | same view |
| GSTR-1 | **NO** (CSV) | per-voucher e-inv/e-way JSON download instead; no bulk table export |
| GSTR-3B | **NO** | |
| GSTR-9 | **NO** | multi-table annual view |
| TDS Report | **NO** | |
| TCS Report | **NO** | |
| Salary Register | **NO** | |
| Cheque Register | **NO** | (ChequePrint's list is a separate page; also no export) |

**Score: 3 of 19 keys covered** (trial-balance + the two register keys sharing one view), i.e. **2 of 17 distinct views**. Day Book and Audit Trail (separate pages, not in the registry) also have no export. The csv.ts header comment and the README/PROJECT.md "CSV export" claim describe state that was never true at scale — the export button was built on two views and never spread.

## 3. Printing, as found

- **Cheque Printing** (`client/src/pages/ChequePrint.tsx`, route `/company/:cid/cheques`, Gateway letter J): the one real print surface. Pick a recorded cheque → `ChequeFace` preview (fixed `w-[660px]` card: bank name editable, cheque no., date, payee from narration with `Being ` stripped, "Rupees … Only" amount-in-words via the Indian-system `words()` helper, boxed amount, A/c Payee Only stamp, signatory block) → `window.print()` button. Print-path uses Tailwind print variants: a `hidden print:block fixed inset-0` layer renders ONLY the cheque face; the app chrome is `print:hidden`. This was intentionally left untouched through the R-50 redesign ("ChequeFace print artifact intentionally untouched" — CHANGELOG). It is a real, working, physical-media feature — the strongest print support in the app.
- **Everything else:** zero. No other `window.print()` call, no print button on reports/vouchers, no `@media print` rules in `client/src/index.css` (the file has none), no `react-to-print`/PDF library anywhere in `package.json`. **Ctrl+P on a report prints whatever the browser renders — sticky Shell chrome, indigo top bar, rail — with no print stylesheet.** Practically: reports are screen-only.
- **No invoice/voucher printing:** a Sales voucher has no print/invoice surface at all (no invoice template, no VoucherScreen print button). Tally's bread-and-butter "print the invoice from the voucher" does not exist here. R-30 explicitly deferred EWB print/PDF ("browser print of the stored response is adequate").

## 4. Server-side export surface

None by design. Grep of `server/src` for `Content-Disposition`/`attachment`/`xlsx`/PDF: **zero hits** (only the string `content-disposition` inside `package-lock.json`'s Fastify dependency tree; R-12's backup/restore is a pg_dump **runbook**, deliberately not an app endpoint; the XML path is import-only). The server serves JSON report payloads; every export is composed client-side. This is consistent and defensible: client-side CSV needs no server change, keeps auth/session semantics untouched, and the formula-injection guard lives where the file is built.

## 5. Statutory export formats (GSTR etc.)

- **GSTR-1/3B/9** are on-screen computation reports only. There is **no portal-format export** (no GSTR-1 JSON/B2B CSV in the portal's accepted shape, no offline-tool file). The only statutory-format artifacts are the **per-voucher NIC v1.01 e-invoice JSON** and **EWB-01 JSON** payloads (generate + download, and optional direct IRP submission since R-28) — correct for their job, but not a return-file export.
- No Excel/XLSX support exists anywhere (no library in the dependency tree); CSV-with-BOM is the Excel story.

## 6. TallyPrime parity reference (honest, grounded in this repo's own research file)

From `TALLYPRIME_SHORTCUTS_REFERENCE.md` §12 and the R-64 investigation's research posture:

- Tally prints **everything**: any report, any voucher, invoices from vouchers (with template customization, Alt+P print menu / Ctrl+P per current screen), and exports any report to Excel (XLSX), CSV, PDF, XML, or image. Export is a uniform "Export" dialog on every screen; printing is a uniform "Print" dialog with report-configuration (F12-driven) options.
- zprime's posture differs by design in one respect: **Ctrl+P is browser-reserved in tab view** (R-51 posture; documented in the shortcuts reference's browser-constrained list) — a print feature here means an explicit on-page button + print stylesheet, or the PWA/app-window path, not a global Tally-style Ctrl+P.
- The parity gap that matters practically for Indian accounting use: (1) **invoice printing from a Sales voucher** (the daily paper artifact), (2) **GSTR-1 portal-shaped export** (accountants ask for it at filing time), (3) **uniform report export/print** (Tally users expect it on every screen). Item (3) is the smallest to reach; (1) and (2) are each a real feature.

## 7. Gap classification (each with effort shape)

- **G-A — CSV coverage gap (defect-adjacent docs issue):** README claims CSV on all reports; 17/19 views lack it. Effort: small per view (the data is already in the client; `csvDownload` is one call). The nested/tree views (Balance Sheet, COA, BS trees; Outstanding's party cards) need a flattening decision (indent columns or rank columns), which is the only non-mechanical part.
- **G-B — no print stylesheet:** no report is print-friendly. Effort: small-medium — one `@media print` block (hide Shell/rail/toolbars, black-on-white tables, repeat `<thead>`) + an explicit "Print" button on report toolbars (window.print()). Browser-reserved Ctrl+P stays untouched (R-51 posture).
- **G-C — no invoice/voucher printing:** the largest true feature (template, GST line rendering, party block, amount-in-words reuse from ChequePrint, print CSS). Would reuse `words()` (currently local to ChequePrint).
- **G-D — no statutory return-file export:** GSTR-1 in a portal-shape (JSON or the portal's B2B/B2C CSV templates). Needs a chosen target shape (the portal's formats are specific and versioned) — a real spec question for the operator.
- **G-E — no PDF:** PDF via server headless render or a JS lib (jspdf etc.) would add a dependency + attack-surface for marginal gain over G-B (browser "Save as PDF" from a print stylesheet covers the need honestly). Not recommended now.
- **G-F — no XLSX:** same class as G-E; CSV-with-BOM already opens cleanly in Excel. Not recommended now.

## 8. Options for the operator

- **Option A — CSV completion + honest docs (recommended first step, v1.57.0-sized):** add an Export CSV button to the 17 uncovered report views (flatten trees into ranked/indented rows, include R-60 Prev Year columns where present, include period labels in a header row for context), export Day Book and Audit Trail lists too, fix the csv.ts comment + README/PROJECT.md so the claim matches reality afterward (it will then actually be true). Suite: extend an acceptance suite (or a new one) asserting the button exists and downloads non-empty CSV on representative views (TB already covered; add P&L, Ledger Vouchers, GSTR-1, Salary Register shapes). No server change, no schema change.
- **Option B — A + report print stylesheet:** everything in A, plus one print CSS block + a Print button on report toolbars (clean paper output, thead repeat, Shell hidden). Still client-only. Recommended if the operator wants paper/PDF-of-record this cycle.
- **Option C — B + invoice printing from vouchers:** the full Tally-like story: A + B + a printable invoice face for Sales/Delivery Note vouchers (template, GST breakdown, amount-in-words). Larger; touches VoucherScreen; needs template decisions (plain vs GST invoice format).
- **Option D — statutory GSTR-1 export shape:** needs the operator to name the target (portal JSON vs accountant CSV template). Recommend deferring until asked, then investigating the current portal format properly rather than guessing.
- **Not recommended now:** server-side PDF (G-E) and XLSX (G-F) — dependency and surface cost for gain the browser print path already covers honestly.

## 9. Test plan sketch (Option A/B)

- Acceptance (browser): representative views (P&L, Ledger Vouchers, GSTR-1, Salary Register) render the Export CSV button; clicking it produces a download (CDP `Browser.setDownloadBehavior` + captured filename/content on the driver's chromium); TB/R-60 compare export keeps the empty-column honesty (R-60 F-60-4).
- Unit-ish (existing patterns): flatteners for tree views produce stable header/row shapes; formula-injection guard already hardened (BUG-009 fix) — add a case for ledger names like `=SUM(...)` flowing through a new view.
- Existing estate untouched: no keyboard/focus changes → r53/r54/r34 suites unaffected; report routes byte-identical → run.js/final/smoke unaffected.
- If Option B: print CSS verified via emulator media (`page.emulateMedia({ media: "print" })`) asserting Shell/rail hidden and thead visible; no suite depends on print behavior today.

## Risks / Open questions / Next step

- **Risks:** CSV flattening choices for tree views (indent vs ranked columns) are user-visible format decisions — pick one convention and apply it uniformly (recommend: indent-with-spaces + a Level column, matching Tally's exported look). Download capture in the browser suite is new machinery (one driver helper); risk contained to new suites. No accounting, keyboard, or API surface changes.
- **Open questions for the operator:** (1) which option (A / B / C / D-defer); (2) if A: tree-view flatten convention OK as recommended; (3) if C (later): invoice template plain vs GST-format.
- **Proposed next step:** on approval, implement the chosen option as v1.57.0 per protocol (investigation → implementation → gates → fresh-volume estate → release commit + tag + docs commit).
