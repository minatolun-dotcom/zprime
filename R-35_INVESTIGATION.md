# R-35 Investigation — zprime v1.33.0 · Alt+C Ledger-on-the-Fly

**Status:** investigation complete — implementation NOT started (per protocol).
**Verdict:** `R-35 CONFIRMED — GENUINE FEATURE GAP, FULLY SCOPED` (D-5 from R-34's deferred list; the classic Tally mid-voucher master-creation flow, missing entirely; no P0/P1 defect — this is an approved-feature investigation).
**Baseline:** HEAD `b4bdd90e81788ab7d64ace8eb921b94a46846cb0` = tag `v1.33.0` (pushed); working tree carries only the ledger docs recording the release plus the intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md`. No source, test, migration, or doc file modified.

---

## 1. Executive Summary

Tally's most-loved data-entry affordance: while entering a voucher, the operator references a ledger that does not exist yet — presses **Alt+C** — creates it **without losing the half-entered voucher** — and lands back in the same cell with the new ledger picked. zprime has none of this: today the operator must abandon the voucher (Esc → Day Book → Ledgers → create → navigate back → re-enter everything).

**The enabling discovery: every server piece already exists.** `POST /c/:cid/ledgers` (masters CRUD) is cid-gated, Zod-validated, FK-ref-checked in-company (R-08 `assertCompanyRefs`), 409-honest on duplicate names ((companyId, name) unique index), and needs **zero server changes**. The gap is purely client wiring: a quick-create modal in VoucherScreen, an Alt+C chord (unused — verified), and TypeAhead support for a "create" affordance.

**Recommended scope (Option A, ≈ v1.34.0):** Alt+C opens a minimal quick-create modal (Name*, Under Group*, Taxability, GST Rate %) prefilled from the focused ledger cell's text; on success the ledger list refreshes (`all-ledgers` invalidation) and the new ledger is picked into the triggering row — **voucher state (entries, amounts, party, date, number) is never lost**. Modal keyboard layering: Esc closes the modal (not the voucher); Ctrl+A accepts the modal when open (otherwise voucher save); Enter accepts. Plus a "＋ Create \"<typed>\"" row in the TypeAhead dropdown when the text matches nothing — the Tally-style discoverable path. ~8–10 new browser checks in r35_ui.js. Client-only: no server, no schema, no accounting surface.

## 2. Baseline Integrity

- `git rev-parse HEAD` → `b4bdd90e81788ab7d64ace8eb921b94a46846cb0`; `git describe --tags` → `v1.33.0`; remote matches via ls-remote.
- Working tree: `M CONTINUE.md` (handoff-phrase repair this session), `M RELEASES.md STATE.md` (v1.33.0 ledger docs riding with the next commit), untracked action plan + `__pycache__`.
- Verification estate: 1197 automated + 432 browser; 35 immutable tags.

## 3. Current Voucher-Entry Ledger Flow (evidence)

- **Grid ledger cells** use `TypeAhead` (VoucherScreen.tsx:5,87) over `allLedgers` (`GET /ledgers`, react-query key `["all-ledgers", cid]`, VoucherScreen.tsx:66). `ledgerById` (:89) resolves picks for all helpers (GST/TDS/TCS/duty).
- **TypeAhead behavior** (TypeAhead.tsx:37–49): ArrowUp/Down + Enter commit a match; **Enter with zero matches silently does nothing** — the typed text is simply lost. No create path exists.
- **Party field** (`Party A/c`) is also a TypeAhead over the same ledger list — party ledgers come from the same table, so Alt+C must be available there too (Sundry Debtors/Creditors groups).
- **What a half-entered voucher holds:** `entries`, `inv`, `date`, `number`, `reference`, `narration`, `party`, `isRcm` — all React state (the useHotkeys dep array at :410 enumerates them). A modal that only adds state cannot disturb it.

## 4. The Missing Feature (D-5)

- No chord, no button, no dropdown item creates a ledger from the voucher screen (grep: `new-ledger|create ledger|Alt+C` in VoucherScreen → zero hits).
- `Alt+C` is unused anywhere in the client (hotkeys.ts registers no Alt+C; no fkeys entry) — verified no conflict.
- The operator's only path is abandonment + re-entry — the highest-friction flow in the app for new companies, where missing masters are most common.

## 5. Server Ground Truth (what already works — no changes needed)

- `crud(app, "ledgers", ledgers, { orderBy: byName, searchFields: [ledgers.name], refs: { groupId: { table: groups } } })` (masters.ts:47–48) → POST is cid-gated by the shared CRUD factory.
- R-08: `assertCompanyRefs` validates `groupId` in-company at the boundary (masters.ts:41–44 comment) — a quick-created ledger cannot reference another company's group.
- Duplicate name → `23505` → honest `409 "A record with this name/symbol already exists"` (crud.ts:131–132) — the modal must surface this verbatim.
- Masters defaults worth mirroring in the modal: `gstRegistrationType: "none"`, `taxability: "none"` (MasterPage.tsx:314 `newRow`).
- **Conclusion: Option A needs no server diff at all.** The client POSTs exactly what the masters page already posts (minus the advanced fields, using the same defaults).

## 6. Design (for approval)

**Alt+C behavior:** hotkey map gains `Alt+C` — opens the modal, prefilled with the *typed text of the focused TypeAhead* (tracked via a small ref/state: the last-focused ledger cell's current text). If focus is not in a ledger/party cell, the modal opens with an empty name and the operator types.

**Modal fields (minimal, Tally-honest):** Name* (text, prefilled), Under Group* (select from `GET /groups` — one cheap query, cached), Taxability (select, default none), GST Rate % (number, default empty). GSTIN/bill-wise/TDS-section/etc. stay on the masters page — the modal creates *entry-ready* masters, not complete ones; the hint says so.

**Accept:** Enter or Ctrl+A (when modal open) submits; on 201 → `qc.invalidateQueries({ queryKey: ["all-ledgers", cid] })` (pattern already used at VoucherScreen.tsx:395–396) → pick the new ledger into the triggering row → close → focus returns to the row's amount cell. On 409 → the server's message shown verbatim in the modal; the voucher behind remains untouched.

**Esc layering:** the single VoucherScreen hotkey map becomes conditional — `Escape: modalOpen ? closeModal : nav(daybook)`. One map, no double-handling (verified: useHotkeys registers one window listener per screen).

**TypeAhead discoverability:** when `text` matches nothing, the dropdown renders one trailing item `＋ Create "<text>"` that opens the same modal. Only VoucherScreen consumes TypeAhead today (verified) — zero blast radius on other pages.

## 7. Blast Radius Analysis

| Change | Files | Risk | Mitigation |
|---|---|---|---|
| Quick-create modal + Alt+C + conditional Esc/Ctrl+A | VoucherScreen.tsx | Esc/Ctrl+A semantics change while modal open — suites press both on voucher screens | r35 asserts modal-scoped behavior + full battery re-run |
| TypeAhead create-row | TypeAhead.tsx | dropdown item could interfere with Enter-commit tests | create-row only renders when `matches.length === 0` — existing tests always match |
| Driver helper `quickCreateLedger(name, group)` + r35_ui.js (~8–10 checks) | scripts/acceptance/ | additive | — |

**No server file, no schema, no migration, no accounting-math change.** Nothing existing is weakened.

## 8. Security / Accounting Check

Ledger creation remains behind the existing cid-gated, validated, ref-checked CRUD boundary — the modal is just a new client for an existing API. No posting implications (a newly created ledger is inert until used on a voucher). No new trust surfaces: the modal sends the same fields the masters page sends. R-03 membership authorization applies unchanged.

## 9. Test Plan (for approval)

- **r35_ui.js:** Alt+C opens the modal prefilled from typed text; create → row picked + voucher intact (entries/amounts survive); Enter and Ctrl+A both accept the modal; Esc closes only the modal; duplicate name → 409 message verbatim, voucher untouched; TypeAhead "＋ Create" row appears on zero matches and opens the modal; created ledger immediately usable on a saved voucher (round-trip).
- **Python:** existing masters CRUD + adversarial suites already cover POST /ledgers validation, duplicates (409), and cross-company refs (R-08) — **no new Python checks required**; battery re-run proves no regression.

## 10. Scope Options

- **Option A (recommended, ≈ v1.34.0):** as designed above — modal (Name/Group/Taxability/GST-Rate), Alt+C, conditional Esc/Ctrl+A, TypeAhead create-row, r35_ui.js. Client-only.
- **Option B:** A + extended modal (full masters field set incl. GSTIN, bill-wise, TDS/TCS sections) — heavier UI, redundant with the masters page, more locator risk; the quick modal + "edit later in masters" is the Tally-honest split.
- **Option C:** A + opening-balance field in the modal — tempting but invites unbalanced opening entries from mid-voucher; openings belong to a considered moment, not a flow interruption. Recommend keeping openings on the masters page.
- **Option D:** defer. Legitimate; the gap is known and documented.

## 11. R-35 Scope Statement (if approved)

**Title:** "Ledger-on-the-fly: Alt+C mid-voucher master creation."
**Requirements:** VoucherScreen modal + chord + layering; TypeAhead create-row; groups query; invalidation + auto-pick; driver helper; r35_ui.js (~8–10 checks); full Python + browser batteries on a verified-fresh volume; typecheck; no server diff.
**Acceptance criteria:** a half-entered voucher never loses state across a quick-create; both Enter and Ctrl+A accept; Esc never abandons the voucher from the modal; duplicate names surface the server's 409 verbatim; the created ledger is saved on a real voucher end-to-end; 1197+ automated and 432+ browser checks remain green.

---

**Final verdict:**

# R-35 CONFIRMED — GENUINE FEATURE GAP, FULLY SCOPED

Awaiting human review of scope (A / B / C / D) before any implementation. No code has been changed.
