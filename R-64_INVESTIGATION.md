# R-64 INVESTIGATION — Keyboard-first Gateway & UI/UX improvement study

**Trigger (operator):** full investigation brief — audit the real zprime keyboard/UI architecture, identify redundancy and defects, research TallyPrime patterns properly, propose a phased plan. Investigation-only unless approved otherwise.

**Date:** 2026-09-25 · **Baseline:** v1.54.0 (`cf8c7fd`) · **Method:** source inspection of every keyboard surface + live DOM probes + official TallyHelp research. No production code changed.

---

## Executive Summary

zprime's keyboard architecture is **sound at its core and better than the brief feared**: a small per-page capture-phase hook (`useHotkeys`), an explicit Esc ownership ladder (overlay → page → Shell), input-guarded Gateway letter navigation, and a **per-page contextual shortcut rail** (the "contextual shortcut bar" the brief asks about already exists — it is just under-used visually and duplicated in content). The R-50 token system gives a calm, dense accounting look with tabular numerals and universal focus rings; there is no generic-SaaS drift to undo.

The audit found **two real behavior defects, one documentation overclaim, one genuine duplication cluster, and one undocumented alias family** — all small, all fixable without touching the muscle-memory contract:

- **D-1 (defect):** physical **F2 is dead on the voucher screen** while the rail advertises "F2 Date" (live-probed: focus stays on BODY). The chip works by click only. Same defect class R-34 eliminated elsewhere.
- **D-2 (docs-vs-behavior):** README says F4–F9 work "from any screen"; actually they fire on **Gateway and Day Book only** (each page registers its own map; Reports/Masters have none). Fix = a tiny global F-key layer (Tally-like, recommended) or an honest README reword.
- **D-3 (duplication):** on the Gateway, the right rail and the V (Vouchers) pane both list the same voucher types with the same F-key hints; page toolbar chips and the rail repeat each other on voucher screens. One surface should own each fact.
- **D-4 (undocumented):** `hotkeys.ts` silently aliases **Alt+1…9 → Alt+F1…9** (and Alt+0? no — digits 1–9 only); the README/never mentions it.

The Gateway layout itself (company panel / menu / contents pane) survives scrutiny — the operator already rejected one reorganization this cycle (R-61 lesson recorded); this investigation recommends **no structural Gateway change**, only content deduplication and small correctness fixes. Visual "issues" from the brief's checklist were checked and largely **not present** (findings F-15–F-19): cards are purposeful, density is good, purple is restrained, focus rings are consistent.

