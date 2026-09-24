# R-54_INVESTIGATION.md — TallyPrime shortcut parity study (REFERENCE: TALLYPRIME_SHORTCUTS_REFERENCE.md)

**Status:** INVESTIGATION — no production code touched. Operator directive: match TallyPrime's workflow & shortcuts "as close as possible" for zprime's setup. Source: official TallyHelp shortcut page (doc date 2026-09-18), captured verbatim in `TALLYPRIME_SHORTCUTS_REFERENCE.md`.

**Method:** every Tally shortcut cross-checked against the verified zprime hotkey inventory (one engine: `client/src/lib/hotkeys.ts` capture-phase; bindings in Shell/Gateway/DayBook/Reports/VoucherScreen/MasterPage; seeded voucher-type functionKeys in `server/src/lib/defaults.ts`; server routes for delete/cancel confirmed).

---

## 1. Already aligned (no action needed)

| Tally | zprime today |
|---|---|
| F2 = date/period | DayBook + Reports focus the date input; Gateway F2-free (R-53c) |
| F5/F8/F9 = Payment/Sales/Purchase | Gateway rail + Day Book + buildable everywhere |
| Alt+F5/Alt+F6/Alt+F7/Alt+F8/Alt+F9 = DN/CN/SJ/DLV/RN | Day Book binds all five |
| Ctrl+F7 = Physical Stock | Day Book binds it |
| F4/F6/F7 = Contra/Receipt/Journal | Day Book binds them |
| Ctrl+A = Accept/Save | VoucherScreen (incl. quick-modal accept) |
| Alt+C = create master on the fly | VoucherScreen quick-create (R-35) — same intent as Tally |
| Esc = back / close / clear | Shell history-back + modal claims; Gateway = last stop (v1.50.1) |
| Enter = drill down | Day Book row → voucher; Gateway menu; grids (R-36 arrows) |
| Alt+F1 = detailed/condensed | Reports + VoucherScreen |
| ↑/↓/Tab/Shift+Tab/Home/End navigation | grids + forms (R-36) |

## 2. IMPLEMENTABLE NOW — pure parity additions, zero conflicts (Option A)

| # | Tally shortcut | Implementation | Evidence |
|---|---|---|---|
| A1 | **F4/F6/F7/F10-type chords on the Gateway** (any screen, like Tally) | Gateway binds **every seeded voucher-type `functionKey` data-driven** (F4 Contra, F6 Receipt, F7 Journal today; future types inherit automatically) instead of only F5/F8/F9 hardcoded | `defaults.ts` seeds functionKeys; Gateway currently hand-binds 3 |
| A2 | **Alt+D = delete voucher** (Tally voucher action) | On VoucherScreen edit mode: confirm → `DELETE /api/c/:cid/vouchers/:id` → back. Server route exists (vouchers.ts:822); zprime delete is currently click-only inside screens | server DELETE verified |
| A3 | **Alt+X = cancel voucher** (Tally voucher action) | On VoucherScreen edit mode: confirm → `POST /vouchers/:id/cancel` (route exists, v1.2.0 semantics — keeps the ledger row, excluded from books) | server /cancel verified (line 701) |
| A4 | **F3 = change company** | Shell-level: F3 → company-select page (equivalent of pressing Switch Company). F3 is page-interceptable (not in R-51's reserved set: F5/F6/F11/F12/Alt-digits) | R-51 reserved-key evidence |
| A5 | **+/− = next/previous report date** (Tally reports) | Reports.tsx: +/− steps the from/to period by one day (only when focus is not in an input) | Reports has 4 date inputs; stepping is additive |
| A6 | **README shortcut-parity table** | Document the adopted Tally layer + the browser-blocked list (extends R-51 section) | docs-only |

Not carried: F10 "list of vouchers" (MJ's seeded hint `F10` collides with Tally's F10=List; MJ stays reachable via Vouchers pane — keep hint, don't bind).

## 3. IMPLEMENTABLE WITH CONFLICT RESOLUTION (Option B — the big workflow win)

**B1 — Alt+G "Go To" (Tally's universal navigator) vs zprime's apply-GST.**
Tally: Alt+G anywhere = jump to any report/master/voucher. zprime: Alt+G = apply GST on Sales/Purchase/CN/DN (R-34, suite-locked chips). TallyPrime itself reuses keys per screen (officially documented), but Go To is Tally's single most workflow-defining chord; keeping it hijacked on vouchers is the one real parity gap.
**Proposed resolution (Tally-faithful semantics):** move apply-GST to **Alt+J** — Tally's own *statutory adjustment* slot, a strictly better semantic fit — and implement **Alt+G = Go To palette** everywhere: a TypeAhead-style command palette over Gateway items (reports/masters/vouchers/utilities), navigable by typing. Requires re-anchoring r34_ui (Alt+G → Alt+J, ~2 assertions) + new suite checks for the palette.
**B2 — Ctrl+H (Tally: change view/mode) vs zprime balance-check context:** leave zprime semantics for now; revisit when a "change view" surface exists.
**B3 — Alt+T/Alt+R (Tally: contextual actions) vs zprime apply-TDS / reverse-charge:** keep — Tally's own usage of these is contextual, zprime's choices are valid contextual meanings.

## 4. BROWSER-BLOCKED (document-only; R-51 PWA/app-mode already mitigates)

F1/F11/F12 (browser-consumed first in tab view), **Ctrl+N** (new window — never reaches the page), Ctrl+W (tab close), Ctrl+P/Ctrl+S (print/save dialogs in tab view), Alt+F4 (OS). Tally parity impossible in-tab by design; app-mode recovers most (R-51 README section).

## 5. FEATURE-MISSING (chords have no zprime counterpart — record only, NOT shortcut work)

- **Ctrl+F8/Ctrl+F9 (Sales/Purchase Order), Ctrl+F5/Ctrl+F6 (Rejection Out/In):** zprime does not seed Order/Rejection voucher types. Binding the chords requires new voucher-type features first (schema-adjacent decision) — out of shortcut scope.
- **F11 (Company Features)/F12 (Configuration):** no features/config surface exists.
- **Ctrl+Enter (alter master from report):** no master-drill from reports yet.
- **Calculator (Ctrl+N), Ctrl+4 ₹, banking/IMS/backup/e-mail/templates/Docs-by-Ira chords:** corresponding features do not exist in zprime (single-currency; no bank feed; no TallyDrive analogue).

## 6. zprime's own layer (kept, distinct per operator's category split)

Gateway hot letters (V/K/C/A/R/U + item letters + digits, R-53c/v1.50.1) = category 4 "zprime Gateway mnemonics" — official Tally documents no such global table (its navigation is menu-highlight + Alt+G/Ctrl+G). **Ctrl+G "Switch To another report"** is a candidate future mapping for zprime's report switcher if one is built.

## 7. Recommendation

- **Option A (A1–A6): approve as v1.51.0** — pure parity, no suite re-anchoring beyond additive checks, small diff (Gateway data-driven F-keys, VoucherScreen Alt+D/Alt+X with confirm modals, Shell F3, Reports +/−, README table).
- **Option B (B1 Go To palette + Alt+G→Alt+J): approve as a follow-up R-item** — largest workflow gain, touches a suite-locked chord, deserves its own release.
- Sections 4/5 stay documented as boundaries, not backlog.
