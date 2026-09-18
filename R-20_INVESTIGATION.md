# R-20 Investigation — zprime v1.18.0 · Company Audit Timeline

**Status:** investigation complete — implementation NOT started (per protocol).
**Verdict:** `R-20 CONFIRMED — FULLY SCOPED, NO BLOCKERS` (approved product decision; R-18's data layer was designed for this — no migration, no new authorization concept, no accounting surface).
**Baseline:** HEAD `2be2097` (docs commit on top of v1.18.0 `61564a2b…`); working tree clean except this report and the intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md`. No source, test, migration, or doc file modified.

---

## 1. Executive Summary

R-20 extends R-18's per-voucher audit history into a **company-wide audit timeline**: a read-only page listing every lifecycle event (create/edit/cancel/uncancel/delete) across the whole company, newest first. This is the natural completion of the audit feature and was explicitly deferred in R-18's out-of-scope list.

Everything needed already exists:

- **Data:** the `audit_events` table (migration 0007) is company-scoped with an index R-18 added **precisely for this query** — `audit_events_company_created_idx (company_id, created_at)`.
- **Authorization:** `cid()` membership gating — a non-member gets the standard 404; no new auth tier.
- **Capture:** all 7 write sites already emit events; nothing new to instrument.
- **Viewer conventions:** the per-voucher endpoint (`GET /vouchers/:id/audit`) and the VoucherScreen history strip established the join shapes and display copy; the new work reuses both.

Live volume check (probe company): 48 events — create 41, edit 3, delete 2, uncancel 1, cancel 1. Trivially small; a single indexed `LIMIT` query is the entire cost.

## 2. Data Layer (verified live)

`audit_events`: `id` serial PK, `company_id` NOT NULL, `voucher_id` nullable (NULL after hard delete — the trail detaches, snapshot survives in `detail`), `actor_id` nullable, `action` (create|edit|cancel|uncancel|delete), `detail` (cancel reason / delete snapshot / NULL), `created_at` tz. Indexes: `(company_id, voucher_id)` and `(company_id, created_at)`.

**Ordering decision:** order by `id DESC`, not `created_at DESC`. Events are written in the same transaction as their state change, so `id` is a strict monotonic chronology; `created_at` (DEFAULT now()) can tie for same-transaction events (e.g. a payroll voucher's insert + its audit event, or all events inside one import). The `(company_id, created_at)` index still serves `from/to` date filters if added later; the default timeline query filters company_id only and orders by id — at zprime's data scale (single operator) the planner cost is negligible, and the R-18 index remains available for date-bounded queries.

**Deleted vouchers:** rows with `voucher_id IS NULL` must render as text (no link), with the snapshot from `detail` (e.g. "Sales 12 dated 2026-09-18, amount 5,000.00"). This is the only display nuance.

## 3. Endpoint Design

`GET /audit` in `vouchers.ts` (next to the per-voucher audit handler; same router, same cid() gating):

- **Response rows:** `id, action, detail, createdAt, actorUsername (LEFT JOIN users), voucherId, voucherNumber + voucherTypeName (LEFT JOIN vouchers → voucherTypes)`.
- **Query params:** `limit` (default 200, clamped 1–1000), `action` (optional enum filter), `before` (optional id cursor — `id < before` — enabling cheap "load older" without full pagination machinery).
- **Order:** `id DESC`. **Gate:** `cid(req)` — membership enforced centrally; unknown company → standard 404, indistinguishable from non-membership (no existence leak).
- Read-only; no mutation surface; no request-body trust.

## 4. UI Design

- **New page** `client/src/pages/AuditTrail.tsx` at route `/company/:cid/audit` (App.tsx): Shell + PageHead per Day Book conventions; one compact table — When (toLocaleString), Action badge (per-action color, TYPE_COLORS-style), Voucher (linked `Sales #12` → `/voucher/:id/edit` — the same alter surface Day Book uses; cancelled vouchers render read-only there per R-02; deleted vouchers show unlinked text + snapshot), Detail, By (actor username; "system" fallback for NULL actor).
- **Gateway entry:** one "Audit Trail" card link in the utilities group (beside XML Import / Cheque Printing / Company Settings). No new keyboard hotkey (read-only report surface; F-keys remain voucher-entry-first per the Tally-inspired philosophy).

## 5. Blast Radius

- **Accounting math:** zero — read-only endpoint + display page; no calculation, posting, or stock surface touched.
- **Migration:** none. Fresh-install/upgrade parity trivially preserved.
- **Security:** cid() gating inherited; cross-company 404 must be regression-tested; no body/query trust beyond the three whitelisted params (limit clamped; action enum-checked; before int-checked).
- **Perf:** single indexed query with LIMIT; join depth 3; no N+1.

## 6. Proposed R-20 Scope (for approval)

1. **Server:** `GET /audit` endpoint in `vouchers.ts` (~30 lines) per §3.
2. **Client:** `AuditTrail.tsx` page + route + Gateway card link (~70 lines).
3. **Tests:** `final_regression.py` +8 R-20 checks → 619 (timeline newest-first order; action filter; before-cursor; deleted-voucher row with NULL voucherId + snapshot detail; actor username present; **cross-company timeline 404**; company isolation — other company's events absent; limit clamp). New `scripts/acceptance/r20_ui.js` ~6 checks (Gateway card → page renders; rows appear for a UI-entered voucher lifecycle incl. edit + delete; deleted row unlinked with snapshot; count parity vs API; no page errors).
4. **Docs:** CHANGELOG/STATE/CONTINUE/RELEASES/ROADMAP per convention.
5. **Projected totals:** Python **901/901**, browser **234/234**. Proposed release: **v1.19.0 — "company audit timeline"**.

## 7. Out of Scope (unchanged from R-18)

Masters events, retention/export, date-range filter UI (the `before` cursor is included; from/to params can ride the existing index later if a need appears), RBAC on who may *view* the timeline (any company member — consistent with the per-voucher history), user-management features.

---

**Final verdict:** `R-20 CONFIRMED — FULLY SCOPED, NO BLOCKERS · AWAITING SCOPE APPROVAL`
