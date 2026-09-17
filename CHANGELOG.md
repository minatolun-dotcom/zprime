# Changelog

## Unreleased — R-10 duplicate-submission idempotency (B-10)

**813/813 automated checks passed (Python: 39+88+65+61+531+29), 208/208 browser checks (153 baseline + 12 R-03 + 9 R-04 + 12 R-05 + 12 R-07 + 10 R-10), zero failures.**

### R-10 — Duplicate-submission idempotency: B-10 (CONFIRMED P2 → IMPLEMENTED, full scope approved)

**Root cause (investigation, live-reproduced on v1.9.0):** `POST /vouchers` had zero idempotency machinery. A double-accept or network retry posted a second complete, balanced voucher — sequentially (2× identical Payment → vouchers no=1, no=2) and concurrently (3 simultaneous identical POSTs → 3 vouchers, auto-numbering happily serving duplicates). A client-accurate bill-wise Sales duplicate inflated **Receivables 3,000 → 6,000** with two open bills; TB stays balanced throughout, so no report ever flags it. The client's only guard was the disabled Accept **button** — the primary keyboard-first `Ctrl+A` path called `save()` unguarded (and its hotkey closure captured a stale `saving` value). The plan's INV2 probe never graduated into a suite: zero coverage.

**Fix (approved full scope):**
- **Migration `0005_r10_idempotency_keys.sql` (additive):** `idempotency_keys` table — `company_id` FK (CASCADE), `key` FK→voucher (`CASCADE`), `created_at`, `UNIQUE(company_id, key)`, both lookup directions indexed. Hand-authored SQL + snapshot + journal entry per the established repo convention.
- **`vouchers.ts` POST:** optional client-generated `idempotencyKey` (body or `X-Idempotency-Key` header, ≤200 chars). One key = one business event: the lookup runs **before** the insert; record + voucher insert share **one transaction**; on a same-key unique-index race the loser resolves the winner's voucher and returns it (no 409). Replay returns the **original** voucher, including after cancellation — the replier sees exactly what the first request posted. No key = byte-identical legacy behavior (fully backward compatible).
- **`VoucherScreen.tsx`:** a UUID is generated when a *new* voucher form opens (retry-safe: re-submits reuse it; edits carry none) and sent with every save; a `savingRef` guard makes the `Ctrl+A` hotkey path single-shot (fixes the stale-closure hole).
- **`final_regression.py` +12 R-10 checks:** same-key replay returns the original voucher id; concurrent same-key POSTs → one voucher; keys are company-scoped (same key in another company posts fresh); keyless legacy unchanged; no-key edits unaffected; replay-after-cancel returns the cancelled voucher faithfully.
- **`r10_ui.js` (new browser suite, 10 checks):** double-accept (Ctrl+A ×2) through the real UI → exactly one voucher, exactly one POST fired (client guard observed), no error banner; a fresh form legitimately posts the second voucher (no over-protection); TB balanced.

## v1.9.0 — R-09 fail-fast deployment secrets (B-08) — BREAKING

**801/801 automated checks passed (Python: 39+88+65+61+519+29), 198/198 browser checks (153 baseline + 12 R-03 + 9 R-04 + 12 R-05 + 12 R-07), zero failures.**

### R-09 — Fail-fast deployment secrets: B-08 (CONFIRMED P1 deploy-dependent → IMPLEMENTED, full fail-fast approved) — ⚠ BREAKING

**Root cause (investigation, source-traced on v1.8.0):** three independent fallback layers booted the app with public secrets — compose `${JWT_SECRET:-change-me-in-production}` / `${ADMIN_PASSWORD:-admin123}`, the auth plugin's in-process `JWT_SECRET ?? "dev-secret"` (the server never refused to boot), and the first-boot seeding fallback `ADMIN_PASSWORD ?? "admin123"`. The JWT payload is stateless `{uid, username}`, so anyone who knows the public default could forge a token for any user id: a **full authentication bypass** on any deployment exposed beyond localhost.

**Fix (approved: full fail-fast, always enforced — no dev escape hatch):**
- **`auth.ts`:** boot is refused when `JWT_SECRET` is missing, empty, or one of the known-insecure values (`dev-secret`, `change-me-in-production`) — with guidance pointing at `.env.example`.
- **`index.ts`:** first-boot admin seeding requires `ADMIN_PASSWORD` (when users already exist the variable is irrelevant — no rotation machinery in scope).
- **`docker-compose.yml`:** `:?` required interpolation for `JWT_SECRET`/`ADMIN_PASSWORD` with actionable error text (compose fails before the app starts); `POSTGRES_PASSWORD` keeps its default (db publishes no ports — documented residual risk).
- **Test rig:** all seven suite spawn sites now set explicit `JWT_SECRET`/`ADMIN_PASSWORD` fixtures; the verification stack runs with a committed-pattern `.env` (never committed).
- **README:** `.env` is no longer optional; breaking-change callout with upgrade instructions.

**⚠ Upgrade instruction (≤ v1.8.0 → v1.9.0):** create `.env` (`cp .env.example .env`) and set a strong `JWT_SECRET` + `ADMIN_PASSWORD` before `docker compose up`. Deployments relying on the old defaults will refuse to boot — by design.

| Suite | Checks | Result |
|---|---|---|
| Smoke | 39 | PASS |
| Adversarial attack | 88 | PASS |
| Bug-fix regression | 65 | PASS |
| Independent reconciliation | 61 | PASS |
| Final regression (incl. 5 R-09 checks) | 519 (+5) | PASS |
| Attack-the-fixes | 29 | PASS |
| Real-browser UI acceptance | 153 + 12 + 9 + 12 + 12 | PASS |
| Typecheck (server + client) | — | PASS |
| Docker fresh volume (with .env) | — | PASS |
| Compose without .env | refused with guidance | PASS |