Recommended phases (each independently shippable, none touching accounting semantics):
- **Phase A — Keyboard correctness (small, high value):** fix D-1 (F2 on vouchers), resolve D-2 (global F-key layer), document D-4, extend the real-key acceptance suite + a new input-safety suite.
- **Phase B — Shortcut display dedup (moderate):** one `<Kbd>` chip component, one owner per shortcut fact (rail = actions for THIS screen; Gateway menu = structure; kill duplicated hints), rail visual slimming.
- **Phase C — Polish backlog (optional, operator's pick):** company-panel condensation options, recent-activity strip on the Gateway, focus-restore after modal close.

---

## 1. Current UI architecture (as found in source)

- **Shell** (`client/src/components/Shell.tsx`, 229 lines): indigo top bar (← back when breadcrumb exists · `zprime` brand · company name + GSTIN · page title · Switch Company · Logout), breadcrumb strip, `<main>` flex body, **right shortcut rail** (`aside.w-64`, rendered only when the page passes `fkeys`), mobile horizontal rail equivalent (`lg:hidden` overflow row). Shell owns: Esc → history-back (bubble phase; suppressed when a breadcrumbless Gateway is mounted — R-50.1 history barrier), **F3 → /companies**, **Alt+G → Go To overlay**, **Alt+S → settings**, **Alt+O → COA** (R-62/R-63).
- **Gateway** (`client/src/pages/Gateway.tsx`): 3-zone grid — company aside (name, GSTIN/state, FY line, session-period line w/ Alt+F2 modal, TB health ✓/✗, signed-in as + Logout) / middle heading list (C A V K R U + letterless items) with `fkey-chip` per heading / right contents pane (`gateway-contents` testid). Letter-nav keydown handler (capture, `window`): **guarded against INPUT/TEXTAREA/SELECT/contenteditable**; item-letter → direct nav; open-pane letters; heading letters; global item fallback with target dedupe. Voucher-type F-keys registered via `useHotkeys(fkeyMap)` **on this page only**.
- **VoucherScreen**: `useHotkeys` map (capture) — Ctrl+A save, Alt+C quick-create (prefills from focused input), Alt+F1 detailed, Alt+J (GST, type-gated), Alt+T (TDS, category-gated), Alt+D/Alt+X (edit-mode, confirm-guarded), Alt+R (RCM, Purchase/DN), quick-modal layering (Esc claims modal-only; Ctrl+A accepts modal). Rail: Ctrl+A, F2 (chip → focuses `#v-date`), F12 Ref/Party (chip → focuses `#v-ref`), Alt+J, Alt+D/X, Alt+R, Alt+T, Alt+C, Esc. Grid arrow navigation via `onKeyDown` on tbodies (R-36); Enter-on-last-row adds a row.
- **DayBook**: F2 focus date, F4–F9 voucher types, Alt+F5…F9 + Ctrl+F7 notes types, Alt+F1 detailed; rail mirrors; row click → editor; type-pill tooltips (R-59 provance).
- **Reports**: Alt+F1 detailed, F2 focus date, `+`/`-` step period day, F12 Prev Year (R-60, three keys); rail mirrors; toolbar chips.
- **MasterPage**: Esc claims only while the slide-over editor is open (v1.50.1 fix); client-side search box filters rows (`search` state, line 32/103).
- **GoTo** (`Alt+G`, every screen): overlay, type-to-filter scoring (label prefix → substring → section), ↑/↓ + Enter, **Esc capture-claimed + stopPropagation** so nothing behind fires. This is zprime's navigation layer. Note: it navigates; it does not filter page data (see §8).
- **hotkeys.ts** (`useHotkeys`): single window-level **capture** listener per mounted map; combos parsed: `F1–F12` (+Alt/Ctrl/Shift prefixes), Ctrl+A, Ctrl+H, **Alt+digit → `Alt+F<digit>`**, Escape, `+`/`-` (and `=`/`_`), Alt+Enter, **Alt+letter** (R-23, no Ctrl/Shift to protect AltGr). **No input-element guard in the hook itself** — by design: every mapped combo is either a modifier chord or a function key, which are unambiguous during typing; plain letters are handled ONLY by the Gateway's own guarded handler. (Verified: typing "Ramesh" in any input cannot trigger nav — letters never reach a global handler anywhere.)

## 2. Current shortcut inventory (from source, not screenshots)

| Shortcut | Context | Action | Implemented in | Visible in UI | Notes |
|---|---|---|---|---|---|
| Alt+G | global (Shell) | Go To overlay | Shell 114 + GoTo | README, r54 | capture-safe overlay |
| F3 | global (Shell) | Change company | Shell 96 | README | bubble listener |
| Alt+S | global (Shell) | Company Settings | Shell (R-62) | Gateway chip, README | |
| Alt+O | global (Shell) | Chart of Accounts | Shell (R-63) | Gateway chip, README | |
| Esc | global | back / close (ladder) | GoTo → page → Shell | README | layered ownership |
| Alt+F2 | Gateway | Change Period modal | Gateway 50 | period line title | |
| C A V K R U + item letters/digits | **Gateway only** | menu/letter nav | Gateway handler | headings/chips | input-guarded; K is NOT app-global |
| F4–F9, F10 | Gateway **and** DayBook | open voucher type | Gateway fkeyMap / DayBook 104 | rail + V-pane hints | **not global** (D-2) |
| Alt+F5…F9, Ctrl+F7 | Gateway + DayBook | note voucher types | same | rail + hints | |
| W | Gateway (V pane item) | Process Payroll | gatewayMenu letter W | V pane | Gateway-only letter |
| F2 | DayBook / Reports | focus date input | DayBook 105 / Reports 81 | rail chips | **voucher: chip-only, key DEAD (D-1)** |
| Alt+F1 | Voucher / DayBook / Reports | detailed/condensed | each page | rail | |
| F12 | Reports (3 keys) | Prev Year toggle | Reports (R-60) | toolbar + rail | browser-reserved in tab view (README documents) |
| + / − | Reports | step period day | Reports + hotkeys.ts | README | `=`/`_` aliases |
| Ctrl+A | Voucher | save (or accept modal) | VoucherScreen 608 | rail | |
| Alt+C | Voucher | quick-create ledger | VoucherScreen 594 | rail | |
| Alt+J / Alt+T / Alt+R | Voucher (type-gated) | GST / TDS / RCM | VoucherScreen | rail | R-34 wired |
| Alt+D / Alt+X | Voucher edit | delete / cancel | VoucherScreen | rail | confirm-guarded |
| F12 (chip) | Voucher | focus Ref/Party | VoucherScreen rail | rail | chip-only (same class as D-1 but a focus nicety, not advertised in README) |
| Alt+1…9 | anywhere a map lists them | **alias of Alt+F1…F9** | hotkeys.ts | **nowhere** | undocumented (D-4) |
| Ctrl+H | — | parsed by hotkeys.ts; mapped by **no page** | hotkeys.ts | — | dead parser branch, harmless |
| arrows/Enter | grids, TypeAhead, GoTo | cell nav, add row, pick | components | — | R-35/R-36 |
| Esc (modal) | quick-create | close modal only | VoucherScreen | — | R-35 layering |

**Verified input safety:** Gateway letters are the only plain-letter shortcuts in the app and they are element-guarded; every `useHotkeys` combo requires a modifier or F-key; TypeAhead/GoTo handle their own keys. Typing "Ramesh" in party/narration/search cannot navigate (architecturally impossible, not just unobserved). Dialogs: GoTo capture-claims Esc; quick-create modal claims Esc + Ctrl+A; native `window.confirm` blocks everything (Alt+D/Alt+X, Day Book delete); the only note is generic focus-restore after modal close (§12).

## 3. The duplication cluster (D-3), precisely

1. **Gateway:** rail lists every voucher type (F4 Contra…) **and** the V pane lists the same types with the same F-key hint chips. Two surfaces, one fact.
2. **Voucher screen:** the toolbar chip row and the right rail overlap (F2/Alt+J/Alt+D/Alt+X/Alt+T/Alt+C appear both — the rail is the fuller list; the toolbar has date/ref/GST controls + chips).
3. **Day Book:** type pills in rows (with F-key hint tooltips) + rail F-keys + Day Book's own chips — three mentions of the same mapping.
The brief's proposed remedies were compared: **contextual rail already exists** and is the right keeper (per-screen, one list, mobile fallback). Recommendation: **rail = the single action list per screen**; Gateway V-pane keeps type *names* (structure) but drops per-row F-key hint chips (the rail is adjacent); Day Book keeps pill tooltips (they're provenance, not shortcut display); unifying chip visuals via one `<Kbd>` component (§10).

