# R-61 INVESTIGATION — Gateway reorganization: mirror TallyPrime's Gateway organization

**Trigger (operator):** "look at how TallyPrime organizes its options in the Gateway and inside the Gateway — items, vouchers, etc — and try to match it. Now it's complicated and not seamless and convenient."

**Date:** 2026-09-25 · **Baseline:** v1.53.0 + R-60 implementation (`aa90cfe`, v1.54.0 pending)

---

## F-61-1 · What TallyPrime's Gateway actually looks like (verified)

Official line (TallyHelp, "TallyPrime Features — Release-wise", fetched this session):

> "Gateway of Tally is organised into **Masters, Vouchers, Utilities, and Reports**."

Structure (TallyHelp Gateway-of-Tally pages + TallyPrime 2.0+ sectioned layout, corroborated by three independent walkthroughs fetched this session):

- **Main Area (Ctrl+M)** = left info panel (date + loaded companies) + right **menu**.
- **Button bars**: horizontal (print/e-mail/import/upload) + vertical (contextual, screen-to-screen).
- **The menu itself is a flat, fully visible list** — grouped under the four section headers, every item shown with its hot letter; **no drill-in is needed for any top-level item**. You press the letter, the action fires. This is the seamlessness the operator is asking for.
- Section contents (TallyPrime 2.0 conventions):
  - **Masters** → two actions: **Create** and **Alter** (the masters list opens *inside* the chosen mode — Create/Alter is a mode, not two content sets).
  - **Transactions** → **Vouchers** (one item — the type is chosen on the voucher screen), **Day Book**.
  - **Utilities** → items listed directly (Banking, Import, …).
  - **Reports** → the headline statements listed **directly** (Balance Sheet, Profit & Loss A/c, …), with a **"Display More Reports"** expander for the rest.
- Administrative leftovers park at the bottom ("Display More" family) — zprime already mirrors this with the letterless `·` Company Settings (R-59).

**The two Tally ideas zprime lacks:**
1. **Section headers instead of 7 peer headings** — the Gateway reads as four named areas, matching the user's mental model ("items, vouchers, etc").
2. **One-keystroke visibility for common destinations** — Utilities items and headline reports sit on level 1, not behind R/U panes.

---

## F-61-2 · Current zprime Gateway (v1.53.0)

Single source of truth `client/src/lib/gatewayMenu.ts` (`buildGatewayMenu`), consumed by `client/src/pages/Gateway.tsx` and the Alt+G Go To palette (`flattenMenu`). Level-1 headings:

| Letter | Heading | Contents |
|---|---|---|
| V | Vouchers | pane: voucher types + Process Payroll (W) |
| K | Day Book | **direct** link |
| C | Create | pane: 10 masters (shared list) |
| A | Alter | pane: same 10 masters (same letters, deduped fallback) |
| R | Reports | pane: 16 reports |
| U | Utilities | pane: XML Import (X), Cheque Printing (J), Audit Trail (Z) |
| · | Company Settings | **direct** link (letterless, R-59) |

3-zone layout: aside (company panel + period + TB health) / headings column / contents pane (`gateway-contents` testid).

**Pain point (operator's words):** "complicated and not seamless" — 7 peer headings hide the four Tally areas; everything except K/· requires a heading→pane drill to *see*, and X/J/Z + all 16 reports are invisible until drilled, even though the global letter-fallback already fires them from level 1 (the letters work; the **visibility** doesn't).

---

## F-61-3 · Proposal — Option C (recommended): TallyPrime sectioned list, letters unchanged

Reorganize the **middle column** into Tally's four section headers with items directly visible; keep the pane only where Tally has one (Vouchers types, Create/Alter masters); adopt "Display More Reports" for the report tail. **Every existing hot letter keeps firing the same target** — muscle memory and R-53c global uniqueness are untouched.