## v1.8.0 — R-08 cross-company master-reference validation (B-07)

**796/796 automated checks passed (Python: 39+88+65+61+514+29), 198/198 browser checks (153 baseline + 12 R-03 + 9 R-04 + 12 R-05 + 12 R-07), zero failures.**

### R-08 — Cross-company master references: B-07 (CONFIRMED P1 → IMPLEMENTED, route-level fix approved)

**Root cause (investigation, live-reproduced on v1.7.0):** crud.ts validated company ownership of the *row* but never the *FK ids in the request body*, and the schema FKs (ledgers.group_id, stock_items.unit_id, pay_heads.ledger_id, …) are global. Proven corruption chain: a pay-head in company A referencing company B's ledger was accepted (200), payroll then posted a Dr against B's ledger — an entry invisible to BOTH companies' reports (ledgerBalances is company-join-scoped) — leaving A's Trial Balance **Dr=0 / Cr=10,000, unbalanced silently** (BS difference 10,000). Also accepted: ledgers with B's group, items with B's unit/stock-group. Voucher-path validation (assertLedgersTx/assertRefsTx/assertTypeTx) was already company-scoped — the master-CRUD and payroll boundaries never received the same treatment.

**Fix (route-level; approved scope, no migration):**
- **Central `refs` hook in crud.ts (`assertCompanyRefs`):** an `opts.refs` spec per master — before insert/update, every provided FK id is verified `companyId = c`, else 400 ("… does not exist in this company"). Wired: ledgers.`groupId`, stock-items.`unitId`/`groupId`/`categoryId`, pay-heads.`ledgerId`.
- **salary-structure PUT:** every `headId` verified in-company (employee check already existed).
- **Payroll belt-and-braces:** processing asserts every used pay-head's `ledgerId` belongs to the company — a legacy foreign-ledger row (inserted via psql in tests) now fails **loudly at posting** with a named-head 400 instead of silently unbalancing the books; TB asserted balanced after the rejection.
- **Division of labor (documented in tests):** a legacy head whose *ledger* is foreign passes the headId check (the head row exists in-company) and is caught at posting — exactly the belt-and-braces path.
- Existing books keep working (read paths unchanged; only new writes validated); a legacy row only surfaces when payroll actually uses it, with a precise, actionable error.

| Suite | Checks | Result |
|---|---|---|
| Smoke | 39 | PASS |
| Adversarial attack | 88 | PASS |
| Bug-fix regression | 65 | PASS |
| Independent reconciliation | 61 | PASS |
| Final regression (incl. 17 R-08 checks) | 514 (+17) | PASS |
| Attack-the-fixes | 29 | PASS |
| Real-browser UI acceptance | 153 + 12 + 9 + 12 + 12 | PASS |
| Typecheck (server + client) | — | PASS |
| Docker fresh volume | — | PASS |

## v1.7.0 — R-07 opening balances in reports (B-02)

**779/779 automated checks passed (Python: 39+88+65+61+497+29), 198/198 browser checks (153 baseline + 12 R-03 + 9 R-04 + 12 R-05 + 12 R-07), zero failures.**

### R-07 — Opening balances in reports: B-02 re-verified (1×P1 + 1×P2 fixed; 1×P2 documented per approved Model A)