## 4. Gateway structural verdict

No reorganization. The operator explicitly rejected the four-section layout this cycle (R-61, reverted, recorded). The current 7-heading + contents-pane model is working, letter-stable, and suite-anchored (r53 43). The brief's "density" ideas are optional polish (§11), not structure.

## 5–7. TallyPrime research (official-source, honestly classified)

- **Alt+G "Go To"** — official TallyPrime universal navigator (TallyHelp). zprime already implements the equivalent (R-54) including report/master/voucher/settings destinations. **Keep; do not extend into filtering.**
- **"Switch To"** — official context-switching (between Go To / screens). zprime's analog is Alt+G itself + Esc; no separate surface warranted.
- **Contextual button bar** — official: the vertical button bar changes per screen. zprime's rail IS this pattern. (The brief's Gateway list showing "F2 Period / F12 Configure" was aspirational: zprime's Gateway has Alt+F2 for period; **F12 is browser-reserved in tab view** (R-51) and must not be advertised globally.)
- **K = Day Book, R = Reports, M = Masters are NOT official global TallyPrime shortcuts** — they are zprime's own menu-mnemonic layer (correctly labelled as such in README since R-53/R-54). No documentation change needed; claim kept honest.
- **F2 (date/period), Alt+F1 (details), Ctrl+A (accept), Esc (back), +/− (navigate)** — official Tally behaviors zprime already mirrors. **Ctrl+F/Ctrl+H/Ctrl+J/Alt+F find/filter** are Tally report conveniences zprime has NOT built; Ctrl+F is browser-owned (find-in-page) and Ctrl+H is parsed-but-unmapped — the honest recommendation is **do not add report find/filter chords now** (no operator demand; Ctrl+F conflicts with the browser); revisit only with demand.
- **Alt+S Stock Query** — official chord, repurposed by R-62 for Settings (documented as such). No conflict: zprime has no stock-query screen.