```
MASTERS
  C Create            → pane: masters list (unchanged)
  A Alter             → pane: masters list (unchanged)
TRANSACTIONS
  V Vouchers          → pane: voucher types + payroll (unchanged)
  K Day Book          → direct
UTILITIES
  X XML Import        → direct        (was inside U pane)
  J Cheque Printing   → direct        (was inside U pane)
  Z Audit Trail       → direct        (was inside U pane)
REPORTS
  B Balance Sheet     → direct        (was inside R pane)
  F Profit & Loss A/c → direct
  T Trial Balance     → direct
  H Cash / Bank Book  → direct
  S Sales Register    → direct
  P Purchase Register → direct
  M Stock Summary     → direct
  · Display More Reports → expands in place (Receivables, Payables, GSTR-1/3B/9,
                           TDS, TCS, Salary Register, Cheque Register — letters unchanged)
· Company Settings    → direct (unchanged)
```

- The right contents pane survives for V/C/A (still `gateway-contents`); the neutral hint text updates to the new letter set.
- Section headers render as non-chip labels (not `.fkey-chip`), so chip-uniqueness scans stay meaningful.
- Go To palette (`flattenMenu`) picks up the promoted items with their new sections automatically — no change needed to scoring.

### Options considered

- **Option A — flat list, drop panes entirely:** everything visible including all 16 reports and 10 masters (~35 rows). Most Tally-like on paper, but zprime's Create/Alter *need* the pane (masters are pages, not modes), and a 35-row column is long even by Tally standards. Loses the drill-free win only marginally over C, costs more visually.
- **Option B — rename/re-group level 1 into 4 headings (Masters/Transactions/Utilities/Reports) with panes under each:** minimal diff, but preserves exactly the drill the operator called not-seamless. Rejected.
- **Option D — stay as-is:** rejected; the operator explicitly asked for the match.
- **Option C (recommended)** — sectioned list with promoted items + Display More Reports. Matches Tally's organization *and* its seamlessness; smallest behavioral delta (letters all unchanged); keeps V/C/A panes where they're genuinely needed.

### Suite impact (honest re-anchoring — nothing weakened)

- **r53_ui.js (43):** sections 5–8 re-anchor: Esc-hint text; 31-labels loop (promoted items now visible without drilling — owners map shrinks to V/C/A-owned labels); heading-letters uniqueness now scans sectioned chips (still unique); pane-letters scan becomes V/C/A (+ More-Reports when expanded); direct-fire letters X/J/Z/B/F/T now fire from level 1 (same targets — assertions unchanged); F5/F8/F9 rail + no-F2 unchanged; Esc-origin/Back-stops unchanged.
- **r54_ui.js (26):** Alt+G palette unaffected (flattenMenu sections rename); rail F-keys unaffected. Expect green as-is; verify.
- **r58/r59_ui.js:** Company Settings `·` direct link stays level-1 — should stay green; verify.
- Hotkey engine, GoTo palette, Shell Esc/history barriers: untouched.

### Scope

Client-only: `gatewayMenu.ts` (restructure `MenuEntry[]` into sections — new `MenuSection` grouping or a `section` field on entries), `Gateway.tsx` (render sections + promoted direct items + Display More expander). Zero server/schema/accounting change. Estimated v1.54.0-or-v1.55.0-sized, one session.

---

## Sources

- TallyHelp — TallyPrime Features release-wise: "Gateway of Tally is organised into Masters, Vouchers, Utilities, and Reports" (fetched 2026-09-25).
- TallyHelp — Gateway of Tally component pages (Main Area Ctrl+M, button bars; ERP 9 + TP lineage; fetched 2026-09-25).
- TallySchool / Ankit IT Solutions Gateway walkthroughs (section contents, Create/Alter-as-modes, Banking/Cheque Printing under Utilities; fetched 2026-09-25).
- `TALLYPRIME_SHORTCUTS_REFERENCE.md` — category 3 (menu/mnemonic) vs category 4 (zprime's own V/K/C/A/R/U layer): this reorganization moves *labels/positions*, not the letter vocabulary.