**Investigation (`R-07_INVESTIGATION.md`, live-reproduced on v1.6.0):** the action plan's B-02 "P0" was actually three findings + one non-bug. **F-07-1 (P1):** `billWiseOutstanding()` never read `ledgers.opening_balance` — a migrated book's party balances were silently missing from Bills Receivable/Payable (debtor opening 50,000 visible in TB, AR total 0). **F-07-3 (P2):** the BS zeroed Stock-in-Hand ledgers by exact group *name*, so ledgers under SIH sub-groups (Finished Goods, Raw Materials, …) double-counted stock in assets, silently. **F-07-2 (P2, re-graded from the plan's P0):** unfunded item openings leave BS `difference = −openingStock` — surfaced honestly by the "Difference in books" banner. **F-07-4:** openings never contaminate P&L movement — NOT A BUG — VERIFIED.

**Fixes (scope approved: F-07-1 + F-07-3; F-07-2 = Model A document-only):**
- **F-07-1 (`server/src/services/accounting.ts`):** party master openings merge into Outstanding reports as a synthetic **"Opening Balance"** bill dated books-begin — the A-05 on-account merge precedent, allocation sign convention (Debtors Dr +, Creditors Cr −). Display-only by construction: `validateBillsTx` settles only real allocations, so Against Ref against it is a clean 400; on-account receipts net into the party total. No fixture regressions: no pre-existing test party carries a master opening.
- **F-07-3 (`balanceSheet()`):** structural zeroing — `descendantGroupIds()` resolves the Stock-in-Hand group and every descendant, replacing the name-equality rule. Sub-group stock ledgers are excluded from the asset fold exactly like the top node.
- **Independent engine aligned (`scripts/acceptance/engine.py`):** `bills()` now mirrors the opening-bill rule (semantic fidelity; no existing fixture exposes it — the new R-07 checks do).
- **Model A documentation (PROJECT.md):** opening-balance architecture + the documented opening-journal workflow (Dr stock/asset, Cr Capital) for unfunded item openings; the honest banner is the designed behavior.

| Suite | Checks | Result |
|---|---|---|
| Smoke | 39 | PASS |
| Adversarial attack | 88 | PASS |
| Bug-fix regression | 65 | PASS |
| Independent reconciliation | 61 | PASS |
| Final regression (incl. 16 R-07 checks) | 497 (+16) | PASS |
| Attack-the-fixes | 29 | PASS |
| Real-browser UI acceptance | 153 + 12 + 9 + 12 + 12 (new r07_ui.js) | PASS |
| Typecheck (server + client) | — | PASS |
| Docker fresh volume | — | PASS |

## v1.6.0 — R-06 negative-stock guard (B-01)

**763/763 automated checks passed (Python: 39+88+65+61+481+29), 186/186 browser checks (153 baseline + 12 R-03 + 9 R-04 + 12 R-05), zero failures.**

### R-06 — Negative-stock availability guard: B-01 (CONFIRMED P1 → IMPLEMENTED, Model 1 approved)

**Root cause (investigation, live-reproduced on v1.5.0):** nothing in the posting path checked availability — an oversell was accepted silently (sale of 15 against stock of 10 posted HTTP 200, charging WAVG cost for 5 phantom units); with stock already negative, further sales posted **zero** COGS (goods out for free); the next purchase then averaged positive value onto a negative quantity (qty −2, value +1,000), overstating P&L gross profit by exactly the phantom margin. `stock.ts` compounded it: WAVG cost went to 0 at `runningQty ≤ 0` and a hardcoded clamp (`> -1000`) zeroed negative `runningValue` — reports consumed the result as truth. No persisted corruption (valuation recomputes per call; cancel/uncancel self-heals; double-entry stayed balanced), which is why P1, not P0.

**Fix (Model 1 — reject oversell, approved product policy):**
- **Chain-comparison availability guard (`server/src/routes/vouchers.ts`):** for non-opted-in companies, every movement is replayed chronologically (date, then voucher id — grandfathered negative states from the permissive era are tolerated *as found*, never blocked retroactively). A mutation is rejected with **400** only when it makes some step invalid that was previously valid — a new oversell, or an edit/cancel/uncancel/delete that strands a previously-fine downstream sale. No side doors: the guard covers create, edit, cancel, uncancel, delete, and both XML import paths. Physical Stock rows are absolute counts (opening folded once, PS replaces the running quantity, diff posted at running avg).
- **Company opt-out (`allowNegativeStock`, default false):** migration `0004_r06_negative_stock_guard.sql` (additive, idempotent column add + backfill `false`), Drizzle schema/snapshot/journal per the project's hand-crafted convention. Opted-in companies keep the permissive model but now get **honest valuation** — `stock.ts` no longer clamps negative value to 0 and caps WAVG unit cost at the item's latest purchase rate instead of charging 0 for phantom units (opt-in semantics documented in code).
- **UI (`client/src/pages/CompanySettings.tsx`):** "Allow Negative Stock" toggle with explanatory copy.

**Fixture policy (disclosed):** pre-R-06 fixture companies in the baseline browser suite and final-regression seeds legitimately oversell (they test voucher/report UI written under the permissive model) and opt in explicitly via `D.allowNegativeStock(...)` — a seeding helper, never a bypass of asserted guard behaviour; all guard coverage lives in the dedicated R-06 company checks (+21 in final_regression).

| Suite | Checks | Result |
|---|---|---|
| Smoke | 39 | PASS |
| Adversarial attack | 88 | PASS |
| Bug-fix regression | 65 | PASS |
| Independent reconciliation | 61 | PASS |
| Final regression (incl. 21 R-06 checks) | 481 (+21) | PASS |
| Attack-the-fixes | 29 | PASS |
| Real-browser UI acceptance | 153 + 12 + 9 + 12 | PASS |
| Typecheck (server + client) | — | PASS |
| Docker fresh volume | — | PASS |

## v1.5.0 — R-05 CN/DN GST reporting + Apply-GST party balance

**742/742 automated checks passed (Python: 39+88+65+61+460+29), 186/186 browser checks (153 baseline + 12 R-03 + 9 R-04 + 12 R-05), zero failures.**

### R-05 — Credit/Debit-note GST reporting: B-06 (CONFIRMED P1 → IMPLEMENTED)

**Root cause (investigation, live-reproduced on v1.4.0):** `voucherGst()` folded every row with `Math.abs()`, erasing the reversal sign that credit/debit notes carry in the books — so a CN *added* to GSTR-1 output tax and a DN *added* to ITC (probe: GSTR-3B net 1,440 vs book truth 1,080; GSTR-1 taxable 17,000 vs 13,000). `gstr1()` also hardcoded `cdnr: []` — no Table 9B anywhere. The books were always right; the statutory reports contradicted them.

**Fix (`server/src/services/gst.ts`, one service file):** direction-aware aggregation — raw signed entry amounts are summed and the voucher side applied once, so sales stay positive and notes become negative (the `sign` variable that v1.4.0 computed and never used now does its job). `gstr1()` gains real **CDNR** (registered) and **CDNUR** (unregistered) sections with positive magnitudes, plus `net*` totals (Table 9 net of 9B) that reconcile exactly with the ledgers. Rate buckets and `deriveRate` follow the signed model. A-07 duty-heads-win rule and R-01 Table-12 Sales-only rule unchanged. GSTR-3B outward/ITC become net of notes; net payable now equals the ledger truth.

**UI (`client/src/pages/Reports.tsx`):** GSTR-1 shows a Net outward supplies card (when notes exist) and CDNR/CDNUR tables alongside B2B/B2C/HSN.

### Apply-GST party balance (approved scope extension)

**Defect (live-reproduced in browser on the interim build):** the voucher-entry Apply-GST helper never worked end-to-end — its taxable-base filter was sign-inverted (`isSalesSide ? amount > 0 : amount < 0`, but sales income lines are credits), so duty rows were never inserted for Sales/Purchase (error "Add taxable income/expense lines…"), CN/DN duty was pushed on the wrong side, and the party row was never re-balanced after duty insertion, so Ctrl+A right after Apply GST was rejected ("Voucher does not balance — difference …"). A real-user flow (open Sales → party → income line → Apply GST → Ctrl+A) could never save.

**Fix (`client/src/pages/VoucherScreen.tsx`):** explicit per-type base sign map (`Sales −1, Credit Note +1, Purchase +1, Debit Note −1`) — duty is computed on the correct rows and pushed on the correct side for all four types — and the party row is re-balanced to the net of all other rows after duty (re)insertion, so the voucher saves immediately (Tally behaviour). UI-only; no API, schema, or accounting-engine change.

**Verification notes:** the acceptance engine's `gstr3b_app`/`gstr1_app` mirrors previously encoded the OLD semantics ("no netting of notes") and were re-aligned to the correct model; the R-02 cancel/uncancel assertions keep exact-magnitude strength with corrected direction (cancelling a CN raises net outward by exactly the CN amount). The independent reconcile.py scenario proves the cross-period case (note in May against an April invoice → negative month net, cumulative identity holds).

| Suite | Checks | Result |
|---|---|---|
| Smoke | 39 | PASS |
| Adversarial attack | 88 | PASS |
| Bug-fix regression | 65 | PASS |
| Independent reconciliation (incl. R-05 CN/DN scenario) | 61 (+13) | PASS |
| Final regression (incl. R-05) | 460 (+43) | PASS |
| Attack-the-fixes | 29 | PASS |
| Real-browser UI acceptance | 153 + 12 + 9 + 12 R-05 scenario (incl. Apply-GST real save) | PASS |
| Typecheck (server + client) | — | PASS |
| Docker fresh volume | — | PASS |

## Post-v1.3.0 — R-04 XML import integrity

**686/686 automated checks passed (Python 686 = 39+88+65+48+417+29), 174/174 browser checks (153 baseline + 12 R-03 + 9 R-04), zero failures.**

### R-04 — XML import integrity: B-03 + B-05 + B-13 + B-14 (CONFIRMED P0 → IMPLEMENTED)

**Root cause (investigation):** `server/src/routes/import.ts` predated and never adopted the API's validation layer. Live-reproduced on v1.3.0: an unbalanced voucher imported without error left the Trial Balance permanently off (totalDebit 400 / totalCredit 600); the import used raw `db` calls with no transaction (partial imports persisted on mid-file failure); it bypassed `validateEntries`, bill-allocation validation, and reference checks; imported ledgers were hard-coded `taxability: "none"` so GSTR-1 reported `taxable: 0` while duty was still counted.

**Fix (single authorization/validation boundary, one file):** the entire import now runs in **one `db.transaction`** — any rejection rolls back masters, vouchers, and allocations atomically. Every voucher is validated with the **same rules as the API path** (balanced double-entry via the shared `validateEntries`, exported from `vouchers.ts`; F-INV-01 inventory rules; bill-allocation validation mirroring `validateBillsTx` — name required, non-zero, direction must match the entry, allocations must total the entry). Failures return **400 with the offending voucher number** (`Voucher R04-UB-1 (Journal): Debits and credits do not balance …`). Imported-ledger `taxability` now mirrors zprime's own classification (Sales/Purchase family → `taxable`, duty ledgers → `none`), making GSTR-1 internally consistent for imported data.

**B-14 (found during browser verification, approved into R-04):** the import page's **"Upload file" mode had never worked** — `client/src/lib/api.ts` forced `Content-Type: application/json` onto every body with data, including `FormData`, so the server rejected multipart uploads (`Body is not valid JSON`). All prior suites missed it because they POST JSON directly. Fix: the client helper no longer sets a Content-Type for FormData (the browser sets its own multipart boundary). Paste-XML mode was unaffected.

**Accounting safety:** no accounting formula changed. The import is a write path; validation only rejects input that today corrupts books (previously-valid balanced imports behave identically — proven by the full regression suite, including the pre-existing import fixtures in smoke/adversarial/attack2).

| Suite | Checks | Result |
|---|---|---|
| Smoke | 39 | PASS |
| Adversarial attack | 88 | PASS |
| Bug-fix regression | 65 | PASS |
| Independent reconciliation | 48 | PASS |
| Final regression (now incl. R-04) | 417 (+16 R-04 API checks, +2 B-14 multipart checks) | PASS |
| Attack-the-fixes | 29 | PASS |
| Real-browser UI acceptance | 153 + 12 R-03 + 9 R-04 scenario | PASS |
| Typecheck (server + client) | — | PASS |
| Docker fresh volume | — | PASS |

## Post-v1.2.0 — R-03 user→company authorization (released as v1.3.0)

**680/680 checks passed — zero failures.**

### R-03 — User → company authorization (CONFIRMED P1 → IMPLEMENTED)

**Root cause (Phase-1 investigation):** authentication existed (JWT `{uid, username}` in an httpOnly cookie) but there was **no user→company authorization boundary anywhere** — `cid()` checked only company *existence*, `GET /companies` returned the whole table, and a second authenticated user could read, modify, delete and cancel any company's data (proven live). Safe only while deployments were single-user by convention.

**Architecture (approved Model C — membership junction):** new `user_companies` table (`user_id` → users FK cascade, `company_id` → companies FK cascade, `role` metadata `owner|accountant`, unique pair, both-direction indexes). **Authorization is centralized inside `cid()`**: every `/api/c/:cid/*` route (36 routes) now requires the authenticated user to hold a membership row, resolved **server-side on every request** — revocation is immediate, no JWT change (`{uid, username}` kept; no companyId in the token). Unauthorized companies answer **404** — indistinguishable from unknown, no existence leak. Existing same-company resource validation (ledger/item/company checks) is unchanged and remains defense-in-depth.

**Company routes:** `GET /companies` returns only membership-scoped rows (with role); `GET/PUT /companies/:id` membership-gated 404; `POST /companies` now atomic — company + seed + **owner membership** commit in one transaction (no orphan companies). Minimal **owner-only** member management: `GET/POST /companies/:id/members` (create user + membership; accountant role cannot manage members — 403) and `DELETE /companies/:id/members/:userId` (last-owner removal → 409; leaving as co-owner → 200). No invitations/email/password-reset/SSO — out of scope.

**Migration 0003 (additive):** `user_companies` + FK on `vouchers.cancelled_by → users.id` (`ON DELETE SET NULL` — deleted users never block voucher history). **Backfill:** every existing user × every existing company gets an owner membership — exactly the pre-R-03 effective access model, so no existing deployment loses access; deterministic and status-quo-preserving by construction. Verified on a fresh volume and as an in-place upgrade from a simulated v1.2.0 database (journal 3 → 4, data intact, seeded admin creates companies with owner membership).

**Frontend:** company list is automatically filtered (server-driven); a stale/revoked `/company/:cid` URL now renders a neutral **"Company not found"** notice with a *Back to Companies* recovery link — never "you don't own this company".

**Verification:** final regression 368 → **399** (+31 R-03 checks: directory scoping, cross-company 404s across vouchers/masters/reports/GST/cheque-register/import, member-vs-owner rights, immediate revocation, last-owner/self-removal guards, `cancelled_by` = cancelling user). Real-browser: existing suite **153/153** plus a dedicated **12/12** R-03 UI scenario (owner sees both companies, member sees only his, direct Alpha navigation → neutral 404, no data leak, recovery link, owner revocation → immediate loss without re-login). Docker fresh volume + upgrade simulation clean, 0 log errors. Accounting mathematics untouched — authorization decides *who*, never *how*.

| Suite | Checks | Result |
|---|---|---|
| Smoke | 39 | PASS |
| Adversarial attack | 88 | PASS |
| Bug-fix regression | 65 | PASS |
| Independent reconciliation | 48 | PASS |
| Final regression (now incl. R-03) | 399 | PASS |
| Attack-the-fixes | 29 | PASS |
| Real-browser UI acceptance | 153 + 12 R-03 scenario | PASS |
| Typecheck (server + client) | — | PASS |
| Docker fresh + v1.2.0 upgrade | — | PASS |

**Not tagged yet; v1.0.0…v1.2.0 remain untouched. Known limitations:** `role` is metadata only (no RBAC permission matrix); no user disable/deactivate flag (JWTs valid until 7-day expiry; no revocation list); no membership-UI page (API-driven management); audit trail (created_by/updated_by) deliberately deferred.

## Post-v1.1.1 — R-02 voucher cancellation (unreleased)

**790/790 checks passed — zero failures.**

### R-02 — Voucher cancellation (MISSING FEATURE → IMPLEMENTED, P1)

**Model A — mark + exclude.** Cancellation is a voucher-state transition, not a reversal: the original voucher row, its number, and all attached entries/inventory/bills remain physically intact; every active report reader (already filtering `isCancelled = false`) simply excludes the voucher while it is cancelled. **No opposite/reversal accounting entries are ever created.**

**Database (additive migration `0002_r02_cancel_metadata.sql`):** `vouchers.cancelled_at` (timestamptz, nullable), `vouchers.cancel_reason` (text, nullable), `vouchers.cancelled_by` (integer, nullable — plain user id, no FK; R-03 dependency documented). No backfill, no destructive change; verified on fresh volume and as an in-place upgrade from a simulated v1.1.1 database (0000+0001 journal rows; 0002 applied alone, data intact).

**API:** `POST /vouchers/:id/cancel` (optional `reason`, trimmed, 200-char cap) and `POST /vouchers/:id/uncancel` — company-scoped, `SELECT … FOR UPDATE` inside one transaction, clean 404/400/409 errors (no SQL leakage). Double cancel → 409; uncancel of an active voucher → 409; malformed id → 400. Cancellation guards reuse the DELETE settled-bill protection via a shared helper. Uncancel re-validates that the voucher can safely become active again (no duplicate payroll run can coexist — the existing payroll processed-month protection is reused).

**Protections:** normal PUT on a cancelled voucher → 409 "Cancelled vouchers cannot be edited"; DELETE on a cancelled voucher → 409 "Cancelled vouchers cannot be deleted. Uncancel the voucher first." (cancellation is the audit-preserving state). New payroll guard: a payroll voucher representing a processed run cannot be hard-deleted (payslips cascade would silently unlock the processed month — Phase-1 latent P2, closed here).

**Reports:** all existing readers already respected cancellation; the two Phase-1 gaps are fixed — **Salary Register** and **Cheque Register** now exclude cancelled vouchers.

**UI:** Day Book keeps cancelled rows visible with a `Cancelled` badge, `Uncancel` action, and **no** Alter/Del actions; VoucherScreen shows a read-only banner for cancelled vouchers. Keyboard-first flow preserved.

**Numbering:** cancellation never rewinds or reuses voucher numbers (explicitly tested: cancel #2 of 3 → next is #4).

**Regression coverage:** `final_regression.py` grew 283 → **368** (+85 R-02 checks): per-type cancel/uncancel (Sales, Purchase, Payment, Receipt, Contra, Journal, CN, DN, Delivery Note, Receipt Note, Stock Journal, Physical Stock, Manufacturing, Payroll) with effect-exactness; state-machine attacks (double cancel, uncancel active, edit/delete cancelled, cancel deleted/nonexistent, malformed id, unauthenticated, cross-company); before/cancelled/after-uncancel TB/BS/P&L/ledger/AR/cash equality (Active → Uncancelled is identical to the paisa); settled-bill vs unsettled bill; numbering; GST (GSTR-1/3B incl. HSN R-01 semantics) exclusion; Salary/Cheque Register exclusion. Independent engine (`engine.py`) now treats cancelled vouchers as inactive (`_cancelled`) and the real-browser acceptance asserts the engine-expected deltas and the exact post-uncancel restoration — **+13 UI checks, 140 → 153** (`r02/daybook-badge`, `number-preserved`, `no-alter/no-delete/uncancel` actions, `gstr1-excluded`, `receivables-shift`, `voucher-readonly-banner`, `tb/receivables/gstr1-restored`, `badge-cleared`).

### Verification record (post-v1.1.1 R-02)

| Suite | Checks | Result |
|---|---|---|
| Smoke | 39 | PASS |
| Adversarial attack | 88 | PASS |
| Bug-fix regression | 65 | PASS |
| Independent reconciliation | 48 | PASS |
| Final regression (now incl. R-02) | 368 | PASS |
| Attack-the-fixes | 29 | PASS |
| Real-browser UI acceptance (now incl. cancellation) | 153 | PASS |
| Typecheck (server + client) | — | PASS |
| Docker fresh volume + restart persistence + cancel/uncancel probe | — | PASS |
| Docker upgrade simulation (v1.1.1 → 0002) | — | PASS |

**Total: 790/790 checks — zero failures** (v1.1.1 was 711; +79, none removed or weakened). Not tagged; v1.0.0, v1.1.0 and v1.1.1 remain untouched.

## Post-v1.1.0 — R-01 GSTR-1 HSN outward-supply reporting fix (unreleased)

**711/711 checks passed — zero failures.**

### R-01 — GSTR-1 HSN summary direction & attribution (FIXED, P1 reporting integrity)

**Root cause (investigation-confirmed):** the GSTR-1 HSN summary (Table 12) selected inventory rows by *quantity direction* (`qty > 0`) instead of outward voucher semantics. In zprime's signed convention (+ = stock in, − = stock out) this silently included **purchases, receipt notes, stock-journal targets** and **excluded sales**; it also had no voucher-type filter at all. Additionally the HSN code and GST rate were read only from inventory snapshot columns that UI-created vouchers leave NULL, so rows rendered as `hsn="-"`, `rate=0`. B2B/B2C and GSTR-3B use a different, correct pipeline (`voucherGst(..., "outward")`), which is why the 622-check baseline (asserting only b2b/b2c/3B totals) never caught it.

**Fix (server/src/services/gst.ts, `gstr1()` only):** the HSN population is now defined by voucher type — `voucherTypes.name = "Sales"` — the same semantics as `voucherGst(..., "outward")`; Credit/Debit Notes stay out of Table 12 (CDNR remains a documented gap). HSN/rate resolve snapshot → stock-item master fallback (`inventoryEntries.hsnSac ?? stockItems.hsnSac`, same for rate); historical imported snapshots still win. Outward quantity is reported positive (`Math.abs`). Ledger/TB/BS/P&L/GSTR-3B/TDS/stock/numbering are untouched — the change affects only the HSN block of one read-only report.

**Regression coverage:** `final_regression.py` grew 224 → **283** (+59): purchase-only HSN empty; exact sale row (code/qty/taxable/rate); the ₹91,111 canary purchase vs ₹1,000 sale on the same HSN (must be absent — this check fails against the old implementation); Receipt Note / Delivery Note / Stock Journal / Physical Stock non-pollution; master-fallback attribution (HSN 9999 @ 12% from the item master); stored-snapshot precedence; multiple HSNs aggregating independently; intra- and inter-state rows; backdated/edited/deleted sale propagation; documented population relationship (HSN = Sales-with-inventory taxable; credit notes NOT netted; accounting-only Sales excluded). The independent engine's HSN expectation is now actually consumed: `engine.py` emits `hsnMonth` (Sales-only, computed from recorded items) and `run.js` asserts each rendered HSN row's qty/taxable/rate cell-by-cell plus purchase-exclusion canaries — **+11 UI checks, 129 → 140**.

### Verification record (post-v1.1.0 R-01 fix)

| Suite | Checks | Result |
|---|---|---|
| Smoke | 39 | PASS |
| Adversarial attack | 88 | PASS |
| Bug-fix regression | 65 | PASS |
| Independent reconciliation | 48 | PASS |
| Final regression (now incl. R-01) | 283 | PASS |
| Attack-the-fixes | 29 | PASS |
| Real-browser UI acceptance (now incl. HSN reconciliation) | 140 | PASS |
| Typecheck (server + client) | — | PASS |
| Docker fresh volume + restart persistence + HSN probe | — | PASS |

**Total: 711/711 checks — zero failures** (v1.1.0 was 622; +89, none removed or weakened). Not tagged yet; v1.0.0 and v1.1.0 remain untouched.

## v1.1.0 — Inventory-only vouchers and report coverage (2026-09-12)

**622/622 checks passed — zero failures.** Previous baseline v1.0.0 (483 checks) remains tagged and untouched. No new tag had been created for the post-release work until this release; see sections below for the exact per-suite record.

### F-INV-01 — Inventory-only Stock Journal / Physical Stock (FIXED)

Inventory-category vouchers (Stock Journal, Physical Stock, Delivery/Receipt Note, Mfg Journal) may now be **inventory-only** through the real UI: zero accounting rows (`entries: []`) are accepted when at least one real stock movement (item + non-zero qty) exists. Accounting-only vouchers still require valid, balanced double-entry rows — nothing else was relaxed. A Physical Stock counted quantity cannot be negative. The inventory `kind` enum mismatch (`physical` rejected by schema though sent by the client) was corrected. No phantom accounting entries are created by inventory-only vouchers (TB/BS/P&L/GST/cash/bank/AR-AP untouched). Verified via API regression, adversarial tests, concurrency, cross-company isolation, independent reconciliation, the real browser (`inv/sj-only`, `inv/ps-only` scenarios), and a clean Docker deployment with restart persistence.

### O-1 — Cash/Bank period coverage (CLOSED — NOT REPRODUCIBLE)

**Production Cash/Bank closing logic was verified correct. No production Cash/Bank logic was changed.** The originally suspected all-time-closing defect does not exist: Opening is postings before `from`, Movement is `[from, to]` inclusive, Closing = Opening + Dr − Cr, and future transactions are excluded (controlled reproduction + cross-report audit; code character-identical to v1.0.0). The genuine weakness was a test-coverage gap — every prior check used FY→month-end windows, which cannot distinguish period-correct closing from an all-time sum. Additional regression and UI coverage was added to prevent recurrence: 92 API-level sub-period/boundary/edit/backdate/delete checks (mutation analysis: an all-time closing would fail April δ 1,405, May δ 913, one-day δ 1,412), an independent engine `cashBankSub` snapshot for a fixed May window, and the `jun/cb-subperiod` real-browser scenario that opens a historical report while later vouchers exist, asserting opening, Period Dr/Cr, closing, and the identity from UI-rendered numbers only. O-1 is **not** a production bug fix.

### Verification record (this release)

| Suite | Command | Checks | Result |
|---|---|---|---|
| Smoke | `python3 scripts/smoke_test.py` | 39 | PASS |
| Adversarial attack | `python3 scripts/attack_test.py` | 88 | PASS |
| Bug-fix regression | `python3 scripts/fix_regression.py` | 65 | PASS |
| Independent reconciliation | `python3 scripts/reconcile.py` | 48 | PASS |
| Final regression (F-INV-01 + O-1 + fix attacks) | `python3 scripts/final_regression.py` | 224 | PASS |
| Attack-the-fixes | `python3 scripts/attack2.py` | 29 | PASS |
| Real-browser UI acceptance | `node scripts/acceptance/run.js` | 129 | PASS |
| Typecheck | `npm run typecheck` | — | PASS |
| Docker fresh volume + restart persistence + in-container probes | `docker compose down -v && build && up -d && restart` | — | PASS |

**Total: 622/622 checks — zero failures** (v1.0.0 was 483; +139, none removed or weakened).

### Detailed F-INV-01 / O-1 work record

### Fixed: F-INV-01 (P3) — inventory-only Stock Journal & Physical Stock via UI

**Original behavior:** the client unconditionally rejected vouchers with zero ledger entries, so an inventory-only Stock Journal (godown-style transfer) or Physical Stock count could not be composed or saved through the UI, even though the server already supported them.

**Correct semantics (documented):**
- *Accounting-only* vouchers (Payment, Receipt, Journal, Sales, Purchase, …) still require ≥1 non-zero, balanced ledger entry — unchanged.
- *Inventory-category* vouchers (Stock Journal, Physical Stock, Delivery/Receipt Note, Mfg Journal) may be **inventory-only** (`entries: []`) when at least one valid inventory row (item + non-zero qty) exists; mixed inventory + accounting vouchers behave exactly as before.
- A Physical Stock counted quantity cannot be negative (a count is an absolute quantity).
- No artificial accounting entries are created: TB, BS, P&L, GST, cash/bank and AR/AP are untouched by an inventory-only voucher; only stock position/valuation move (server and the independent engine share these documented semantics — the engine was not changed to force agreement).

**Implementation (minimal):**
- `server/src/routes/vouchers.ts` — `assertLedgersTx` allows zero ledger ids (reference validation for the ids that exist); `validateEntries` remains the authoritative gate and only permits the zero-entry case for inventory-category vouchers with ≥1 real movement; new `assertPhysicalRows` rejects negative counted quantities; both POST and PUT are covered.
- `client/src/pages/VoucherScreen.tsx` — the save gate permits zero ledger rows only when the voucher type is inventory-category and a valid inventory row exists; small hint shown for inventory-only composition; ledger grid stays fully usable for mixed vouchers.
- No changes to stock valuation, FIFO/WAV algorithms, accounting posting, numbering, bill allocation or company isolation.

**Latent defect also fixed en route:** the Zod inventory-row schema accepted only `stock|source|target` while the client sends `kind: "physical"` for Physical Stock — the value is now part of the schema enum, and `stock.ts` handling of it is unchanged.

### Closed: O-1 (P4) — NOT REPRODUCIBLE, coverage added

Phase 1 investigation (no code changed) proved the alleged defect does not exist: Cash/Bank receives the correct `from`/`to`; Opening is postings before `from` (`≤ from−1`); Movement is `[from, to]` inclusive; Closing = Opening + Dr − Cr; future transactions are correctly excluded (controlled reproduction: April report with a May +500 voucher shows closing 10,060, not 10,560); the relevant code is character-identical to v1.0.0; the cross-report audit found no affected report. **No production Cash/Bank logic was modified.**

The original observation is attributed to a coverage gap: every existing check used FY→month-end windows, which cannot distinguish period-correct closing from an all-time sum.

**Test-only remediation (+128 checks):**
- `scripts/final_regression.py` — 92 new checks on a dedicated probe ledger (opening 10,000) with boundary-placed vouchers: April window excludes May/June; May opening = April closing (continuity); one-day windows; `to`-inclusive canary (Apr 30 +7 in April, May 1 +3 in May); future canary (Jun 10 +900 excluded from every historical window); empty late window; identity `closing = opening + Dr − Cr` per window; edit-into-period (+50), backdate-out-of-period (April/May opening shift, June cumulative invariant), and delete-remove-effect propagation. Mutation analysis: an all-time closing would fail April (δ 1,405), May (δ 913) and one-day (δ 1,412) assertions.
- `scripts/acceptance/engine.py` — `cashBankSub` snapshot: the independent engine's period-correct `cash_bank()` computed for a fixed May 1–31 window (no accounting-semantics change).
- `scripts/acceptance/run.js` — `jun/cb-subperiod` real-browser scenario: the May Cash/Bank report opened in the browser while June vouchers exist; per-ledger UI closing/movement vs the independent engine, opening via ledger drill-down, the identity recomputed from UI-rendered numbers only, and a canary that the May-window closing differs from the FY-window closing.

**Verification:**

| Suite | Command | Checks | Result |
|---|---|---|---|
| Smoke | `python3 scripts/smoke_test.py` | 39 | PASS |
| Adversarial attack | `python3 scripts/attack_test.py` | 88 | PASS |
| Bug-fix regression | `python3 scripts/fix_regression.py` | 65 | PASS |
| Independent reconciliation | `python3 scripts/reconcile.py` | 48 | PASS |
| Final regression (incl. F-INV-01 + O-1 sub-period coverage) | `python3 scripts/final_regression.py` | 224 | PASS |
| Attack-the-fixes | `python3 scripts/attack2.py` | 29 | PASS |
| Real-browser UI acceptance (incl. `inv/sj-only`, `inv/ps-only`, `jun/cb-subperiod`) | `node scripts/acceptance/run.js` | 129 | PASS |
| Typecheck | `npm run typecheck` | — | PASS |
| Docker fresh volume + restart persistence + in-container inventory-only SJ | `docker compose down -v && build && up -d && restart` | — | PASS |

**Total: 622/622 checks passed — zero failures** (baseline was 483 at v1.0.0; +35 F-INV-01 checks, +104 O-1 API-level checks within final_regression, +12 O-1 UI checks, +12 acceptance-rig checks from the F-INV-01 scenarios; none removed or weakened).

## v1.0.0 — Release Baseline (2026-09-11)

Tag: `v1.0.0` · Baseline commit: see `git rev-list -n 1 v1.0.0`

**483/483 checks passed — zero failures.**

### Verification summary (exact commands and results in STATE.md)

| Suite | Command | Checks | Result |
|---|---|---|---|
| Smoke | `python3 scripts/smoke_test.py` | 39 | PASS |
| Adversarial attack | `python3 scripts/attack_test.py` | 88 | PASS |
| Bug-fix regression | `python3 scripts/fix_regression.py` | 65 | PASS |
| Independent reconciliation | `python3 scripts/reconcile.py` | 48 | PASS |
| Final regression (A-/F- findings + fix attacks) | `python3 scripts/final_regression.py` | 97 | PASS |
| Attack-the-fixes | `python3 scripts/attack2.py` | 29 | PASS |
| Real-browser UI acceptance | `node scripts/acceptance/run.js` | 117 | PASS |
| Typecheck | `npm run typecheck` | — | PASS (server + client) |
| Docker fresh volume | `docker compose down -v && docker compose build && docker compose up -d` | — | PASS (healthy ~6s, migrations auto-apply, data survives restart) |

The independent Python expectation engine (shares no code or queries with zprime) reconciles, for three months of a fictional trading business driven through the real UI: Trial Balance, Balance Sheet, P&L (cumulative and monthly), FIFO stock, bills receivable/payable, GSTR-1, GSTR-3B, TDS, cash/bank, and salary register — to the paisa.

### Fixed in this release

- **A-01 (P1)** GSTR-3B white-screen — report renders and reconciles.
- **F-GRP-01 (P1)** Group master unusable — nature inheritance, clean 4xx/409, reserved-parent rules.
- **F-TDS-01 (P1)** TDS sections master 500 — sort key + validation schema.
- **A-07 (P2, reporting integrity)** The ₹1,215 IGST defect: GST reports now treat booked duty amounts as authoritative; supply-type contradictions are flagged (`supplyMismatch`), never silently zeroed. Ledger GST == GSTR-1 == GSTR-3B is an enforced invariant with a permanent regression test.
- **A-02 (P2)** Bill-name collisions across voucher types — auto names are `SHORTCODE-number`; server enforces per-party bill-name uniqueness in-transaction.
- **A-03 (P2)** Negative payroll deductions rejected with clean 400s.
- **A-04 (P2)** TDS report separates deductions from remittances (deducted − remitted = outstanding).
- **A-05 (P2)** On-account amounts merged into party outstanding (synthetic "On Account" bill).
- **A-06 (P2)** Sub-period P&L is period-correct (period movements, not cumulative closings).

Earlier hardening (BUG-001…BUG-009) is included: atomic voucher numbering, bill-allocation integrity guards, RFC-compliant CSV export, input fuzzing resistance, company isolation, payroll/TDS validations.

### Known non-blocking issues (NOT fixed — documented, do not treat as resolved)

- None open. O-1 (P4) is **CLOSED — NOT REPRODUCIBLE**: the application was verified correct (see the O-1 section above); only regression coverage was added.

### Accounting invariants verified at this baseline

- Total Debits = Total Credits on every voucher, report, and period.
- Assets = Liabilities + Capital with no difference banner.
- Ledger == Trial Balance == reports; Sales/Purchase registers == transactions.
- Stock movements == Stock Summary (FIFO, incl. backdated layers).
- GST ledger == GSTR-1 == GSTR-3B.
- TDS deducted − remitted == outstanding == report.
- Bills receivable/payable == named-bill allocations == outstanding reports.
- Payroll vouchers == payslips == Salary Register.
- Company isolation and voucher-numbering protections intact; BUG-002 allocation guards hold in real use.