## 8. Search vs filter

Clean today: **GoTo = navigate** (to a destination), **MasterPage search box = filter** (restricts the list on the page), **reports have period pickers + drill-down** (no text filter). The COA explorer's type-to-filter (R-63) is explicitly labelled "filter" in its UI copy. No ambiguous duplicate chords exist. **No change recommended** — the distinction is real and visible; adding Ctrl+F/Alt+F now would create the confusion the brief warns about.

## 9–10. Collision matrix & input safety (summary)

| Key family | Global? | Inputs safe? | Conflicts |
|---|---|---|---|
| Plain letters (C A V K R U W + items) | Gateway-only | guarded | none (letters never globally intercepted) |
| F2 | page-contextual | n/a (F-keys don't type) | **voucher gap (D-1)**; F2 browser-neutral |
| F4–F10 / Alt+F5–9 / Ctrl+F7 | Gateway+DayBook | n/a | README overclaim (D-2) |
| Alt+letter (A/C/D/G/H/J/O/R/S/T/X) | per-map | modifier chord, safe while typing | AltGr international layouts protected (no Ctrl/Shift requirement in the Alt+letter branch — hotkeys.ts R-23 note); Ctrl+H branch dead (unmapped) |
| Alt+digit | per-map alias | safe | undocumented (D-4) |
| Esc | ladder | claims modal first | order: GoTo → page modal → Gateway pane → Shell history-back (verified in source; r53/r35 suites lock it) |
| + / − / = / _ | Reports | safe (non-typing keys) | none |
| F5/F12 | n/a | browser-reserved in tab view | documented R-51 posture; PWA/app-window path in README |

## 11. Visual audit (brief §4/§18–21) — findings, not opinions

- **Tokens (R-50):** 14px body / 12px floor, tabular numerals app-wide, two-tier elevation, universal `:focus-visible` rings, 8px rhythm. **Healthy; no redesign.**
- **Cards:** used where grouping is real (company panel, form sections, report cards). Day Book rows and reports are tables, not card grids. **No card overuse found.**
- **Purple/indigo:** accent = brand + primary buttons + focus + selection. Semantic states use green/amber/red. **Restrained; no change.**
- **Whitespace/density:** report tables px-3 py-2.5 (dense but airy — deliberate R-50 calibration); Gateway middle column rows 2.5rem; no idled space found at 1366–1920 (R-52 verified full-width usage). **No change.**
- **Company panel / top bar:** company name + GSTIN in top bar AND panel is mild repetition, but the panel adds FY, period, TB health — accounting context the top bar shouldn't carry. **Keep; optional condensation listed under Phase C.**
- **Shortcut chip visual:** one shared `.fkey-chip` class already; the `<Kbd>` componentization (Phase B) formalizes it and fixes the one inconsistency found (Gateway chord chips `!px-1.5` vs standard letter chips — intentional per R-62, but should become a variant, not a utility-string special case).

## 12. Focus management

Sound: GoTo focuses its input on open (30ms), Esc closes; quick-create refocuses the trigger (`refocusTrigger()`); master slide-over Esc claims only while open. Gap (minor): after **GoTo commits** (navigates) and after **modal close via Ctrl+A**, focus lands on BODY — fine for mouse users, suboptimal for keyboard-first (Tab restarts from top). Phase C candidate: restore focus to a sensible anchor (page heading) after navigation; NOT a defect.

## 13. Accessibility

Keyboard-first is genuinely implemented (everything advertised fires — after Phase A closes the two gaps; visible focus everywhere; semantic buttons/links; table headers; pills have text not just color; provance tooltips supplement text). Remaining honest gaps (Phase C/optional): `aria-label` on the fkey-rail buttons comes only from visible text (acceptable), rail is `hidden lg:block` with a mobile equivalent (acceptable), skip-to-content link absent (minor). **No blocker found.**

## 14. Implementation architecture (smallest maintainable form)

Do **not** build a registry framework. Current `useHotkeys(map, deps)` + Shell's two chord handlers + Gateway's letter handler is already effectively centralized: one hook shape, one Esc ladder, per-page maps colocated with the UI they serve (the brief's `enabledWhen/priority` machinery would add indirection for a 7-page app). Phase A/B additions: (1) a **global voucher-F-key layer in Shell** (same data-driven `voucher-types` query Shell already runs for GoTo — zero extra requests) which page maps may shadow; (2) a `Kbd` presentational component wrapping `.fkey-chip`.

## 15. Test plan (Phase A/B)

- Extend real-key acceptance: F2 on voucher focuses `#v-date` (locks D-1); F5 from **Reports** and **Masters** opens Payment (locks D-2 global layer); Alt+1 on Day Book ≡ Alt+F1 (locks D-4 documentation).
- New `input-safety` suite: focus party/narration/master-search, type `ramesh`, assert the text lands and URL unchanged (letters C/A/V/K/R/U/W individually inside inputs); with GoTo open, press K/V/R — overlay consumes, nothing behind navigates; with quick-create modal open, Esc closes only the modal.
- Existing estate must stay green unchanged (r53 43, r54 26, r59 12, r62 15, r63 25, r60 16…).

## 16. Phased plan

- **Phase A — keyboard correctness** (small): D-1 F2-on-voucher (add `"F2"` to VoucherScreen map); D-2 global F-key layer in Shell (data-driven; page maps shadow); D-4 README documents Alt+digit aliases; F12-ref chip documented as chip-only or promoted to the map (decide in implementation); new input-safety suite + real-key extensions. No visual change, no mapping changes.
- **Phase B — shortcut display dedup** (moderate): `Kbd` component; Gateway V-pane drops F-key hint chips (rail owns them); VoucherScreen toolbar keeps controls + only the chips not in the rail (or vice versa — pick one owner per fact); rail header becomes screen-specific ("Voucher shortcuts" etc.). Suite anchors updated honestly (r53 pane-letter scan unaffected — hints are not letters; r34's "chips are the contract" re-anchored to the owning surface).
- **Phase C — optional polish** (operator's pick, none required): focus-anchor restoration after GoTo/modal; company-panel condensation variants; skip-to-content link.

## Risks / Open questions / Next step

- **Risks:** the global F-key layer (D-2) changes "F5 does nothing on Reports" into "F5 opens Payment" — an improvement by Tally logic, but it IS a behavior expansion on screens where F5 currently does nothing; suite-neutral (no suite asserts F5 dead on Reports). Browser-reserved F-keys remain contextual (documented R-51 posture unchanged).
- **Open questions for the operator:** (1) approve Phase A alone, A+B, or A+B+C; (2) D-2 direction: global layer (recommended) vs README reword; (3) VoucherScreen F12-ref chip: promote to keyboard or drop the chip.
- **Proposed next step:** on approval, implement Phase A (investigation → implementation per protocol; v1.55.0-sized).
