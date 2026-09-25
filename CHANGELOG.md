# Changelog

## v1.56.0 — R-65 Gateway voucher-hint restore + Day Book data-driven voucher map/rail (RELEASED 2026-09-25 — commit PENDING-AT-WRITE, annotated tag PENDING-AT-WRITE; pushed immediately after tagging)

**R-65 (operator: "the voucher list option shortcut hint is gone meaning the shortcut letter are not showing"):** R-64's D-3 dedup removed the F-key hint chips from the Gateway's Vouchers pane on the "rail owns the visible facts" theory — the operator's review said otherwise: **the hints ARE the menu** (TallyPrime's Gateway shows each voucher's key beside its name; that's discoverability, not duplication). Restored: pane rows render `Kbd wide` hint chips again (F4 Contra … F10, Alt+F5 … Ctrl+F7, W — verified `F4Contra` row text and all 14 chips). Second half (operator-approved "Pane + Day Book rail combined"): **Day Book's voucher map + rail are now data-driven** from the seeded types (same pattern as the Gateway, ordered by the shared `voucherKeyRank`, page map still shadows R-64's global floor) — the old hand-maintained list had drifted: **F10 Manufacturing Journal was missing from Day Book** (only worked there via the global layer since v1.55.0; the rail never showed it); now the rail carries the full 13-key vocabulary in shortcut-class order and a future type's key appears automatically. Honest re-anchor: r34's D-2 chord loop waits for the rail chips before pressing (the data-driven map is powered by the same state as the rail — the wait IS the keyboard contract; cold-load race pre-dated R-65 but was masked by the hardcoded map). New `r65_ui.js` **12/12**; all anchors green; full estate green on a fresh volume (run.js 153, final 948, smoke 39). Zero mapping changes, zero accounting surface, client-only (Gateway.tsx chip branch + DayBook.tsx + r34 wait + r65_ui.js new).
## v1.55.0 — R-64 keyboard correctness (F2 on vouchers, global voucher F-keys) + shortcut display dedup + focus polish (RELEASED 2026-09-25 — commit `b37cc90bf9ee2ce954a556f1d9aac1dbf92fd58c`, annotated tag `33c76ad4756afe7e7818cfa38d8f0b0f27a8f48f`; pushed 2026-09-25 together with the v1.50.0–v1.54.0 backlog — remote verified == local)

**R-64 implements Phases A+B+C of `R-64_INVESTIGATION.md` (operator-approved: full polish; D-2 resolved by "make it true" — a global F-key layer; the voucher F12 Ref/Party chip stays click-only).** **Phase A — keyboard correctness:** (D-1) physical **F2 on the voucher screen now focuses the Date field** — the rail chip and the header's "Date (F2)" label advertised it, but only the chip's onClick worked (live-probed defect: focus stayed on BODY); (D-2) **voucher F-keys are global** — Shell registers a data-driven floor layer from the cached voucher-types query (zero extra requests) so F4…F10 / Alt+F5…F9 / Ctrl+F7 open their voucher types from EVERY screen, making the README's long-standing "from any screen" claim true; page maps (Gateway/Day Book) shadow it with identical targets — `useHotkeys` now skips `defaultPrevented` events so a keypress can never double-fire (duplicate history entries would break the Esc ladder); **editor safety:** the global layer is suppressed while a voucher is open in the editor — a stray F-key mid-entry must never silently discard a half-filled voucher (Esc first, then the F-key); (D-4) the undocumented **Alt+1…9 ≡ Alt+F1…F9 alias** is now documented in README. **Phase B — one owner per shortcut fact:** new `Kbd` component (client/src/components/Kbd.tsx) unifies chip rendering (letter box vs wide chord variant — the R-62 special-case class strings are gone); the Gateway pane drops per-row F-key hint chips (the adjacent rail owns the visible F-key facts; pane rows keep names, letters/chords and hover titles); the rail header is screen-specific ("Voucher shortcuts", "Day Book shortcuts"…); rail rows carry aria-labels. **Phase C — focus polish:** after chord navigation (Alt+G/Alt+S/Alt+O/F3 → page change) focus lands on the page heading (h1) or the main region (tabindex=-1) — never BODY; a **skip-to-content** link is the first tab stop; **GoTo focuses its input synchronously** (useLayoutEffect — the old 30ms setTimeout left a real race window where a fast keystroke after Alt+G fired the Gateway's letter-nav behind the overlay — found by the new dialog-safety test and fixed). README: keyboard table gains F10/Alt+digit rows + a chip-vs-key note (click-only chips like F12 Ref/Party are conveniences, everything listed fires from the keyboard). New `r64_ui.js` **13/13**: D-1 F2-focus; D-2 F8-from-report + F5-from-masters + editor suppression; D-4 alias (rail chip flips); input safety (CAVKRUW+R/K typed into master search and "Ramesh" into narration — text lands, no navigation); dialog safety (GoTo consumes K; Esc closes overlay then modal without history-back); focus anchor. En-route inventory corrections recorded: Day Book has **no** Alt+F1 (Voucher + Reports only — R-64 §2 table fixed by the suite); one-off r54 cold-cache flake re-verified ×3.

> **R-61 outcome note (2026-09-25):** the R-61 Gateway reorganization was investigated, approved, implemented, and verified green (`r61_ui.js` 43/43), then **rejected by the operator at pre-release review in favor of the pre-R-61 short list** ("i prefer the previous version where the list is short and precise") and **reverted byte-identical** to the pre-R-61 tree (`aa90cfe`) — full estate re-run green at baseline (r53 43/43, run.js 153, final 948, smoke 39). Zero production residue: no R-61 code, test, or doc changes remain. The study (`R-61_INVESTIGATION.md`) and implementation learnings (sectioned-Gateway rendering, punctuation-chip expanders, freed-letter discipline) stand as a completed experiment for any future revisit of Gateway organization.

## v1.54.0 — R-60 cross-FY report comparison (Prev Year columns) · R-62 Gateway arrangement (operator-specified) + Alt+S settings · R-63 Chart of Accounts explorer (RELEASED 2026-09-25 — commit `cf8c7fd99e1e12ff22839dd4d873591c4aeb5c60`, annotated tag `1710dbebdb055ecd9860676f94d93abd311b2c66`; pushed 2026-09-25 — remote verified == local)

**R-63 answers "i think we miss the chart of account feature right" — Tally's Chart of Accounts explorer, Option A (operator-approved).** The finding first: the CHART itself was never missing — all 28 Tally-defined groups (correct parents + natures), custom subgroups, and ledger masters existed and roll up through the Balance Sheet/P&L/Group Summary machinery; what was missing was Tally's **single-tree explorer view**. Now: `GET /reports/chart-of-accounts` (cid-gated, period-scoped like every report, read-only) composes the existing primitives — `getGroupRows` + `ledgerBalances` + `buildGroupTree(includeZero)` — returning the full group tree with rolled-up opening/debit/credit/closing **plus the flat ledger list** (every master, zero-activity included). Client `ChartOfAccountsView` in Reports.tsx renders ONE expandable tree — group rows (rollup figures) and ledger leaves (own figures) intermixed, expanded one level at rest, expansion persisted across refetches; **type-to-filter** narrows the tree to matches (ledger or group name, case-insensitive) keeping every ancestor, Clear restores; **click a ledger → Ledger Vouchers** (state-passed ledgerId), **click a group → Group Summary**; balances recompute with the period picker (openings recompute per window — a June window shows May's 500 as carried-forward opening/closing with blank Dr/Cr, Tally-style). Registration: the Gateway Reports pane (chip **Alt+O** — the letter space is saturated (all 26 + 10 digits per R-53c), so the COA carries a chord like Company Settings' Alt+S; the r53 global-uniqueness scan caught the first-cut plain `O` colliding with Godowns — the chord resolves it with zero mnemonic churn) + **Alt+O from any screen** (Shell's every-screen handler, alongside F3/Alt+S) + the Alt+G palette (flattenMenu advertises the chord chip). New `r63_ui.js` **25/25**: full tree (roots + depth-1), all ledgers incl. a zero-activity master with dash-blank balances, filter/clear, click-through with state, Gateway chip + Alt+O fire + palette, period re-computation both windows, zero page errors. En-route finding: a one-off r54 cold-cache flake (24/26) that passed 26/26 on re-run ×3 — suite timing, not app.

**R-62 polishes the Gateway's muscle memory (operator: "arrange the gateway options in order, and voucher options too like the common one should be at the top. and company setting shortcut change it." — arrangement finalized by the operator after seeing the first cut)** — client-only, zero accounting surface: (1) **Heading order (operator-specified)** — Create, Alter, Vouchers, Day Book, Reports, Utilities, Company Settings (was V/K/C/A/R/U); (2) **the Vouchers pane is ordered by shortcut class** — plain F-keys first (F4 Contra, F5 Payment, F6 Receipt, F7 Journal, F8 Sales, F9 Purchase, F10 Manufacturing Journal), then the Alt+ chords (Alt+F5 Debit Note … Alt+F9 Receipt Note), then Ctrl+ (Ctrl+F7 Physical Stock), keyless types last — the same rule the Day Book's rail already uses (shared `voucherKeyRank` sort; the seed order in the database is untouched — pure presentation, and user-created keyless types land last); (3) **Company Settings gets a real shortcut** — **Alt+S** (Tally's Stock-Query chord, unused in zprime), registered globally in Shell (same every-screen pattern as F3; inert while the Go To palette is open) so Settings is one chord from ANY screen, advertised on the Gateway chip and in the Go To palette via `flattenMenu`; the plain letter S stays with Sales Register (no collision), and R-59's unpressable `·` punctuation chip is retired for a live chord. No letter reallocation: the R-53c 26-letters+10-digits scheme is untouched (Alt+S is a chord, not a letter). En-route fix found by the suite: the first cut's universal chip widening stretched the Day Book **K** chip — only chord chips widen now, single-letter chips keep the standard 1.7rem box. `gatewayMenu.ts` carries the order, the `voucherKeyRank` export, and the `chord` field; `Gateway.tsx` renders the chord chip and sorts the Gateway rail by the same key-class rule; `Shell.tsx` registers Alt+S. New `r62_ui.js` **15/15**: exact seven-heading order assertion; Vouchers pane = [Contra, Payment, Receipt, Journal, Sales, Purchase, Manufacturing Journal | Debit Note, Credit Note, Stock Journal, Delivery Note, Receipt Note | Physical Stock | Payroll] (14 items); K chip measured equal to the C chip while Alt+S is the only widened chip; chip advertises Alt+S; chord fires from the Gateway, Day Book, and Trial Balance; plain S still fires Sales Register; palette advertises the chord; zero page errors. r59 re-anchored honestly 11→**12** (the letterless-`·`-chip check became the Alt+S-chip check + a live Alt+S-from-Day-Book check — strictly stronger); all other suites green unchanged.

**R-60 implements Option A of `R-60_INVESTIGATION.md` — Tally's F12 "previous year" columns on the headline statements.** Every figure beside the current window now has a real prior-year answer: **server-composed** (the same service function runs twice — zero engine change, zero schema change) via a `compare=1` query flag on the three big reports, additive so the off-state is byte-identical to the pre-R-60 response (probe-verified: no `previous` key when off).

**Server (`server/src/routes/reports.ts`):** `prevWindow(from, to, booksBegin)` derives the **same-length slice one year back** (a full-FY view compares against the full prior FY; an Apr–Jun slice against the prior Apr–Jun — Tally's period-report semantics; Feb-29-safe via day-clamp) and returns **null when the entire prior window precedes the books** — the client renders an honest dash, never a fabricated zero; a partial overlap is kept (pre-books dates simply carry no vouchers, and the engine already computes honest openings for any window per R-56 F2). `withCompare(q, booksBegin, financialYearStart, window, run, asOf)` runs the wrapped service fn over the current window, then — when `compare=1` — over the derived prior window, returning `{...current, previous, previousWindow, compareLabels}` (labels via `fyStart` year math: `FY 2026-27` / `FY 2025-26`). Wired on `/trial-balance` and `/profit-loss` (from→to window) and `/balance-sheet` (as-of: window={to,to}, `asOf=true` → prior as-of one year back, e.g. 2026-03-31 vs 2025-03-31).

**Client (`client/src/pages/Reports.tsx`):** one **"Prev Year" toggle for the three headline keys** (`COMPARE_KEYS` = profit-loss / balance-sheet / trial-balance; the toolbar checkbox is rendered only there) — `qs` gains `compare=1` when on. **F12 = the toggle** (Tally's own slot for F12 configuration/previous-year on reports), as a hotkey on those keys only and as an fkey-rail button ("Prev Year" / "Hide Prev Year"). **P&L:** the prior-year column rides the existing DrCr/CrOnly cells (dash when the ledger had no prior activity), the four card headers carry `FY X vs FY Y` label spans, and totals rows carry prior sums. **Balance Sheet:** the server's `previous` payload is flattened by group id into the current tree (a group that exists only in the current books has no prior node → dash, never a fabricated zero); a "Prev" th/td renders with a title `As on <prior as-of date>`. **Trial Balance:** prior net closing per ledger (`totalDebit − totalCredit`, dash when the ledger had no prior activity), a "Prev FY <label>" th titled with the prior window dates, and a "Prev Closing" CSV column only when on.

**Verification:** typecheck server+client clean · build clean · new `r63_ui.js` **25/25** · new `r62_ui.js` **15/15** (operator heading order; shortcut-class voucher order F→Alt+→Ctrl+→keyless; K chip = C chip width with Alt+S the only widened chip; Alt+S chip + chord from Gateway/Day Book/report; plain-S untouched; palette advertises the chord; zero page errors) · new `r60_ui.js` **16/16** (April-2025 company: toggle on the big three only — no toggle on Day Book; P&L current vs prior card-header spans; BS Prev column + as-of title + Cash-in-Hand group value; TB Prev column with prior-window title + prev totals + CSV column present only when on; F12 toggles race-free; off-state has no prev column; zero page errors) · r59 re-anchored **12/12** · full estate green on a fresh volume: r63 25, r62 15, r59 12, r58 15, r57 21, r56 22, r54 26, r53 43, r60 16, r34 20, r35 23, r20 12, r26 12, r27 15, run.js **153/153**, final_regression **948/948**, smoke **39/39** · `git diff --check` clean

## v1.53.0 — R-57 per-FY voucher-numbering restart · R-58 company users (creator-only member management + password reset) · R-59 Gateway discoverability + Day Book provance (RELEASED 2026-09-24 — commit `a89d441a4ed42bcc824a616fc3ebe31710751d5e`, annotated tag `894f6d65d386977b5fb943549fafb8203247d82b`)

**R-58 adds the missing UI for company user management** on top of R-03's membership machinery (the API existed since v1.3.0 — curl-only until now), exactly as approved: **no roles in any meaningful sense** — every member has full access to the company (post vouchers, edit masters, run reports); the only privileged actions are member-admin ones, held by the **company creator** (the internal `owner` membership role, shown in the UI as one plain "can manage users" tag — no roles vocabulary). **Company Settings → Users card:** list (User · Access="Full access" · actions), **Add user** (username + password, creating the `users` row and the membership in one call), **Remove** (confirm-guarded; the server's last-owner 409 "Cannot remove the last owner of a company" surfaces verbatim, duplicate-username 409 likewise), and **Reset password** (inline card — the creator types a new password for an existing member; previously a forgotten password was unrecoverable, as there is deliberately no email flow). **Server:** new `PATCH /api/companies/:id/members/:userId` `{password}` — owner-only via the R-03 `requireOwner` gate (403 for plain members, who see the list read-only; the UI hides the controls AND the API refuses — proven both ways), target must be a member of THIS company (404 no-leak), scrypt-hashed like every password. Membership read stays open to all members (a member can see who else works in the company). Removal semantics unchanged: the user row survives (they may belong to other companies) but loses all access to THIS company instantly (membership-checked on every request; a zero-membership user sees an empty company list). Client: `patch` helper added to `lib/api.ts`. Operator request also **removed the two Gateway hint lines** (the browser-reserved-keys install note and the "press a heading's letter" instructions) — README keeps the shortcut documentation.

**R-58 verification (in the v1.53.0 estate):** typecheck server+client clean · new `r58_ui.js` **15/15 ×3 consecutive** (creator tagged; add×2 through the form; duplicate-username 409 surfaced; member sees the list read-only with no admin controls + non-manager note; member Day Book works; reset via UI; sign-in with the new password; removal via UI; last-owner 409 surfaced; zero page errors — run-unique usernames so re-runs stay idempotent on a used volume) · curl probes: member add/reset/remove attempts 403, reset ⇒ old password 401 / new 200, removed member's company detail + voucher API 404 no-leak, removed user's companies list empty

**R-59 closes two discoverability/visibility nits from operator review:** (1) **Company Settings now surfaces at level 1 on the Gateway** — a letterless `·` chip (all 26 letters + 10 digits stay allocated per R-53c arithmetic), Tally's "Display More" slot: administrative entry points park last; one click reaches Settings → Users instead of Utilities → pane → link. The U pane keeps XML Import/Cheque Printing/Audit Trail; the Go To palette (Alt+G) still serves Settings from `gatewayMenu.ts`'s single source of truth. (2) **Day Book provance** — the vouchers list API joins R-22's actor stamps (`createdByUsername` via left join, `updatedByUsername` via a null-safe scalar subquery, both null-safe for pre-R-22/system rows) and every Day Book type pill carries a tooltip: `Posted by <user>` and — when someone else edited it last — `· Last edited by <user>`. The voucher edit screen keeps R-18's fuller audit strip (this session's earlier VoucherScreen provance state was recognized as redundant with R-18 and reverted before release). `/vouchers/:id` also returns the provance usernames for API consumers.

**R-57 implements Option B of the R-55 multi-FY study**: Tally's "voucher numbering restarts each financial year" — a per-type **numbering periodicity**, exactly as Tally binds it to the voucher type.

**Server:** `voucher_types.numbering_periodicity` (`'never'` default = the classic single never-resetting counter, byte-identical behaviour for every existing type; `'fiscal'` = the automatic counter restarts each FY at the type's Start Number). Migration `0016_r57_numbering_periodicity.sql` (additive-only, no backfill): the new column plus **`vouchers.fy` / `voucher_counters.fy` — the numbering bucket, NOT NULL DEFAULT ''** (the FY-key, the fiscal-year BEGIN date like `2026-04-01`, for 'fiscal' rows; `''` for the never-series) and the two rebuilt unique indexes `vouchers_company_type_fy_number_uq (company, type, fy, number)` + `counter_company_type_fy_uq (company, type, fy)` (dropping `vouchers_company_type_number_uq` / `counter_company_type_uq`). **NOT NULL is load-bearing:** a NULL bucket defeats a unique index (SQL treats NULLs as distinct) — live-reproduced during this cycle: with a NULL fy, every never-type `nextNumber` init inserted a fresh counter row and the `fy IS NULL` UPDATE advanced all of them, splitting one (company, type) series across ~20 divergent counter rows and producing duplicate-number 409 storms (caught by run.js's salary-payment voucher). `''` also makes the v1.52.0 upgrade path correct with zero backfill — every existing row lands in the `''` bucket, which is exactly its pre-R-57 series, and the old `(company, type, number)` uniqueness guarantees no collisions when folded in. **Semantics:** manual numbers can repeat across the FYs of a fiscal type but never within one bucket — including `''`, so 'never' types keep their strict pre-R-57 no-duplicate guarantee (a manual dup across FYs of a never-type is refused, as it always was). `nextNumber` is bucket-aware (init + UPDATE + GREATEST-clamp per bucket); voucher create, edit (bucket re-derived from the moved date), and Tally XML import (`syncCounters` per-FY max-map) stamp the bucket; `/vouchers/next-number` accepts `date=` and peeks the queried date's FY bucket for fiscal types (returning `{number, fy}`). **Periodicity is locked once vouchers exist:** the voucher-types CRUD hook refuses a periodicity change (409, actionable "use a new voucher type instead") whenever the type already has any voucher — flip detection compares the body value to the stored value, so plain renames and same-value saves pass; a generic `crud.ts` fix lets PUT `beforeSave` hooks see the target row id (route params folded in before the id-strip; groups' hook unaffected). En-route cleanup: the earlier in-transaction NULL-fy guard in `insertVoucherTx` was removed — dead code once the masters lock exists (bucket mismatch is unrepresentable when periodicity cannot flip under vouchers).

**Client:** Voucher Types master gains the **Restart Numbering** selector (Never / Each Financial Year, with the once-vouchers-exist lock hint); VoucherScreen **re-peeks the next number when the voucher date changes** (250ms debounce; skipped in edit mode and while the number field is manually overridden — posting re-draws server-side regardless). README New-FY checklist step 3 now describes the setting.

**Verification:** typecheck server+client clean · build clean · new `r59_ui.js` **11/11** (level-1 Settings link with the `·` chip → one click to Settings; U pane intact; Alt+G still finds Settings; Day Book pill tooltip names the poster; R-18 audit strip intact; zero page errors) · new `r57_ui.js` **21/21** (seed defaults 'never'; never-type continuity across the FY boundary + `''` bucket stamping; flip refused 409 after the first voucher; fiscal type restarts F-1 in the new FY and keeps counting within it; peek per date returns that FY's bucket; manual dup refused within an FY, F-9 honoured and reused across FYs; R-10 replay intact; edit re-stamps the bucket across the boundary; MasterPage selector renders; never-type peek stable across date change; zero page errors) · r56 **22/22** · r54 **26/26** · r53 **43/43** · r34 20 · r35 23 · r20 12 · r26 12 · r27 15 · run.js **153/153** fresh volume (this suite caught the counter-split regression mid-cycle) · final_regression **948/948** · smoke **39/39** · counter-bucket uniqueness verified in psql (`total_rows = distinct buckets`) · r58 **15/15** ×3 consecutive · r56 **22/22** · r54 **26/26** · r53 **43/43** · r34 20 · r35 23 · r20 12 · r26 12 · r27 15 · run.js **153/153** fresh volume · final_regression **948/948** · smoke **39/39** · `git diff --check` clean

## v1.52.0 — multi-FY Option A: session current period (Alt+F2), stored-FY defaults, honest date-window handling (RELEASED 2026-09-24 — commit `06e6dd9c34f5246e4bf1fc9877a4ce91a68b982d`, annotated tag `e4097e1738278cc434e2951bee3765d1a5fe9062`)

**R-56 implements Option A of the R-55 multi-FY study** (`R-55_INVESTIGATION.md`): Tally's recommended "Change Current Period" model — one company, balances carry forward, the period is a lens — plus the study's two client findings fixed.

**Session current period (G1):** **Alt+F2 on the Gateway opens a Change Period modal** (`periodOpen` state; the hotkey engine already mapped the chord) — set a per-company session period, stored in `localStorage` under `zprime_period_<cid>` (helpers `loadSessionPeriod`/`saveSessionPeriod`/`clearSessionPeriod` in `client/src/lib/format.ts`). The Gateway company block shows a **period line** — `Period dd-mm-yyyy → dd-mm-yyyy` when set (indigo, clickable), `Period: Full FY` otherwise; **Reset to FY** clears it. Day Book and every report **default to the session period** when present. Company data untouched — FY-begin and books-begin never move; the period is client state, not books state.

**Stored-FY defaults (F1 fix):** every client default window now derives from the company's **stored `financialYearStart`** instead of a hardcoded April — Gateway FY line shows `financialYearStart → fyEndFromBegin(financialYearStart)` (anniversary − 1 day; a July-begin company shows FY 2025-07-01 → 2026-06-30, never a calendar recompute); Day Book and Reports default windows come from `useCompanyPeriod` (`client/src/lib/period.ts` — session period first, stored FY begin second, April fallback while the company query loads; explicit date changes on the page override everything). The `to` default stays `today()` (running window — the FY is not over until it's over). Server mirrors it: `fyStart(date, fyBegin)`/`fyEnd` accept the stored begin (`server/src/lib/util.ts`), and the reports router's period/FY-window helpers pass `company.financialYearStart` through — report defaults without explicit `from` honour the stored FY.

**Honest date windows (F2 fix + Tally-parity warning):** vouchers dated before `booksBeginFrom` were **accepted but silently excluded** from openings — the `gte(vouchers.date, booksBeginFrom)` lower bounds in `ledgerBalances` (prior movements), `balanceSheet` (P&L from `bsFrom`) and `ledgerVouchers` (prior running balance) dropped them, breaking the trial balance. All three lower bounds removed: openings/prior movements now aggregate **all** history (`lt(vouchers.date, from)`; P&L in the balance sheet runs from an `EARLIEST_DATE = 0001-01-02` sentinel — not 01-01, because the opening-stock path's `addDays(from, -1)` must stay inside Postgres' date range). The opening-balance master field remains additive on top. At the door, `voucherDateWindowWarnings` (`server/src/routes/vouchers.ts`) returns **non-blocking advisories** for pre-books-begin and future-dated vouchers (Tally warns too); the create and edit paths attach `warnings[]` to the 200 response — the voucher **saves normally**, VoucherScreen forwards them to the Day Book via a one-shot `sessionStorage` hand-off (`zprime_voucher_warnings_last`) that renders as an amber banner and self-clears.

**README:** new "New Financial Year (Tally's recommended path)" section — nothing-to-migrate explanation, the Alt+F2 checklist, the never-change-FY-begin/books-begin rule, and the pre-books/future advisory note.

**Option B (per-FY voucher-numbering restart) remains deferred** — separate cycle, documented boundary.

**Verification:** typecheck server+client clean · build clean · new `r56_ui.js` **22/22** (July-begin company proves non-April defaults on Gateway FY line + Day Book + Trial Balance; Alt+F2 modal → apply → localStorage persisted → Day Book/Reports follow → user date-change override → Reset to FY; pre-books voucher 200 + books-begin warning + still listed in a covering Day Book window + counted in a ledger opening (400) after books-begin; future voucher warns; second company shows its own April FY and no session period — per-company isolation) · r54 **26/26** · r53 **43/43** · r34 20 · r35 23 · r20 12 · r26 12 · r27 15 · run.js **153/153** fresh volume · final_regression **948/948** · smoke **39/39** · `git diff --check` clean

## v1.51.0 — TallyPrime shortcut parity: Go To palette + full voucher-key vocabulary (RELEASED 2026-09-24 — commit `b31201115147dfe91481d303018d854ab4b1dd02`, annotated tag `e37e7b94d96fa8caded01841c5f32ee3ac2ef9b9`, pushed; includes the v1.50.1 operator fixes, client-only)

**v1.50.1 operator fixes (folded into this release):** master-page Esc-back restored (the slide-over editor claimed Esc while closed; now the hotkey map carries Escape only while `editing` is open) · **the Gateway is the last stop** — Shell pushes a same-document duplicate history entry on breadcrumbless company pages and re-pushes on every popstate, so browser Back can never climb to the company-select page (reachable only via Switch Company / Logout); the ← arrow renders only when a breadcrumb exists; Esc at a bare Gateway does nothing · second-pass shortcut slots **W** Process Payroll, **2** Stock Groups, **4** TCS Sections, **5** Receivables, **6** Payables, **7** TDS Report, **8** TCS Report, **0** Salary Register, **J** Cheque Printing, **Z** Audit Trail (Company Settings stays the one letterless option — 26 letters + 10 digits all taken).

**R-54 Option B — Alt+G = Go To (Tally's universal navigator):** a type-to-filter command palette (`client/src/components/GoTo.tsx`) over every Gateway destination — reports, masters, voucher types, utilities, Day Book — mounted in Shell so it opens on **every** screen; ↑/↓ + Enter navigate, Esc closes without touching history (capture-claimed), Create/Alter's shared masters set shows each option once (dedupe in `flattenMenu`). Scoring: label-prefix → label-substring → section-prefix → section-substring, then shorter label, then A→Z. **Apply-GST moved from Alt+G to Alt+J** — Tally's own statutory-adjustment slot (a strictly better semantic fit); voucher rail chips re-labelled; r34/r35 re-anchored (chord + 3 assertions), zero accounting-semantics change.

**R-54 Option A — the rest of the parity batch:** Gateway binds **every seeded voucher-type `functionKey` data-driven** (F4 Contra, F6 Receipt, F7 Journal now work from any screen; future types inherit automatically; first type wins on duplicate hints) · **Alt+D = delete voucher** and **Alt+X = cancel voucher** on edit screens (confirm-guarded, same server contracts as the Day Book buttons; cancel keeps the row with `isCancelled` per R-02) · **F3 = change company** on every company page incl. the breadcrumbless Gateway (Shell-level, F3 is page-interceptable) · **+ / − = next/previous report day** on reports (period length kept; engine learned `+`/`=` and `-`/`_`; inert while typing in inputs) · README keyboard section now a full TallyPrime-parity table.

**Discovery recorded for posterity:** the shared menu model lives in `client/src/lib/gatewayMenu.ts` (single source of truth for Gateway + Go To). Parity study: `R-54_INVESTIGATION.md`; raw official shortcut map: `TALLYPRIME_SHORTCUTS_REFERENCE.md` (browser-blocked and feature-missing families documented there as boundaries, not backlog).

**Verification:** typecheck+build clean · `r54_ui.js` **26/26** (rail carries every F-key; F4/F6/F7 distinct-type navigation from the Gateway; Alt+G palette opens on Gateway **and** voucher screens, filter+Enter navigates, Esc closes without history-back and history-back still works after; F3 at the Gateway → companies → Back returns; +/- step and restore the period; Alt+X cancels (isCancelled, row kept) and Alt+D deletes (gone from books) via keyboard with confirm; Alt+J posts both GST halves at ₹900 on the unsaved voucher; Alt+G on a voucher screen is Go To, not apply-GST) · r53 **43/43** (rail check relaxed to `.first()` — the data-driven rail legitimately carries Alt+F5 alongside F5) · r34 **20/20** and r35 **23/23** re-anchored to Alt+J · r20 12 · r26 12 · r27 15 · run.js **153/153** fresh volume · final_regression **948/948** · smoke **39/39**

## v1.50.0

Three operator reports, all reproduced live before fixing:

- **Esc dead on master pages** (Alter → Ledgers/Groups/… did nothing on Esc): `MasterPage`'s slide-over editor claimed Esc **unconditionally** (`useHotkeys({ Escape: … }, [])`), starving Shell's history-back even while the editor was closed. Fixed to the VoucherScreen modal pattern — the Escape entry exists in the hotkey map only while `editing` is open; closed-editor Esc now closes the slide-over, and a second Esc history-backs to the Gateway.
- **Gateway must be the last stop**: browser Back from the Gateway climbed to the company-select page (and the ← arrow rendered even without a trail). Now: the ← arrow renders only when a breadcrumb exists; while a breadcrumbless company page (the Gateway) is mounted, Shell pushes one same-document duplicate of the Gateway entry and re-pushes on every popstate — browser Back is absorbed at the top and the pre-Gateway document boundary (typically the Companies page load) stays buried until unmount. Esc at a bare Gateway does nothing (Tally behaviour). Companies remains reachable only via **Switch Company** / **Logout**.
- **No option without a shortcut**: the 11 letterless items from R-53c's strict letters-only allocation now carry second-pass slots — **W** Process Payroll, **2** Stock Groups, **4** TCS Sections, **5** Receivables, **6** Payables, **7** TDS Report, **8** TCS Report, **0** Salary Register, **J** Cheque Printing, **Z** Audit Trail (GSTR reports keep 1/3/9). **Company Settings is the one remaining letterless option** — all 26 letters and all 10 digits are now taken; it stays reachable via arrows/Enter/click (the alternative would be a punctuation hotkey; not taken without operator direction).

**Verification:** typecheck+build clean · `r53_ui.js` **43/43** (adds: master slide-over Esc-close then Esc-back, opened-from-Companies → Back absorbed at Gateway, no ← on Gateway header but present on Day Book, Esc inert at bare Gateway, W/2/8 direct-fire, company name made run-unique) · r20 12 · r26 12 · r27 15 · run.js **153/153** fresh volume · final_regression **948/948** · smoke **39/39**

## v1.50.0 — R-52: one-line text fit + full-width body · R-53/R-53c: TallyPrime-style Gateway, globally unique hot letters (RELEASED 2026-09-24 — commit `7d0dcf2f6ccdde29e7b8a87bb454cfc468f520af`, annotated tag `e09d0844da4b0e636861008b2662aa1792a8b0cc`, pushed)

**Investigation (`R-52_INVESTIGATION.md`, all findings DOM-measured at 1366+1920):** two systemic wrap bugs — (1) dates snap at their own hyphens (`dd-mm-yyyy` break points; GSTR-1 date wrapped in a 72px cell on a 1686px table) and (2) inline pills break mid-word (Day Book type pill 57px × 2 lines stretched every row to 58px — the operator-reported "compressed" Day Book). Plus: fkey rail labels wrapped (rail narrowed to 168px), `max-w-7xl` idled 448px on 1920 monitors, Masters Del button rendered as two stacked line boxes (37px).

**Fixes (CSS + class strings only, zero logic):** `.cell-nowrap` and `.pill` (`inline-flex` + `whitespace-nowrap`) tokens in index.css; applied to all date/voucher-number cells, Day Book type cell + 3 pills, Audit Trail action pill, GSTR party/GSTIN cells, Cash/Bank Period Dr/Cr headers, Stock Closing Qty header; fkey rail `w-48 → w-64` (all labels one line); standard pages drop the `max-w-7xl` cap (tables use the full body width); Masters Del button `leading-none` normalization. Detector evolution recorded honestly: line-height math false-positives (padding, mixed font sizes, Chromium Range quirks on buttons) → final robust metric = text width vs container inner width.

**Gateway compaction (operator follow-up, same release):** the cluttered card-grid Gateway is restructured into a four-column single row — Masters / Transactions / Reports / Utilities as flat link columns (no card chrome), and one slim status card (company + GSTIN/state/FY on one line, Books Health, signed-in + Logout) plus the Shortcuts card in a 280px rail; all 32 menu labels and the suite-asserted Books Health wording preserved verbatim; per-item fkey chips kept; install hint condensed to one line with the full text on hover (title) and in README. Measured: all four section columns top-aligned at one row (659px columns, 465px rail), page height = viewport (900px, zero scroll at 1366×900), Shortcuts rows exactly 26px one-line.

**Verification:** typecheck+build clean · geometric sweep **ZERO overflowing short texts across 50 page-checks** (25 pages × 1366/1920) · Day Book rows 58→**45px**, Masters rows 58→**57px** with one-line Del · run.js **153/153** fresh volume · final_regression **948/948** · smoke **39/39** · r03 12 · r14 11 · r33 13 · r34 20 · r46_drill 39.

**R-53 — TallyPrime-style Gateway (operator request, same release; revised once on operator feedback):** the Gateway now mirrors TallyPrime's actual layout (verified against Tally documentation before building): **left rail = company info only** (name wraps via break-words so nothing exits the card, GSTIN·state one-liner with title-fallback, FY, Books Health, signed-in + Logout, one R-51 app-window notice); **middle = general headings only, nothing expanded at rest** — **V**ouchers (voucher types + Process Payroll) · **K** Day Book (direct link, like Tally's top entry) · **C**reate (all masters) · **A**lter (masters) · **R**eports (16, folded) · **U**tilities — masters deliberately live under Create/Alter per Tally; **right = contents of the one selected heading only** (`data-testid="gateway-contents"`, neutral hint pane at rest). The duplicate Shortcuts card was removed on operator feedback — the Shell fkey rail is the single shortcut surface. Hot-letter navigation with Tally semantics: item letters win inside the open heading (R→T = Trial Balance), heading letters jump at any level, globally unique letters fire directly (K = Day Book from anywhere), ambiguous letters drill + highlight without guessing (P → Vouchers/Process Payroll); arrows/Enter/Esc per Tally. Voucher-type rows keep fkey chips, carry no item letter. All 31 item labels preserved verbatim as `<a>` links + Day Book as a direct heading link.

**R-53 verification:** acceptance suite `r53_ui.js` **17/17** (layout zones, headings-only at rest — 6 headings, 0 expanded items — K/R/B/T/C letters, item-letter precedence, ambiguous-P drill-down + highlight, Esc, all 31 labels as links + Day Book direct link, fkey rail F2/F5/F8/F9, zero page errors) · long-company-name probe: name wraps to 3 lines fully inside the card, zero overflow · exactly **1** "Shortcuts" surface (Shell rail) · Gateway-link fixtures re-anchored to open their heading first — r20 **12/12**, r26 **12/12**, r27 **15/15** · run.js **153/153** fresh volume · final_regression **948/948** · smoke **39/39** · page height = viewport (900px, zero scroll at 1366×900) · screenshots reviewed (initial, Reports-open, long-name).

**R-53c — operator follow-up on R-53, same release:** three rules. (1) **Hot letters globally unique** — no two options anywhere in the Gateway share a shortcut letter (headings V/K/C/A/R/U included). Best letter of the option's own name wins; when every name letter is already taken the item ships letterless (Stock Groups, TCS Sections, Process Payroll, Receivables, Payables, TDS Report, TCS Report, Salary Register, Cheque Printing, Audit Trail, Company Settings — arrows/Enter/click reachable). Notable re-allocations: Purchase Register G→**P**, Profit & Loss keeps **F** of "ProFit", Salary Register drops the bogus **W**, GSTR-1/3B/9 keep digits 1/3/9. Create/Alter render one shared masters option set — the key handler dedupes by target so a letter still fires. (2) **Esc = true history-back**, owned by Shell: Day Book entered from Gateway → voucher → Esc returns to the Day Book; voucher opened via Gateway F5 → Esc returns to the Gateway (modals still claim Esc first; the interim bug where Shell's handler fired navBack on every keydown — phantom letter navigation + run.js crash — was found via a CDP listener probe and fixed with a key guard + bubble-phase listener). (3) **Gateway rail = F5/F8/F9 only** (no Day Book chip — K is the keyboard path); **F2 = date/period** like TallyPrime: focuses the Day Book date input, inert on the Gateway. r53_ui.js rewritten to the new contract — **32/32** (global direct-fire P/F/X/G, global letter-uniqueness scan across headings + all four panes, Esc closes pane, Esc-origin both paths, F2 semantics both surfaces); r20 12/12 · r26 12/12 · r27 15/15 · run.js **153/153** fresh volume · final_regression **948/948** · smoke **39/39** · typecheck+build clean.


## v1.49.0 — R-51: browser-reserved shortcut keys → PWA/app-mode escape + docs (RELEASED 2026-09-23 — commit `48321d6ad67945457359605ad443ca2c8837c808`, annotated tag `5454190ac802440dd40b1a0e75d375ad40e66008`, pushed)

**Investigation (`R-51_INVESTIGATION.md`):** browsers process reserved chords (F5 reload, F6 address bar, F12 DevTools, Alt+1–9 Firefox tab-switch, Alt-letter menu access) in the browser process *before* the key event reaches the page — page JS cannot intercept them. zprime's hotkey layer itself is correct (capture-phase listener + preventDefault, live-probed; all page-reachable chords fire). The structural gap: no way out of browser-tab context. **Fix (approved Option A+C):** zprime now ships as an installable PWA — `client/public/manifest.json` (`display: "standalone"`, theme `#4f46e5`, 4 icons) + `icon.svg` + rasterized 192/512 any+maskable PNGs + `<link rel="manifest">`/theme-color/favicon/apple-touch-icon in `index.html`; Gateway Shortcuts card gained the app-window hint (additive paragraph, all existing label text intact); README gained the "Shortcut keys & the browser" section covering both the HTTPS/localhost **Install app** path and the plain-HTTP LAN-IP **Create shortcut… → Open as window** / `--app=` path (secure-context limitation verified live: `isSecureContext=false` on LAN IP → no install prompt there by browser rule, not a defect).

Verification: typecheck+build clean · manifest+icons served 200 with correct content-type and parsed JSON · install-surface probe (manifest linked, icons 200, beforeinstallprompt supported) · run.js **153/153 fresh volume** · final_regression **948/948** · smoke **39/39** · r46_drill 39 · r03 12 · r14 11 · r33 13 · r34 20.

## v1.48.0 — UI modernization "Calm Ledger" (RELEASED 2026-09-23 — commit `1c06874c17a47ebad3138e7a0b7c94c3d34d25e2`, annotated tag `488fb5b292b049dbeaefdc526027c78db07254be`, pushed)

Full UI redesign across all four approved phases, on one token layer (`client/src/index.css` `@theme`): **typography** — 14px body, 11px retired (12px floor), real heading scale with weight hierarchy, tracking-wide section labels; **spacing** — 8px rhythm (cards p-5/p-6, table cells px-3 py-2.5, form rows gap-4); **no clipped text** — hard truncation of meaningful content replaced by wrap (line-clamp-2 / minmax / [overflow-wrap:anywhere]); truncation now opt-in (`.cell-truncate`) for genuine meta only; **surfaces** — two-tier elevation (`.card` resting vs `shadow-raised` modals/menus), rounded-xl cards, visible focus rings on every interactive element; **layouts** — Shell sticky two-row chrome + floating fkey rail (40px targets, collapses <1024px), Gateway as card grid with the fkey-item row language, VoucherScreen sectioned (party/inventory/ledger/narration) with border-t-2 totals anchor and minmax label grids, Masters slide-over form p-6 gap-4 raised, CompanySettings IRP forms airy with indigo env toggles, import/cheque/payroll on the shared language.

Screens: index.css (tokens) · Shell · ui · Login · Companies · Reports · DayBook · AuditTrail · VoucherScreen · TypeAhead · MasterPage · Gateway · CompanySettings · PayrollProcess · ImportXml · ChequePrint. The ChequeFace print artifact (physical cheque leaf geometry) is intentionally untouched. **Zero logic changes** — no hotkey, form, navigation, API, or accounting surface modified; all suite-asserted label text preserved verbatim.

Verification on the final tree: typecheck server+client clean · build clean · Python **1230/1230** (final_regression 948, smoke 39, adversarial 88, bug-fix 65, reconciliation 61, attack-the-fixes 29) · browser **543/543** (run.js 153 on fresh volume + all 26 scenario suites green, incl. r46_drill 39, r35 23, r36 25) · screenshots at 1366×768 reviewed per phase (before/after in /tmp/p0, /tmp/p3).

## v1.47.0 — R-49 hotfix: new-voucher page blank on non-localhost hosts (RELEASED 2026-09-23 — commit `817d2c6334518ff97740cd85bc47e151df8a2338`, annotated tag `a48df138abcd656d78f34cd363a0c681bcbb93b9`, pushed)

**Live-reproduced operator report:** opening any **new voucher** screen via a LAN/IP or any non-`localhost` host rendered a **completely white page** — not even the app chrome. Root cause: `VoucherScreen` called `crypto.randomUUID()` directly in a `useRef` initializer (R-10 B-10 idempotency key). That API exists **only in secure contexts** (`https://` or `localhost`); on `http://<ip>:<port>` the call throws `TypeError: crypto.randomUUID is not a function` during the first render of the module tree, React never mounts, and the whole page dies. (It also reproduced on `localhost` in the probe because the page error surfaced before mount — the guard covers both.)

**The fix (client-only, one file):** safe key generation — `crypto.randomUUID()` when available → WebCrypto `getRandomValues` RFC-4122 v4 fallback → random-hex last resort. Still one stable key per new-voucher form (the R-10 replay contract is unchanged), edit saves still carry no key, and the server already treats an absent key as the documented legacy path (R-10 suite check 1). No server, schema, or accounting surface touched.

**Verification:** client typecheck clean · live re-probe in the exact failure context (fresh browser profile, hard `goto` to `/company/1/voucher/5/new` over `http://192.168.1.110:3000`) → full form renders (589 chars of content, Party A/c + LEDGER ENTRIES present), **zero page errors** (before the fix: body length 0 + the TypeError) · final_regression **948/948** · run.js **153/153** · r10_ui 10/10 · r33 13/13 · r34 20/20 · r35 23/23 · r36 25/25 · r43 12/12 · r44 11/11 · r46_drill 39/39.

## v1.46.0 — R-48 P4 polish batch: IRP/EWB refusal wording + runbook scope boundary (RELEASED 2026-09-23 — commit `cf7796956fb3cbc377c914f959a81baac1511d9e`, annotated tag `f749015319fb21abbbf7a7adf5c12cd702651539`, pushed)

The three actionable P4s recorded by the R-46 drill, cleared:

- **F-46-1 (server, one message):** the e-invoice refusal for a B2C buyer now **names the scope boundary and the alternative path** — `Buyer "X" is consumer/unregistered (B2C) — e-invoice covers B2B only; B2C e-way bills use the Direct EWB action (no IRN needed)` — instead of a bare "GSTIN missing" field list that sent operators hunting for data they cannot enter. Refusals with a genuinely missing GSTIN on a regular-type buyer keep the original actionable wording. No validation semantics changed: same 200/`ok:false` contract, same error array shape.
- **F-46-2 (runbook):** `ONBOARDING_IRP_EWB.md` now carries an explicit **payload scope boundary** note — the e-invoice payload is B2B, and the R-25 EWB-01 payload download is B2B-shaped; B2C e-way bills go through the **Direct EWB** action (`generate-direct`), which is also the only B2C path once credentials are installed.
- **F-46-4 (runbook, no code):** the EWB-API's no-default-endpoint posture documented as deliberate (a wrong-host EWB submit is a real compliance event; zprime refuses to guess even a sandbox host).
- **F-46-3 (no-op):** masked credential rows omitting `id` is correct by design — delete keys on `environment`; nothing changed.

**Tests strengthened (never weakened):** final_regression's B2C-rejection check now asserts the new scope-naming wording (was: any-error-contains-GSTIN); r46_drill gains a 39th check asserting the same on the live journey. **Verification:** server typecheck clean · final_regression **948/948** · r46_drill **39/39** · r28 15/15 · r30 17/17 · r31 15/15 · smoke 39/39 · reconciliation 61/61 (independent).

## v1.45.0 — R-47 IRP/EWB drill promoted to permanent suite (RELEASED 2026-09-23 — commit `d34f22a8c2226047c17f6fd8e3ae01055d67fd25`, annotated tag `f6e5d87e5d8f67724e28f5c1e1924a9f6df4416e`, pushed)

The R-46 live drill (39/39, closed as evidence) is now a permanent member of the acceptance estate: **`scripts/acceptance/r46_drill.js`, 38 sequential checks**. Unlike the per-feature connectivity suites (r28/r30/r31), it runs the **full operator journey in order** — the estate's only sequential connectivity regression:

- Self-spawned wire-faithful mock-irp sidecar with fault-injection controls; skips cleanly when the sidecar is already running (same convention as r30/r31)
- Journey: no-credential fail-fast (payload 422 before credential checks) → credential lifecycle (empty-secret retype rule, AES-256-GCM at rest, `*Last4` masking, owner-gating) → e-invoice accept / duplicate 409 without network / fault-injected 502 verbatim / fix-and-retry → EWB lifecycle via eivital (GENEWB → VEHEWB → EXTENDVALIDITY → eager second-extension refusal → CANEBW within 24h → slot re-open) → direct EWB via ewayapi for B2C → non-member submit 404
- Encodes the discovered data contract: `taxability: "taxable"` on the sales ledger + the seeded `dutyHead='IGST'` ledger — without them `voucherGst` classifies zero and payload validation honestly refuses
- Idempotent re-runs (company/master reuse through unique-index 409 paths); verified no port/DB interference with r30/r31

**Verification:** r46_drill **38/38 twice consecutively** · r30/r31 green after the run · no application code touched (test-only release, R-11/R-39 precedent).

## v1.44.0 — R-45 whole-product re-review: v1.43.0 re-certified on fresh evidence (RELEASED 2026-09-23 — SHAs recorded in RELEASES.md, pushed)

Full-battery re-run on a **rebuilt image from the exact v1.43.0 release tree with a fresh database volume**: browser estate **517/517** (run.js 153/153 + all 26 scenario suites), Python estate **1229/1229** (smoke 39 · adversarial 88 · fix-regression 65 · reconciliation 61 · final-regression 947 · attack-the-fixes 29), fresh install **16/16 migrations / 27 tables** from zero, reconciliation engine independence re-verified (engine.py imports only `json` + `datetime`). Third consecutive re-certification of the R-41 PRODUCTION READY verdict (v1.39.0 → R-42 operator drill → v1.43.0).

- **Finding caught during the sweep:** r21/r36 browser fixtures POST units (`Nos/Nos`, `Pieces/pcs`) that v1.43.0 now seeds → unique index 409 → `unitId: undefined` → dependent item POST cascade failure. NOT A BUG — VERIFIED: the API contract is behaving exactly as designed (same fixture interaction already fixed for four Python suites in R-44). Fix: both fixtures reuse the seeded unit on 409 — fixtures only, no assertions weakened.
- **Evidence:** `R-45_REVIEW.md` (gate table, forensics trail, fresh-install proof, engine-independence check).

## v1.43.0 — R-44 F-42-2 starter inventory masters: fresh companies can post inventory immediately (RELEASED 2026-09-22 — commit `a3f162c478d9e13a2162750b8d6a728d2cdc51f9`, annotated tag `6f1b27631aadac1c50c465b4cc1362fd1b9ef23a`, pushed)

R-42's P4 operator finding (F-42-2) is closed at the seed layer: `seedCompanyTx` now also seeds **units `Nos` + `Pieces`** and **godown `Main`** inside the same transaction that creates the company, seeds reserved groups/voucher types, and grants the owner membership (R-03 atomicity preserved — a failed seed aborts the whole creation). Since `stockItems.unitId` is NOT NULL, the first inventoried item on a fresh company was previously unsaveable until a unit was created by hand (live-reproduced in the R-42 drill); it now saves immediately.

- **Design (approved Option A):** no migration, no schema change, no API surface, no frontend change; no backfill of existing companies; the seeds are ordinary masters (units/godowns carry no reserved flag) — alterable/deletable via the Masters pages; idempotent per company via the existing unique `(company_id, symbol)` / `(company_id, name)` indexes.
- **Test adjustments (fixtures only — no assertions weakened):** four Python suites + run.js created a unit with the now-seeded symbol/name and asserted the POST result; the POST now 409s on the unique index, so each fixture reuses the seeded unit (final_regression R06/R07, smoke, attack, reconcile) or tolerates the duplicate (run.js Pieces). The negative-stock guard still fires exactly as before — run.js's Meridian opt-in path unchanged.
- **Tests:** new `r44_ui.js` — 11 checks: seeds present server-side + on the Units/Godowns pages before any operator action, first stock item saved with the seeded unit (zero setup), seeded godown deletable + re-creatable via the UI, purchase→sales round-trip through the seeded unit (also re-proving the R-06 rejection selling from zero is a fixture-data matter, not a code path).

Full investigation: `R-44_INVESTIGATION.md`.

## v1.42.0 — R-43 F-42-1 hydration guard: no false quick-create while options load (RELEASED 2026-09-22 — commit `03e4d351e6c1013456bb7c8d1fd25e2f4a193062`, annotated tag `817f60359de6d8665f9e99bb5c6bdfe163042866`, pushed)

R-42's P3 operator finding (F-42-1) is now fixed at the UI layer: while a freshly mounted voucher screen's ledger options are on their **initial fetch** (no data yet), the TypeAhead no longer treats an empty list as "nothing matches" — the create row and the Enter→quick-create path are suppressed and a non-interactive "Loading options…" hint shows instead. After the options hydrate, R-35 behavior is byte-identical (`typeahead-create` row, Enter opens the modal prefilled, creation picks the ledger into the triggering field). Cached mounts never see the guard (`isLoading` is true only while data is undefined).

- **Implementation:** `TypeAhead` gains an optional `loading` prop (default-off — every other consumer unaffected); `VoucherScreen` passes the initial-load flags of the two options queries to the create-capable pickers (party + entry rows; the item picker has no create path).
- **Tests:** new `r43_ui.js` — 12 checks: delayed-route hydration window (existing name → no create row, Loading hint, Enter does NOT open the modal), after-load matching restored, full R-35 create contract, warm-cache mount shows no guard, round-trip save to Day Book, zero page errors. r35 23/23 and run.js 153/153 re-run green on the rebuilt image.

Full investigation: `R-42_INVESTIGATION.md` §F-42-1.

## v1.41.0 — R-42 real-operator drill: first-boot operator notes documented (RELEASED 2026-09-22 — commit `801ba49adfb36056f0934d0cb462a0632446b140`, annotated tag `3da7d97db7b4854722ec362101af17144b7a2c56`, pushed)

R-42 walked the whole product as a first-time operator on a fresh disposable stack — real API (33/33 journey steps green) and real browser (Gateway → masters → keyboard voucher entry → error paths → reports → cancel/uncancel). **Verdict: NO P1/P2 DEFECT.** Error messages are operator-grade (unbalanced shows the difference; oversell names the remedy; duplicate bill advises Auto-numbering); TB balances to the paisa; quick-create (Tally Alt+C analogue) works mid-voucher.

- **F-42-1 (P3, NOT A BUG — VERIFIED):** during a freshly mounted voucher screen's pick-list hydration window, Enter can take the quick-create path even for an existing ledger name. Recoverable via Esc; server unique constraints prevent duplicates; no data risk. Recorded as a known behavior, no code change.
- **F-42-2 (P4, by design):** fresh companies seed accounting ledgers only — units and godowns are created on demand (Tally parity). Now stated in the README so first-time operators aren't surprised.
- **Implementation:** README "Notes & limits" + PROJECT.md UI-philosophy notes + `R-42_INVESTIGATION.md` committed + ledger docs. **Zero production diff** — the 1229/494 estate stands unchanged (R-11/R-39/R-40 precedent).

Full report: `R-42_INVESTIGATION.md`.

## v1.40.0 — R-41 whole-product re-review: PRODUCTION READY adopted (RELEASED 2026-09-22 — commit `6552b4f17a3333ddfddf6fcbe79a7c9919257970`, annotated tag `d493d1144326024b3d7d2d6199a4946b06e2cc78`, pushed)

R-41 re-certified the entire product at v1.39.0 with fresh evidence — supersedes the v1.16.0 **RELEASE CANDIDATE** verdict (29 release commits / +42,740 lines ago: RCM, GSTR-9, TCS, IRP/EWB connectivity, audit trail, the keyboard arc, ledger-on-the-fly, per-payee TDS/TCS, backup/restore depth).

- **Fresh verification (all run during the review, on v1.39.0):** Python **1229/1229** (smoke 39 · adversarial 88 · bug-fix 65 · reconciliation 61 · final regression 947 · attack-the-fixes 29) · browser **494/494** on a rebuilt image + verified-fresh volume (run.js 153 + r03…r38 scenario suites, zero failures) · fresh install 16/16 migrations, 27 public tables from zero, app healthy · independent reconciliation 61/61 · typechecks clean.
- **Security sweep:** all 64 routes mapped per file with cid()/requireOwner coverage confirmed; zero client-identity trust (`body.companyId`/`query.companyId`/`body.userId` — no hits); all 19 service-layer company reads scoped by the already-authorized cid; IRP/EWB credentials AES-256-GCM with fail-fast key enforcement; adversarial + attack-the-fixes suites green.
- **Integrity sweep:** accounting invariants held across every postings-affecting release since v1.15 (TB/BS/P&L/stock/GST); 16 additive-only migrations — no DROP/TRUNCATE/DELETE anywhere; backup/restore content-guarded (R-39); ledger docs coherent.
- **Verdict:** **PRODUCTION READY** (designed model: self-hosted, single operator/small trusted team). The one open finding from v1.15 (F-R1 first-boot race) closed in R-16; the estate more than doubled since v1.16 (868→1229 Python, 219→494 browser); all candidate lists dispositioned (R-40); ops hardened (self-healing, backup runbook + restore drill, credential encryption). Known accepted limitations unchanged: in-memory limiter state, 7-day JWT, no 2FA/SSO, GST reports as management summaries, audit trail covers vouchers only.
- **Implementation:** STATE.md product-status line + this ledger + ROADMAP phase + CONTINUE.md. **Zero production diff** — the 1229/494 estate stands unchanged (R-11/R-39/R-40 precedent).

Full report: `R-41_REVIEW.md`.

## v1.39.0 — R-40 docs hygiene (RELEASED)

R-40 was an investigation-only cycle: the selected candidate ("import pre-validation UI") verified **ALREADY SHIPPED as R-21 (v1.20.0)** — live-verified on v1.38.0 (server `?dryRun=1` identical-transaction path, client Validate button + nothing-imported banner, 10 Python + 13 browser checks green). The R-04-derived hardening list is fully dispositioned.

The implementation is therefore **docs hygiene only** — ROADMAP.md: the phase line was ten releases stale ("R-34 released (v1.33.0)") and is now current; the candidates region marks B-12 + the two R-21 items + INV probes as dispositioned (with the verification evidence); three leftover "later" rows duplicating already-marked ✅ DONE R-09/R-10/R-11 removed. No code, no tests, no schema. Zero production diff — the 1229/494 estate stands unchanged.

## v1.38.0 — R-39 backup/restore close-out (RELEASED)

R-39 closes B-12 properly: the action plan's "backup/restore MISSING" claim was verified **outdated** (README runbook + R-12 round-trip guard shipped in v1.14.0), so the remaining work is verification depth + ops guidance — **test/docs only, zero production code**.

- **Content equality (final_regression.py R-12 block, +11 checks):** the restore round-trip now hash-compares row-for-row content of the postings-bearing tables (`vouchers`, `voucher_entries`, `ledgers`, `bill_allocations`, `inventory_entries`, `stock_items`, `payslips`, `pay_heads`, `companies`, `user_companies`, `users`) between live and restored databases — order-independent md5 over sorted `row_to_json` texts. Row counts matching while values are corrupted no longer passes.
- **Schema fingerprint (+1 check):** the restored schema must dump byte-identically to the live one (pg_dump 16's random `\restrict`/`\unrestrict` token lines normalized away). Catches constraint/extension/ownership drift that content hashes cannot see.
- **README §Data & backups:** cron scheduling example (daily dump, 14-day retention, copy-off-host warning) and a restore-drill paragraph with the exact scratch-database drill commands — "a backup that has never been restored is a hope, not a backup."
- Verification: Python **1229/1229** (final regression **947** incl. the 12 new R-39 checks), typechecks clean; browser estate unchanged at **494/494** (zero client/server files touched — R-11 precedent).

## v1.37.0 — R-38 payee-threshold report UI (RELEASED)

R-38 implements the approved Option A scope (R-37's deferred Option B): the per-payee FY threshold data shipped in v1.36.0 is now **visible on the TDS and TCS report pages**. Pure client addition — no server file, no schema, no accounting surface.

- **`FyPayeeThresholdCard` (Reports.tsx):** a "FY Threshold Status (per payee)" card rendered by both `TdsView` and `TcsView`, driven entirely by the `fyAggregates` the report payloads already carry — one block per section, one row per payee (Payee · PAN · This FY · Largest single · Status).
- **Status math mirrors the server exactly:** aggregate mode compares the payee FY base, single mode the payee's largest single payment; near = the 80% band. OVER carries the amber-strong styling from the R-33 advisory-strip family; the section header shows threshold/mode/FY-to-date; PAN reads "on file"/"not recorded" honestly.
- **The sum never masquerades:** when a section has multiple payees, a rollup line states `Section total ₹X across payees — the statutory threshold binds per payee, not on this sum`. No-threshold sections show the honest "confirm applicability manually" wording. Footer: "nothing is withheld or blocked; TDS/TCS judgment remains the operator's" (A-04 posture, stated in the product).
- **En-route fix (test-side):** the first cut had the wrapper `div` structure miscounted in TdsView/TcsView (JSX imbalance caught immediately by typecheck); locators that matched an ancestor `div` were rewritten to read the Card via its unique header's parent.
- **Tests:** new `scripts/acceptance/r38_ui.js` (**14** checks, real report pages): card renders on both pages; two-payee 194J fixture shows near (₹40k of ₹50k) and OVER (₹72k) statuses with correct PAN honesty; rollup + footer + threshold figures present; OVER badge carries the amber-strong class; TCS page shows the collection wording with honest empty state.
- **Verification (final tree):** typecheck server + client clean; Python **1222/1222** (smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression 935, attack-the-fixes 29); browser **494/494** on a rebuilt image + verified-fresh volume, every suite exactly once (run.js 153 + r03…r38 = 341 scenario checks, r38 14/14); `git diff --check` clean.

## v1.36.0 — R-37 per-payee FY TDS/TCS aggregates (RELEASED)

> Commit `740d0160c883242da7fbd77c7b26183c54075c12` · annotated tag `1926296c050a745b1491c355de29f4068c7a6a42` · pushed 2026-09-21.

R-37 implements the approved Option A scope (R-33's deferred Option C): the threshold advisory now measures the **statutory unit — per payee per FY** — instead of the per-section cross-payee sum. Read-only advisory data; nothing blocks; no schema, no migration, no accounting-math change.

- **`payees[]` in every section aggregate (`tdsTcsFyAggregates`):** the same postings query gains `ledgerId` and nests a per-ledger (payee) map under each section — `{ ledgerId, ledgerName, hasPan (GSTIN chars 3–12 present), fyAmount, maxSingle, count }`, sorted by amount. The payee grain is the ledger (zprime's ledger master IS the payee master; a payee spread over several ledgers reports per ledger — documented). Section totals remain the rollup across payees — shape-compatible with every existing consumer.
- **Per-payee over/near + wording (threshold-check):** each payee is evaluated individually against the threshold (aggregate mode: payee FY base; single mode: payee's largest single payment). Over wording names the payee: `Payee "X" (194J): ₹72,000 this FY (threshold ₹50,000) — TDS/TCS due on further payments`. Payees without GSTIN carry an honest `PAN/GSTIN not recorded for this payee; verify before remitting` note when over — never a guess. The section rollup keeps its own wording, now labeled **"across payees"** so the per-section sum can never masquerade as the per-payee truth.
- **The false-positive is gone:** ₹40k to Architect A + ₹40k to Consultant B under 194J now reads per-payee truth (neither over, both near at 80%) where the section sum read "₹80,000 — TDS due". Conversely, one payee crossing (₹72k) reads over **naming that payee** while the other stays not-over — the actionable question ("to whom do I owe TDS from the next payment?") is now answerable.
- **TDS/TCS reports:** `fyAggregates` carry the new `payees[]` arrays — additive, no shape break; cancel-exclusion and A-04 remittance-exclusion carry over verbatim (same query).
- **Tests:** `final_regression.py` +20 R-37 checks (**935**): two-payee-under-threshold per-payee truth (over=false, near=true at 80%, hasPan true/false by GSTIN presence), section rollup preserved at ₹80,000 with "across payees" label, one-payee-over isolation with payee-naming wording, TDS-report fixture sanity, non-member 404 on the enriched surface, TB still balances; all 22 R-33 checks unchanged and green; r33_ui 13/13 (wording-substring contract survived).
- **Verification (final tree):** typecheck server + client clean; Python **1222/1222** (smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression **935** incl. 22 R-33 + 20 R-37, attack-the-fixes 29); browser **480/480** on a rebuilt image + verified-fresh volume, every suite exactly once (run.js 153 + r03…r36 = 327 scenario checks); `git diff --check` clean.

## v1.35.0 — R-36 arrow-key grid navigation (RELEASED)

> Commit `dc758aa19994ee6de4af554a749d82dee6b13f80` · annotated tag `deb1e003e63a5c9c3b0a826c32f99afc245e7897` · pushed 2026-09-21.

R-36 implements the approved Option A scope (D-4, the last R-34 deferral): **the voucher grid moves like a spreadsheet** — ArrowDown/ArrowUp navigate the same column across rows in the entries and inventory grids, real Tally-parity keyboard flow. Client-only: no server file, no schema, no migration, no accounting-math change.

- **Same-column arrow navigation (VoucherScreen):** a tbody-level handler moves focus to the input with the same `data-col` in the next/previous row — `ledger`/`bill`/`dr`/`cr` on the entries grid, `item`/`qty`/`rate` on the inventory grid. Numeric cells select their content on arrival (type-to-replace). Disabled inputs (the non-bill-wise bill cell) and selects (godown, kind) carry no `data-col` and are skipped by construction. The Total strip row ends the walk.
- **TypeAhead ownership rule:** arrows own the dropdown highlight **only when matches are open** (`stopPropagation` in that branch only); with zero matches the keys bubble to the grid. Enter semantics untouched — including R-35's Enter-on-zero-matches quick-create.
- **Advertised affordances preserved:** Enter on the last amount row still adds a row (the hint text); ArrowDown on the last row does **not** add one; modifier chords (Alt/Ctrl/Shift/meta + arrow) are explicit grid no-ops; Left/Right remain caret keys.
- **Tests:** new `scripts/acceptance/r36_ui.js` (**25** checks, real key presses): same-column Down/Up across three rows on Dr and ledger columns; disabled-bill skip; last-row Down-doesn't-add vs Enter-adds anchor; modifier no-ops; dropdown-open vs dropdown-closed arrow ownership; inventory-grid same-column qty navigation and never-select targeting; same-column invariant (Up from Dr returns to Dr, never sideways); end-to-end arrow-first voucher save.
- **En-route test corrections (app correct throughout):** a ledger cell holding matching text legitimately reopens the dropdown on focus (arrows belong to the TypeAhead there — tests clear the cell first); the same-column invariant assertion was written sideways once and corrected to the approved semantics.
- **Verification (final tree):** typecheck server + client clean; Python **1197/1197** (smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression 915, attack-the-fixes 29); browser **480/480** on a rebuilt image + verified-fresh volume, every suite exactly once (run.js 153 + r03…r36 scenarios = 327, r36 25/25); `git diff --check` clean.

## v1.34.0 — R-35 ledger-on-the-fly (RELEASED)

> Commit `d3ecfc6bfd026eaddfb1bad1e8fdd6eed1198a2e` · annotated tag `fcd69c68744a2b3d4f6e6d594a265ace5cd39ec5` · pushed 2026-09-21.

R-35 implements the approved Option A scope: Tally's most-loved data-entry affordance — **Alt+C mid-voucher ledger creation without losing the half-entered voucher**. Client-only: no server file, no schema, no migration, no accounting-math change (`POST /c/:cid/ledgers` was already cid-gated, Zod-validated, R-08 ref-checked, 409-honest).

- **Alt+C chord + F-key chip (VoucherScreen):** opens the quick-create modal prefilled with the focused cell's typed text (entry row or Party A/c); disabled on cancelled vouchers.
- **Quick-create modal:** Name* / Under Group* (from `GET /groups`, shared cache) / Taxability (default none) / GST Rate % (optional) — the Tally-honest split: entry-ready masters here, GSTIN/bill-wise/TDS-sections on the masters page (hint says so).
- **Pick-in on success:** the created ledger is picked into the triggering row — entry row or Party A/c (with the party row auto-inserted at grid top) — and focus returns to the triggering cell. Entries, amounts, date, number, narration all survive.
- **Keyboard layering:** while the modal is open, Esc closes ONLY the modal and Ctrl+A / Enter accept the modal; closed, the original voucher semantics apply unchanged.
- **TypeAhead discoverability:** with zero matches and typed text, the dropdown offers `＋ Create "<text>"` (renders only on zero matches — existing commit behavior untouched); Enter on zero matches opens the modal instead of silently discarding the text.
- **Errors surface verbatim:** duplicate name → the server's 409 wording; missing group → honest client validation; the voucher behind is never disturbed.
- **Tests:** new `scripts/acceptance/r35_ui.js` (**23** checks, real key presses): Alt+C prefilled from entry + party cells; state survival behind the modal; Esc-only-modal; Ctrl+A and Enter acceptance; 409 verbatim + voucher untouched; `＋ Create` row; both end-to-end round-trips (Payment with the quick-created ledger, Sale to the quick-created party with Apply-GST both halves); honest missing-group validation.
- **En-route fix (found by the suite):** on modal close, focus returns to the triggering cell (Tally behavior) — without it focus dropped to `<body>` and the next Alt+C lost the typed prefill.
- **Verification (final tree):** typecheck server + client clean; Python **1197/1197** (smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression 915, attack-the-fixes 29); browser **440/440** on a rebuilt image + verified-fresh volume, every suite exactly once (run.js 153 + r03…r35 scenarios = 287, r35 23/23); `git diff --check` clean.

## v1.33.0 — R-34 keyboard integrity (RELEASED)

R-34 implements the approved Option A scope: the keyboard-first contract is now real — **every advertised key fires, and the Day Book drill-down works**. Client-only: no server file, no schema, no migration, no accounting-math change.

- **D-1 — Alt+G / Alt+T wired (VoucherScreen):** the F-key panel chips carried no `onClick` and the hotkey map had no entries — both were dead. Now the chips fire and the chords (`Alt+G` Apply GST on Sales/Purchase/Credit Note/Debit Note, `Alt+T` Deduct TDS on Accounting vouchers) fire with the same guards as the chips.
- **D-2 — six Day Book chords wired:** Alt+F5 Debit Note, Alt+F6 Credit Note, Alt+F7 Stock Journal, Alt+F8 Delivery Note, Alt+F9 Receipt Note, Ctrl+F7 Physical Stock — printed in the panel since v1.0 but never registered in the hotkey map; the browser driver had documented the gap as an "App quirk" and clicked buttons instead. The quirk is fixed and the workaround deleted — suites press real keys.
- **D-3 — Day Book row drill-down:** rows carried the `row-link` affordance (cursor + hover) with no handler. Row click now opens the voucher editor (matching the established report drill-down target); Alter/Cancel/Del/Uncancel got `e.stopPropagation()` so row actions never navigate.
- **F-34-1 (found during implementation) — intrastate Apply-GST now posts BOTH halves:** `applyGst` looked up the SGST duty ledger by `dutyHead === "SGST/UTGST"`, but the seeded ledger's duty head is `"SGST"` (the *name* is "SGST/UTGST") — the match silently failed since v1.0, so Apply-GST inserted only the CGST half (the party-row rebalance hid the imbalance). One-line fix: `dutyOf("SGST")`. The run.js probe now asserts both halves at ₹900 + ₹900 on the ₹10,000 @18% base; the new r34 suite asserts both halves through the keyboard chord.
- **Tests:** new `scripts/acceptance/r34_ui.js` (**20** checks, real key presses): all six chords open their voucher types; aside chips fire; Alt+G/Alt+T chords fire; intrastate GST posts both halves; Alter link, bare row click, and Del-without-navigation on the Day Book. Driver `CLICK_OPEN` workaround deleted; `OPEN_KEY` Physical Stock → `Control+F7` (Playwright key name — previously masked by the workaround); run.js `ux/apply-gst-base` strengthened to both-halves semantics.
- **Verification (final tree):** typecheck server + client clean; Python **1197/1197** (smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression 915, attack-the-fixes 29); browser **432/432** on a rebuilt image + verified-fresh volume, every suite exactly once (run.js 153 + r03…r34 scenarios = 279, r34 20/20); `git diff --check` clean.

## v1.32.0 — R-33 TDS/TCS threshold advisories (RELEASED)

> Commit `ec8b1301bff6de36e83752ef1d76d68d33eaf58e` · annotated tag `45bdec62a8317e72150b6628c009f8e7fb46c503` · pushed 2026-09-21.

R-33 implements the approved Option A scope: honest, non-blocking threshold **advisories** — the operator judges, the books record, and now the app *tells*. Advisory data becomes actionable. No voucher is ever blocked; no posting math changes; no behavior change for operators who ignore the feature.

- **Migration `0015_r33_threshold_mode.sql`** (additive): `threshold_mode` (text, `'aggregate'` default, `'single'` allowed) on `tds_sections` + `tcs_sections` — the schema (NOT the app) now encodes the legal distinction between FY-aggregate thresholds (194J: ₹50k of *payments* this FY) and per-payment thresholds (194C: ₹30k on a single payment). Snapshot idx 15.
- **New read-only endpoint `GET /reports/tds-threshold-check?dutyHead=TDS|TCS`** — cid-gated, per-section: FY **payment base** (the legal threshold unit — expense debits for TDS, party credits for TCS, duty credits excluded, remittances excluded, cancelled excluded), `maxSingle` for single-mode comparison, and mode/over/near-aware wording. `threshold=0` never triggers — "no threshold recorded — confirm applicability manually", never a guess.
- **TDS + TCS reports gain `fyAggregates[]`** — the per-section FY aggregates ride the reports operators already use.
- **VoucherScreen: amber ⚠ advisory strip** — fires on **Deduct TDS** / **Collect TCS**; shows only over/near wordings; **saves normally through it** (non-blocking, silent-degrade on fetch failure); sections with no threshold never appear. A-04 note: the base is payment-base, not the duty credited — ₹72,000 of professional fees vs the ₹50,000 threshold, not ₹7,200 of TDS.
- **Masters UI:** threshold mode selector on TDS/TCS section editors.
- **Tests:** `final_regression.py` +22 R-33 checks (**915**) — mode schema honesty (bogus mode 400), below/over posting (nothing blocked), base-semantics aggregates (20,000 → 72,000), over/aggregate wording, single-mode wording, TCS-head reachability, reports carry `fyAggregates`, non-member 404, cancel exclusion (A-04), TB still balances; new `scripts/acceptance/r33_ui.js` (**13** checks) driving the advisory through the real UI (amber strip on Deduct TDS with the FY figure + "TDS/TCS due" wording, save-through, honest 194I absence, helper still computes the ₹800 duty line without a threshold).
- **Verification (final tree):** Python **1197/1197** (smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression **915** incl. 22 R-33, attack-the-fixes 29); browser **399/399** on a rebuilt image + verified-fresh volume, every suite exactly once (run.js 153/153 + r03…r33 = 246 scenario checks, r33 13/13); typecheck server + client clean; `git diff --check` clean. Full Python battery re-run green on the exact tree committed.

## v1.31.0 — R-32 IRP/EWB production onboarding runbook (RELEASED)

> Commit `88e89d25bfaea19ec14e5f405b90be0656ee8114` · annotated tag `0fb9709ea2af0e5a4867aff2f469404ac7d2ba71` · pushed 2026-09-20.

R-32 implements the approved Option A scope: the operator-facing path to production connectivity. No schema change, no server code change, no accounting surface — docs-first with one honest client help note.

- **New `ONBOARDING_IRP_EWB.md`** — the full runbook: prerequisites (portal API access for the IRP and the separate EWB system; per-portal credentials; public-key sourcing with the PEM conversion command; `IRP_ENC_KEY` generation + boot fail-fast + disaster-recovery warning), the host table (sandbox IRP built-in default; production IRP and the EWB-API always from the operator's IRP/GSP via the endpoint override), per-environment Company Settings setup (masked read-back + retype rule), an 8-step sandbox first-submit walkthrough (e-invoice → IRN → ewb-gen → direct B2C EWB → veh/ext/can lifecycle), the NIC error-code decode table (3001/3011/4002 validation, 3095 duplicate-hour, 3105 cancel-window, 3120 extend-once, 382 expiry, transport failures), credential rotation/revocation, and where the legal records live.
- **README** gains an "e-Invoice & e-Way Bill connectivity (optional)" pointer section (≤10 lines, links the runbook).
- **PROJECT.md truth-pass** to v1.30.0 reality: GST section now documents CDNR/CDNUR (R-05), RCM (R-23), GSTR-9 (R-26); new **Connectivity** section (R-24…R-31: stateless payloads, live submission, direct B2C EWBs, lifecycle with birth-path routing, records, mock); Payroll & TDS section gains TCS (R-27); Reports list gains the R-14/R-18/R-20/R-23 additions; XML import updated to the R-04 resolved state; scope boundaries corrected (e-invoice/EWB/GSTR-9/audit moved from OUT OF SCOPE to IMPLEMENTED; genuine gaps listed); verification counts updated to 1171 + 386.
- **CompanySettings** connectivity card gains a compact host-facts help note (sandbox IRP default; production IRP + EWB-API from the override; runbook pointer) — text only, no behavior change.
- **Tests:** `final_regression.py` +4 R-32 grounding checks (**893**) — the runbook exists and names both portals + the sandbox host + `IRP_ENC_KEY` as DR-relevant; README carries the runbook pointer. File-level, no server round-trips.
- **Verification (final tree):** Python **1175/1175** (smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression **893** incl. 4 R-32, attack-the-fixes 29); browser **386/386** on a rebuilt image + fresh volume (run.js 153/153 + r03…r31 = 233 scenario checks — the settings text change disturbs no locators); typecheck server + client clean; `git diff --check` clean.

## v1.30.0 — R-31 EWB lifecycle birth-path routing (RELEASED)

> Commit `7d916e4d63303ee266ba6d7e3ddf818ec878de1a` · annotated tag `9b31910a0b2926981f04c9b9c3eacf22c86aa45b` · pushed 2026-09-20.

R-31 implements the approved Option A scope: lifecycle ops (vehicle update / validity extension / cancellation) now address the NIC system the EWB was **born** on — IRN-born EWBs ride the e-invoice system (eivital v1.10), direct-born EWBs (R-30, B2C) ride the EWB-API (v1.03). Closes R-30's one documented limitation; no migration, no schema change, no accounting surface, no UI change.

- **Server (`services/irp.ts`):** `EwbBirthPath` + `ewbBirthPath()` — the discriminator is the accepted row's verbatim response casing stored at birth (`ewayBillNo` → ewayapi, `EwbNo` → eivital; fallback eivital keeps every pre-R-30 row byte-for-byte). `ewbLifecycleWire()` routes each op through `ewbAction` (`/v1.03/ewayapi`, action-dispatched, EWB-pair credentials via the R-30 session cache) or `irpAction` (the v1.10 op URLs) — all eager guards, the ops ledger, idempotency, and error mapping unchanged.
- **Test infra:** mock `/v1.03/ewayapi` speaks `VEHEWB`/`EXTENDVALIDITY`/`CANEWB` (lowercase envelope, same once-ever and 24-h-window rules) and exposes per-system counters (`ewbVehCalls`/`ewbExtendCalls`/`ewbCancelCalls`) so the suites **prove the routing**, not just the happy path.
- **Tests:** `final_regression.py` +21 R-31 checks (**889**) — per-path routing proof for vehicle and extension, eager once-ever guard with zero wire calls on the v1.03 path, verbatim NIC 24-h-window rejection leaving the submission untouched, legal cancel + ops-ledger rows + rebirth, non-member 404, TB-still-balances; new `scripts/acceptance/r31_ui.js` (**15** checks) proving through the real UI that IRN-born (B2B) and direct-born (B2C) rows are lifecycle-identical: actions, banners, cancel, birth re-opening.
- **Verification (final tree):** Python **1171/1171** (smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression **889** incl. 21 R-31, attack-the-fixes 29); browser **386/386** on a rebuilt image + fresh volume, every suite exactly once (run.js 153/153 + r03…r31 = 233 scenario checks, r31 15/15); typecheck server + client clean; `git diff --check` clean.

## v1.29.0 — R-30 direct e-way bills (non-IRN, B2C)

R-30 implements the approved Option B scope: **direct** GENEWB via the NIC EWB-API (a separate portal with its own credentials) for EWB-eligible-but-not-IRN-eligible vouchers — the B2C invoice, where Rule 138 requires an e-way bill for consignments above ₹50,000 but no e-invoice can exist. One additive migration; no accounting-math change; GENIRN/GENEWB-from-IRN paths byte-unchanged.

- **Migration `0014_r30_ewb_direct.sql`** (additive): `ewb_username`/`ewb_password_enc` (nullable) on `irp_credentials` — NULL = EWB-from-IRN only (B2B), the pre-R-30 behavior exactly; EWB secrets use the same AES-256-GCM at-rest encryption. Snapshot idx 14.
- **Server:** `services/ewaybill.ts` `ewaybillDirectPayload()` — NIC v1.03 shape (DD/MM/YYYY dates, address/pincode blocks, item schema with head-split rates: inter-state IGST, intra-state CGST+SGST at half the headline rate), buyer GSTIN legitimately optional, honest all-at-once refusals for missing buyer/seller address+pincode+state; Sales vouchers only. `services/irp.ts` — EWB-portal session (AUTHTOK/SEK, own cache namespace, tolerant v1.03 casing) + `generateEwbDirect()`: friendly boundary (a voucher with a registered IRN is told to use ewb-gen), the shared `(voucher, kind='ewaybill')` idempotency makes double-birth structurally impossible, verbatim rejected/error rows. Route `POST /reports/ewaybill/:voucherId/generate-direct` — cid-gated, honest 422/400/409/502. Credentials PUT/GET extended: EWB pair rule (both or neither; omitted pair = stored pair untouched), masked last-4 read-back.
- **Client:** CompanySettings **EWB portal (direct e-way bills, B2C)** section (username + password, masked); GSTR-1 **B2C** rows carry a direct **ewb** birth action (optional vehicle prompt) and, once born, the same **veh/ext/can** lifecycle actions as B2B rows — `gstr1()` B2C rows now surface the accepted `ewbNo` (report-only join).
- **Test infra:** mock speaks `/v1.03/auth` + `/v1.03/ewayapi` GENEWB (lowercase envelope, `__failaction`-aware, born EWBs registered for lifecycle ops) under the same self-keyed sidecar.
- **Tests:** `final_regression.py` +32 R-30 checks (**868**) — missing-creds 400 with zero wire calls, pair rule, masked read-back, happy path, duplicate 409 with zero wire calls, non-Sales/buyer-gap/seller-gap 422s, IRN boundary, lifecycle interplay on direct-born EWBs, cancel/rebirth, portal rejection verbatim, non-member 404s, TB-still-balances; new `scripts/acceptance/r30_ui.js` (**17** checks) driving settings + the full birth/lifecycle cycle through the real UI.
- **Verification (final tree):** Python **1150/1150** (smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression **868** incl. 32 R-30, attack-the-fixes 29); browser **371/371** on a rebuilt image + fresh volume, every suite exactly once (run.js 153/153 + r03…r30 = 218 scenario checks, r30 17/17); typecheck server + client clean; `git diff --check` clean.
- **Documented limitation:** the endpoint override is shared between the IRP and EWB-API paths (the mock serves both URL families; production hosts differ), and lifecycle ops for direct-born EWBs ride the R-29 routes — verified against the mock; production EWB-API lifecycle variants belong to the next connectivity increment.
- **Release:** commit `da9e2c4` — `Release v1.29.0: direct e-way bills (non-IRN, B2C)`, annotated tag `v1.29.0` (tag object `065c605`), pushed to origin 2026-09-20.

## v1.28.0 — R-29 EWB lifecycle ops (vehicle / extend / cancel)

R-29 implements the approved Option A scope: the three NIC lifecycle actions on an accepted e-way bill, completing the loop R-28 opened. One additive migration; no accounting-math change; GENIRN/GENEWB paths byte-unchanged.

- **Migration `0013_r29_ewb_ops.sql`** (additive): `irp_ewb_ops` — verbatim per-op ledger (company/voucher/accepted-row/actor FKs, `op`, request, response, status, created_at) and `irp_submissions.status` extended to `'accepted' | 'cancelled'`; no backfill, snapshot idx 12.
- **Server:** `services/irp.ts` — `updateEwbVehicle` (VEHEWB, repeatable), `extendEwbValidity` (EXTENDVALIDITY; 8h-before/after-expiry window pre-checked, once per EWB **ever** via the ops ledger), `cancelEwb` (CANEWB; 24-h window, remark required) — every guard fires **before** any network call; on cancel success the accepted row flips to `'cancelled'` (a fresh GENEWB is required afterwards — the row is retained verbatim as the legal record). Routes `POST /reports/ewaybill/:voucherId/vehicle|extend|cancel` — cid-gated, honest 422/409/502 error mapping.
- **Client:** GSTR-1 rows with an accepted EWB surface the EWB number and lifecycle actions — **veh** (vehicle update), **ext** (extend validity), **can** (cancel, remark prompt); banners reuse R-28's honest surfaces. **ewb-gen** birth button added during verification (EWB-from-IRN was previously API-only).
- **Test infra:** mock IRP speaks `vehewb`/`extendvalidity`/`canewb` with a simulated 24-h cancel window (`POST /__expire`) and the once-ever rule; the mock now runs **self-keyed** (optional `--private-key`, public key discoverable via `GET /__pubkey`) and ships as a compose **test-profile sidecar** (`docker compose --profile test up mock-irp`) — the app reaches it as `http://mock-irp:3199` container→container (immune to host firewalls), host port **3299** for suites (3199 stays reserved for suite-spawned mocks). The app service gains `extra_hosts: host.docker.internal:host-gateway` so operators can point endpoint overrides at host-hosted adapters.
- **Tests:** `final_regression.py` +32 R-29 checks (**836**) — happy paths, window/once-ever guard refusals, cancel-rebirth refusal (fresh GENEWB unblocks), non-member 404s, TB-still-balances; new `scripts/acceptance/r29_ui.js` (**14** checks) driving the full cycle through the real UI against the sidecar.
- **Verification (final tree):** Python **1118/1118** (smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression **836** incl. 32 R-29, attack-the-fixes 29); browser **354/354** on a rebuilt image + fresh volume (14/14 migration rows, `irp_ewb_ops` live; run.js 153/153 exit-0 + r03…r29 = 201 scenario checks, r29 14/14); typecheck server + client clean; `git diff --check` clean.
- **Release:** commit `a1b7d9b` — `Release v1.28.0: EWB lifecycle — vehicle, extend, cancel`, annotated tag `v1.28.0` (tag object `817fcac`), pushed to origin 2026-09-19.

## v1.26.0 — R-27 TCS collection (Income-tax s. 206C)

R-27 implements the approved Option A scope: the collection-side mirror of the proven TDS machinery. One additive migration; no accounting-math change; no posting-engine change.

- **Migration `0011_r27_tcs.sql`** (additive): `tcs_sections` master (company FK cascade, `(company_id, section)` unique), `ledgers.tcs_section_id` + `voucher_entries.tcs_section_id` snapshots, and an idempotent "TCS Payable" starter ledger (`dutyHead='TCS'`) seeded into every existing company (`WHERE NOT EXISTS`, 0009 RCM precedent; new companies get it from `seedCompanyTx`). Generated via drizzle-kit's programmatic API after repairing the snapshot metadata chain (0002/0006 duplicate-id defect + format normalization of hand-authored snapshots — metadata only, **no SQL change**, so runtime migration hashes on existing installs are unaffected).
- **Server:** TCS-sections masters CRUD (mirror of TDS sections), voucher-entry validation (section must belong to the same company), `gst.ts` duty filter excludes `TCS` from GST aggregation (dedicated regression proof: TCS lines never move GSTR-1/3B), `import.ts` `DUTY_NAME_RE` classifies `\btcs\b` ledgers as duty (no taxable-supply contamination), **`GET /reports/tcs`** — A-04 semantics: collected (CREDIT) − remitted (DEBIT) = payable, per section + Unspecified; thresholds surfaced as reference data, never enforced (same operator-judgment posture as TDS).
- **Client:** "− Collect TCS" helper beside "− Deduct TDS" — computed on the **gross entered amount**, party credited net (one-click balancing identical to the TDS flow); TCS Sections master + TCS ledger field; `TcsView` + Gateway entry + registry.
- **En-route defects found and fixed (R-27's own helper):** (1) the first `applyTcs` added a collection line without netting the party credit — the voucher could never balance after one click, and pre-netting the party line computed TCS on the net (systematic under-collection); fixed to gross-based semantics. (2) the save payload mapped `tdsSectionId` but omitted `tcsSectionId` — the helper's section snapshot was silently dropped on save, landing collections under "Unspecified"; save + edit-load now persist it (server side was already complete).
- **Tests:** `final_regression.py` +23 R-27 checks (**778**) — CRUD scoping, voucher validation, collected/remitted/payable math, snapshot classification, GST-exclusion proof, non-member 404; new `scripts/acceptance/r27_ui.js` (**15** browser checks: TCS master CRUD, Collect-TCS receipt flow through the real button, report section buckets + payable, GST neutrality).
- **Verification (final tree):** Python **1060/1060** (smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression **778** incl. 23 R-27, attack-the-fixes 29); browser **325/325** on a rebuilt image + fresh volume (12/12 migrations; run.js 153/153 exit-0 + r03…r27 = 172 scenario checks, r27 15/15); typecheck server + client clean; `git diff --check` clean.
- **Release:** commit `3e0fb41` "Release v1.26.0: TCS collection (s. 206C)" (34 files, +4087/−147), annotated tag `v1.26.0`, **pushed to origin** (`main` = `3e0fb41`, 28 tags verified via ls-remote).

## v1.25.0 — R-26 GSTR-9 annual return

R-26 implements the approved Option A scope: the annual return as a pure report-family projection. No migration, no accounting-math change, no new transaction semantics.

- **`services/gstr9.ts`** (new): `gstr9(companyId, from, to)` over one FY window — no monthly summation. Table 4 (eligible ITC: A(5) regular from `gstr3b().itc`, A(3) RCM from `rcmItc`); Table 5 as honest zeros + stated limitation (no ITC-reversal transaction surface); Tables 6/7 mirroring 3B outward + 4(A)(3); **Table 8 ITC reconciliation** — duty-ledger opening credit position + Table-4 claims → computed closing vs **actual** ledger closing, difference surfaced row-by-row (R-15's period-only semantics become visible; the note explains that a single duty ledger per head nets output and input duty, so the difference includes output liability, not only unclaimed ITC); Table 9 (b2b/b2c/cdnr/cdnur nets with a built-in **Table-9-vs-3B cross-check**); Table 12 annual HSN (R-01 population, snapshot buckets preserved).
- **`GET /reports/gstr9`** (cid-gated, read-only) with the standard FY period default; `Gstr9View` with amber highlighting on any non-zero difference/consistency row; Gateway Reports entry + registry.
- **Tests:** `final_regression.py` +26 R-26 checks (755) — Table 4 = 3B FY aggregates (regular 360 / RCM 250 via own purchase fixtures), Tables 6/7 and Table 9-vs-3B cross-check zero, Table 9 net (11,000 b2b − 1,000 cdnr = 10,000 / igst 1,800), Table 8 walk (opening 0 → claimed 360 → ledger closing 1,440 = output 1,800 − input 360 → difference 1,080 with single-ledger netting), difference invariance under an R-15-style unpaired opening shift (opening and ledger closing move equally), Table 12 snapshot-bucket separation ('8471' vs '84'), non-member 404; new `scripts/acceptance/r26_ui.js` (12 browser checks: Gateway entry, FY render, amber Table-8 difference with single-ledger netting, neutral cross-check row, Table 5 limitation note).
- Verification: Python **1019/1019** (smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression **755** incl. 26 R-26, attack-the-fixes 29); browser **310/310** on a rebuilt image + fresh volume (11/11 migrations; run.js 153 + r03…r26 = 157 scenario checks); typecheck server + client clean.
- **Release-process amendment (same commit):** the RELEASED protocol state now includes **pushing the release to the remote** (`git push origin main` + `--tags`); RELEASES.md ledger rule 4 records the v1.0.0–v1.24.0 backlog push as PENDING (session credentials unavailable).

## v1.24.0 — R-25 e-way bill payload generation (EWB-01)

R-25 implements the approved Option A scope: stateless generate + download of the EWB-01 payload. Part-A is derived entirely from stored data; Part-B (vehicle/transporter) comes as optional request parameters — zprime persists no EWB number and no transport state (the portal is the system of record). No migration, no connectivity, no accounting-math change.

- **`services/ewaybill.ts`** (new): Part-A builder re-projecting `voucherGst()` duty + the shared line projection; strict all-at-once validation (same posture as R-24); HSN-depth enforcement (fail < 4 digits, advise < 6); sub-₹50,000 consignment-value advisory (informs, never blocks); Part-B passthrough with sanity (vehicle only on road mode; mode ∈ road/rail/air/ship). Sales→INV, Credit Note→CRN; Receipt/other types rejected; non-member → 404.
- **Shared-projection refactor:** the goods/service line extractor moved out of `einvoice.ts` to the exported `supplyLines()` (plus `EINV_DOC_TYPES` + `stateCode()` helpers) — one source of truth for both payload services; the R-24 byte-identical-payload regression check guards the refactor (verified unchanged).
- **`GET /reports/ewaybill/:voucherId`** (cid-gated, read-only): returns `{ ok, errors, warnings, payload }`.
- **Client:** "e-way" action beside R-24's "e-inv" on GSTR-1 B2B rows; JSON download; success banner carries advisories; amber banner lists validation gaps verbatim.
- **Tests:** `final_regression.py` +28 R-25 checks (729) — Part-A fields/states/values vs voucherGst, Part-A-only omits vehicle block, sub-threshold warning, Part-B params reflected, vehicle-on-rail + unknown-mode rejections, determinism, e-invoice/e-way totals agreement, CRN mapping, Receipt rejection, 2-digit HSN rejection (via its own snapshot-carrying voucher — the original sale's line snapshot correctly wins over item-master edits), non-member 404; new `scripts/acceptance/r25_ui.js` (13 browser checks: e-way beside e-inv, download through the REAL UI, Part-A fields, advisory visible, no-download-on-failure).
- Verification: Python **1005/1005** (smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression **729** incl. 28 R-25, attack-the-fixes 29); browser **298/298** on a rebuilt image + fresh volume (11/11 migrations; run.js 153 + r03…r25 = 145 scenario checks); typecheck server + client clean.

## v1.27.0 — R-28 live IRP/EWB connectivity

R-28 implements the approved Option A scope: opt-in NIC e-invoice/e-way-bill submission from inside zprime, superseding R-24/R-25's stateless posture (which remains the behavior whenever credentials are absent — generate/download paths are byte-unchanged). Migration 0012 (additive): `irp_credentials` (per company, AES-256-GCM encrypted at rest via `IRP_ENC_KEY`, boot-time fail-fast R-09-style) + `irp_submissions` (verbatim IRP request/response, IRN/ack persistence — a legal duty per NIC docs, undeletable once accepted). `services/irp.ts`: AppKey/SEK handshake per the official NIC sandbox choreography (AES-256-ECB SEK, RSA PKCS#1 secrets), in-memory session cache with ForceRefresh window, **hard idempotency** (a repeat submit re-reads the stored result without any network call — NIC blocks duplicate submitters for an hour), `submitEInvoice` + `submitEwayBillFromIrn` + history. Routes (all cid-gated, 404 non-members): masked credentials PUT/GET/DELETE under `/companies/:id`, submit + submission history under `/api/c/:cid/reports`. Client: CompanySettings "IRP / e-Way Bill Connectivity" section (masked read-back, last-4 only), "submit" actions beside R-24's generate in GSTR-1 with honest amber failure banners (validation 422, upstream 502, duplicate 409), credential removal per environment. CI: `scripts/mock_irp.js` — a wire-faithful mock IRP (SEK-encrypted responses, duplicate-block simulation) so the full handshake/idempotency path is tested without network. No accounting math, no posting-engine change.

## v1.23.0 — R-24 e-invoice payload generation (IRP upload)

R-24 implements the approved Option A scope: zprime generates and validates the NIC v1.01 e-invoice JSON for Sales/Credit Note vouchers; the operator uploads it to their chosen IRP/GSP channel. No IRP connectivity, credentials, or network code (explicitly deferred — needs a product decision on external services).

- **Migration `0010_r24_party_pincode.sql`** (additive, no backfill): `ledgers.party_pincode` — the one schema gap (buyer PIN is mandatory in BuyerDtls; the seller pincode already existed). MasterPage ledger form gains the Party PIN Code field.
- **`services/einvoice.ts`** (new): payload builder that re-projects data zprime already computes — `voucherGst()` duty classification (R-01/R-05/R-23-verified), `inventory_entries`/`voucher_entries` line snapshots, company/ledger master fields. Goods lines from inventory; service lines only when the voucher has no inventory (a pure service invoice). Strict **all-at-once** validation: every mandatory gap reported with the exact ledger/company field to fix; no half-formed payload is ever emitted. UQC symbol mapping with loud failure on unknown units. Line-taxable cross-check against `voucherGst` (defense in depth). Sales→INV, Credit Note→CRN with positive magnitudes; non-member → 404; RCM and cancelled vouchers rejected.
- **`GET /reports/einvoice/:voucherId`** (cid-gated, read-only): returns `{ ok, errors, payload }`.
- **Client:** "e-inv" action on GSTR-1 B2B rows; download fires the JSON as a file; amber banner lists validation gaps verbatim; green confirmation on success.
- **Tests:** `final_regression.py` +27 R-24 checks (709) — payload determinism, seller/buyer blocks, values matching `voucherGst`, HSN/UQC line data, missing-pincode all-at-once errors, unregistered rejection, Receipt rejection, CRN positive magnitudes, non-member 404; new `scripts/acceptance/r24_ui.js` (16 browser checks: PIN field on the ledger form, full sale through the voucher form, e-inv download through the REAL UI, payload contents, amber validation banner).
- Verification: Python **991/991** (smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression **709** incl. 27 R-24, attack-the-fixes 29); browser **285/285** on a rebuilt image + fresh volume (11/11 migrations; run.js 153 + r03…r24 = 132 scenario checks); typecheck server + client clean.

En-route fixture findings (app correct, tests fixed): the voucher API takes `inventoryEntries` (not `inventory`) and numeric GST rates; UI-created ledgers default to `gstRegistrationType`/`taxability` "none" — the validator correctly refused both until the fixtures set Regular/Taxable. No source behavior changed.

## v1.22.0 — R-23 reverse charge mechanism (RCM)

**Genuine compliance gap closed — classification + reporting additive; posting engine and accounting math untouched.**

R-23 implements the approved full scope: reverse charge becomes expressible and correctly classified in GSTR-3B. Investigation (`R-23_INVESTIGATION.md`) had verified zero RCM concept existed (`grep` → nothing); a self-assessed duty line would have silently landed in the regular ITC bucket, understating net cash payable.

- **Migration `0009_r23_rcm.sql` (additive, no backfill):** `vouchers.is_rcm` boolean `DEFAULT false` — every existing voucher is honestly regular-charge. RCM is marked **per-transaction, not per-supplier** (one supplier can mix regular goods + RCM services, e.g. GTA).
- **Duty ledger:** `dutyHead` vocabulary gains `"RCM"`; company creation seeds an "RCM Payable" starter ledger (idempotent for new companies; existing companies opt in by adding the ledger with Duty Head = RCM). Self-assessed duty posts as an ordinary gateway line on that ledger — the TDS `dutyHead` pattern; no posting-engine change.
- **GSTR-3B Table 4:** `gstr3b()` gains additive `inwardRcm` (4(A)(3) taxable + duty, Purchase/Debit Note with R-05 sign logic) and `rcmItc` sections; RCM vouchers are **excluded** from regular ITC; net continues to reconcile to the ledgers (RCM nets to nil there — asserted, not assumed). Existing output keys identical → all prior suites unaffected.
- **Client:** Alt+R / panel "Reverse Charge (RCM)" toggle on Purchase + Debit Note voucher forms with an amber strip and Day Book RCM badge; GSTR-3B view renders the 4(A)(3) + RCM ITC rows; Ledger form Duty Head select gains RCM. Sales shows no RCM control (outward RCM e-commerce ops out of scope, documented).
- **Tests:** `final_regression.py` +33 R-23 checks (682) — per-transaction flag persistence, 4(A)(3) + RCM-ITC values, regular ITC exclusion, net-cash-nil reconciliation, RCM ledger position −250, isRcm strips on edit/uncancel, forgery stripping; new `scripts/acceptance/r23_ui.js` (14 browser checks: toggle, strip, badge, 3B rows, net 0, no Sales control).

Verification: Python **964/964** (smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression **682** incl. 33 R-23, attack-the-fixes 29); browser **267/267** on a rebuilt image + fresh volume (run.js 153 + r03/r04/r05/r07/r10/r14/r18/r20/r21/r23 = 114 scenario checks); typecheck server + client clean; fresh volume applies 10/10 migrations.

---

## v1.21.0 — R-22 master-table actor provance

**Additive schema change + server stamping — accounting-math untouched, no client change.**

R-22 applies the R-17 voucher provance pattern to masters: `created_by` / `updated_by` (FK → users, ON DELETE SET NULL, nullable) plus `updated_at` on the master tables with a user-facing creation/mutation surface.

- **Migration `0008_r22_master_actor.sql` (additive, no backfill):** 3 columns × 9 tables — `groups`, `ledgers`, `units`, `stock_groups`, `stock_categories`, `godowns`, `stock_items`, `employees`, `pay_heads`. Existing rows keep NULL (honest "before provance existed"); seeding reserved groups / starter ledgers / voucher types / TDS sections also stays NULL — no authenticated actor exists at seeding time and fabricating one would be dishonest. Excluded: `voucher_types` + `tds_sections` (system-seeded, no user creation surface).
- **Stamping at the write sites:** generic `crud()` handler stamps `createdBy` on POST and `updatedBy` + `updatedAt` on PUT (created_by immutable) — one change covers all 11 registered master kinds including employees/pay-heads; XML import's 5 master-ensure sites stamp the importing actor (R-17 rule). Client-supplied `createdBy`/`updatedBy`/`updatedAt` are stripped at the boundary — actor identity comes only from the verified JWT.
- **Tests:** `final_regression.py` +20 R-22 checks (649) — POST/PUT stamping, created_by immutability, actor-forgery stripping (POST + PUT), import-created ledger/item carry the importing actor, seeded rows NULL, second-member edit stamps the actual editor, fresh `updated_at` NULL. No client change → browser suites unchanged.

Verification: Python **931/931** (smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression **649** incl. 20 R-22, attack-the-fixes 29); browser **255/255** (run.js 153 + r03/r04/r05/r07/r10/r14/r18/r20/r21); typecheck server + client clean; fresh volume applies 9/9 migrations.

---

## v1.18.0 — R-18 full audit feature (voucher lifecycle history)

**Additive schema change + server capture + minimal viewer — accounting-math untouched.**

R-18 implements the approved full audit feature: a same-transaction `audit_events` log capturing WHO did WHAT to each voucher and WHEN, with a compact in-form history surface.

- **Migration `0007_r18_audit_events.sql` (additive):** `audit_events` — `company_id` (FK CASCADE), `voucher_id` (nullable, FK **SET NULL** — a `delete` event must outlive the voucher it describes; CASCADE would erase the event), `actor_id` (FK SET NULL), `action` (`create|edit|cancel|uncancel|delete`), `detail`, `created_at`; indexes on `(company_id, voucher_id)` and `company_id`. No backfill — pre-R-18 transitions are unknowable; seeding events at migration time would fabricate history.
- **Capture at all 7 write sites, same transaction** (an event exists iff the change committed — never accounting-changed/audit-lost): manual create (`vouchers.ts`), XML import (`import.ts`, importing actor), payroll create (`payroll.ts`), edit, cancel (+reason), uncancel, delete (event recorded **before** the row goes, with a debit-side snapshot of the entries in `detail`). R-10 idempotent replay records no event (no state change). **F-R18-1 folded in:** payroll's voucher insert now stamps `created_by` (R-17 gap).
- **Viewer:** `GET /vouchers/:id/audit` (cid-gated, 404 on unknown voucher, actor usernames joined) + one compact history strip on VoucherScreen in edit mode only (silent-degrade on fetch failure — convenience, never a workflow/security surface).
- **Tests:** `final_regression.py` +18 R-18 checks (611) — create/edit/cancel/uncancel/delete event order + actor + cancel-reason detail + delete snapshot, payroll + import + created_by provenance, replay records no event, cross-company audit 404, and a **forced-failure atomicity proof** (audit failure aborts the posting). New `scripts/acceptance/r18_ui.js` (11 browser checks: fresh voucher shows no strip; UI-entered voucher → "Created by admin" on alter; edit appends "Edited by admin" in lifecycle order; Day Book + TB balanced throughout).

Verification: Python **893/893** (smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression **611** incl. 18 R-18, attack-the-fixes 29); browser **228/228** (run.js + r03/r04/r05/r07/r10/r14 + **r18** 11); typecheck server + client clean; fresh volume applies 8/8 migrations.

---

## v1.19.0 — R-20 company audit timeline

**Read-only feature on the R-18 audit data layer — no migration, no accounting-math change.**

R-20 completes the audit feature: a company-wide, newest-first timeline of every voucher lifecycle event.

- **Server:** `GET /audit` in `vouchers.ts` — cid()-gated (non-member = standard 404, no existence leak); `id DESC` chronology (events are same-transaction with their state change, so `id` is strictly monotonic where `created_at` can tie); `limit` clamped 1–1000 (default 200), optional `action` enum filter, `before` id-cursor for cheap older-page loads; LEFT JOINs users + vouchers + voucherTypes so rows carry actor username and voucher number/type.
- **Client:** new `AuditTrail.tsx` at `/company/:cid/audit` (Day Book conventions; action badges; live vouchers link to the alter surface; deleted vouchers render unlinked with their R-18 snapshot) + one "Audit Trail" card in the Gateway utilities group.
- **Tests:** `final_regression.py` +8 R-20 checks (619) — newest-first ordering, company isolation (timeline rows == company event count), joined fields, action filter, before-cursor, limit clamp, cid boundary semantics (unknown 404 / malformed 400), detached delete row with snapshot; new `scripts/acceptance/r20_ui.js` (12 browser checks — Gateway card → page, empty state, created/edited/deleted lifecycle rows, alter link, actor column, ordering, filter).

Verification: Python **901/901** (smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression **619** incl. 8 R-20, attack-the-fixes 29); browser **240/240** (run.js + r03/r04/r05/r07/r10/r14/r18 + **r20** 12); typecheck server + client clean; fresh volume applies 8/8 migrations.

---

## v1.20.0 — R-21 pre-validation UX (negative-stock advisory + import dry run)

**Advisory/visibility layer over existing server guarantees — no migration, no accounting-math change, guards untouched.**

R-21 implements the two diagnosed UX companions to B-01/B-03 (R-04 §15):

- **VoucherScreen negative-stock advisory:** an amber strip under the inventory grid, live while typing — computed from the same chronological source the R-06 guard uses (`GET /reports/stock-summary?to=<voucher date>`, `closingQty` per item) plus the client deltas with the type's flow sign (STOCK_FLOW; Stock Journal source/target kinds honored). Names the item, available qty, voucher date, and the Company Settings escape hatch. Silent-degrade on fetch failure; **suppressed when the company opted into `allowNegativeStock`**; the server guard remains the sole authority at save. Companies-list/detail responses now include `allowNegativeStock` (previously missing, which made suppression impossible).
- **Import dry-run validation:** `POST /xml?dryRun=1` runs the IDENTICAL single-transaction import path — every parser, `validateEntries`, `assertStockAvailabilityTx`, reference, bill-allocation and duplicate check — then throws a sentinel before returning so the transaction rolls back EVERYTHING (masters, vouchers, counters, audit events). Returns the same stats table with `dryRun: true`. Client: a **Validate (dry run)** button beside **Start Import** and a blue "nothing was imported" result banner. No new endpoint, no new auth surface (same cid() gate; non-member dry-run → 404); the real-import path is untouched when the flag is absent.
- **Tests:** `final_regression.py` +10 R-21 checks (629) — dry-run returns would-import stats and persists nothing (vouchers/ledgers/items/counters unchanged, Day Book empty), unbalanced/oversell XML rejected with the real errors while persisting nothing, real import after dry runs unaffected, non-member dry-run 404. New `scripts/acceptance/r21_ui.js` (13 browser checks — warning appears when overselling via UI, names item/qty/setting, clears on correction, suppressed on opted-in company; Validate → nothing-imported banner + Day Book unchanged; Start Import → voucher appears).

Verification: Python **911/911** (smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression **629** incl. 10 R-21, attack-the-fixes 29); browser **253/253** (run.js + r03/r04/r05/r07/r10/r14/r18/r20 + **r21** 13); typecheck server + client clean; fresh volume applies 8/8 migrations.

---

## v1.17.0 — R-17 audit-trail groundwork (voucher actor provance)

**Additive schema change + server-only propagation — no client change, no accounting-math change.**

R-17 implements the approved groundwork for the future audit feature: actor provance on vouchers — who entered and who last edited each voucher, stamped server-side from the verified JWT identity (`req.userId`), never from client-supplied fields. Master tables are deliberately deferred (no per-row history surface exists to anchor them; the generic CRUD site makes them a ~15-line later addition).

- **Migration `0006_r17_voucher_actor.sql` (additive):** `vouchers.created_by` + `vouchers.updated_by` (FK → users, `ON DELETE SET NULL`) + `vouchers.updated_at`; existing rows keep NULL — no fabricated backfill (pre-R-17 actor values are unknowable; honesty over cosmetics). Drizzle snapshot + journal per the established convention.
- **Propagation (all voucher write paths):** `insertVoucherTx` stamps `created_by` from a new actor parameter (manual POST path); the XML import's own insert stamps `created_by` with the importing user; `PUT /vouchers/:id` stamps `updated_by` + `updated_at` (created_by immutable); cancel/uncancel semantics unchanged (R-02's `cancelled_by` already handled); R-10 idempotent replay correctly records no new actor event.
- **Tests:** `final_regression.py` +7 R-17 checks (593) — manual stamping, no updated_* on creation, edit stamps updated_by/updated_at while preserving created_by, cancel/uncancel actor cycle unchanged, admin id resolution; fresh volume applies 7/7 migrations.

Verification: Python **875/875** (smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression **593** incl. 7 R-17, attack-the-fixes 29); browser **219/219** on a rebuilt image with fresh volume; typecheck server clean, client untouched.

---

## v1.16.0 — R-16 deployment self-healing (F-R1) + RELEASE CANDIDATE status

**Compose-only change — no application code, no migration, no client modifications.**

The v1.15.0 production-readiness review (READINESS_REVIEW.md) verified the full product with fresh evidence (fresh-volume compose 6/6 migrations; browser 219/219; Python 868/868; typechecks clean) and adopted **RELEASE CANDIDATE** as the product status, superseding the action plan's ALPHA verdict (which predated R-04…R-15). One new finding, F-R1 (P3, deployment): on a fresh volume the db healthcheck (`pg_isready`) can pass transiently during `initdb`; the app's first migration connection then hits ECONNREFUSED and, with no restart policy, the container exited and stayed dead until manual restart (reproduced live during the review; migrations apply cleanly on the recovering boot — no data risk).

- **`docker-compose.yml`:** `restart: unless-stopped` on both `app` and `db` — the stack survives host reboots and self-heals the first-boot race (verified live: app-initiated crash → automatic restart → healthy, no operator action; note: `docker kill`/`stop` remain honored as operator intent per Docker semantics).
- **README:** deployment note documenting the restart policy and the self-healing behavior.

Verification: fresh-volume boot healthy (6/6 migrations); kill-and-recover proven live; Python **868/868**; browser 219/219 (baseline + R-14 suites re-run on the rebuilt stack).

---

## v1.15.0 — R-15 opening-GST semantics regression lock (test-only)

**Test-only change — no source, migration, or client modifications.**

R-15 investigation live-verified the opening-GST-balances candidate (plan §13 P2) as **NOT A BUG**: GST returns are period-only by design (derived purely from voucher entries; ledger openings never enter the query), the duty ledger carries the true book position (−5,000 opening → −5,900 after a 900 interstate sale), and unpaired openings surface honestly as TB/BS differences via the R-14 health surface. No false invariant exists anywhere. The verified semantics had zero coverage — this release locks it in:

- **`final_regression.py` +8 R-15 checks (586):** migrated-books company with paired openings (Cr 5,000 IGST liability vs Dr 5,000 counterpart) → TB difference 0; interstate sale (taxable 10,000 + IGST 900) posted; **GSTR-3B net.igst == 900** and **GSTR-1 netIgst == 900** (openings excluded — period-only return semantics); **IGST duty-ledger position −5,000 → −5,900** (book position carries the opening); unpaired-opening company → TB −5,000 / BS +5,000 surfaced honestly.

Verification: Python **868/868** (smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression **586** incl. 8 R-15, attack-the-fixes 29); browser **219/219** unchanged (zero client changes).

---

## v1.14.0 — R-14 TB health surface (out-of-balance visibility)

**Minimal additive change — no migration, no accounting-math change.**

R-14 investigation re-verified the action plan's three remaining UX candidates against v1.13.0: the VoucherScreen negative-stock warning and the import per-voucher error surfacing were both superseded by R-06/R-04 (server-side guards make them convenience-only — NOT A BUG — VERIFIED; import atomicity live-probed). The one confirmed gap (F-14-1, P3): books imbalance had **no surface anywhere** — the TB report showed Dr/Cr totals side-by-side with no warning, and the Gateway had no health indicator. The only way books can go out of balance since posting-time validation exists is operator data (e.g. an asymmetric opening entry — exactly the historical B-02 class); the O-1 block's own fixture had silently carried a 10,000 imbalance in the test suite with nothing to catch it.

- **`accounting.ts` `trialBalance()`:** returns additive `difference: r2(totalDebit - totalCredit)` — display-only arithmetic on already-computed totals (same class as the balance-sheet `difference`).
- **Trial Balance report:** amber "Difference in books: X — check opening balances or unposted entries." banner when `|difference| > 0.004` — a direct copy of the existing Balance Sheet banner pattern; no other UI change.
- **Gateway:** compact "Books Health" card — `Trial Balance ✓ balanced` / `Trial Balance ✗ out by X` with a link to the TB report; renders nothing on fetch failure (silent degrade, no regression surface).
- **Tests:** `final_regression.py` +6 R-14 checks (578) — additive field present, 0 on clean books, injected Dr-777.77 asymmetry surfaces exactly, identity `difference == totalDebit - totalCredit` holds; new `r14_ui.js` browser suite (11 checks) — clean → no banner + balanced chip; asymmetry → banner + out-by chip + view link; counterpart opening restores balance everywhere.

Verification: Python **860/860** (39+88+65+61+578+29); browser **219/219** (208 + 11 R-14) on a rebuilt image with fresh volume; typecheck server+client clean.

---

## v1.13.0 — R-13 login hardening (F-13-1 rate limiting + F-13-2 timing enumeration)

**Server-only change — no migration, no client modification, no new dependency.**

R-13 investigation (live-reproduced on v1.12.0): F-13-1 — no rate limiting/lockout on `POST /api/auth/login` (25 failed logins → 25 instant 401s; P3, P2 for internet-exposed deployments); F-13-2 — timing side-channel enables username enumeration (valid-user-wrong-password 43.0 ms vs unknown-user 2.1 ms, a 20.7× oracle, because `scryptSync` was skipped when the user did not exist). Fixes:

- **`server/src/lib/loginGuard.ts` (new):** in-memory sliding-window limiter keyed by source IP + exact username — 10 failures in 10 minutes locks the pair until the oldest failure ages out (`429 Too Many Login Attempts` + `Retry-After`); a successful login resets the pair. Single-process by design; state resets on restart (documented).
- **`server/src/routes/auth.ts`:** lockout check **before** any user lookup (a locked pair learns nothing about account existence); **dummy-scrypt timing equalization** — the unknown-user path now performs one scrypt, collapsing the latency oracle; failures record, success resets; 401 body unchanged.
- **`final_regression.py` +14 R-13 checks (572):** threshold semantics (9 fails → all 401; past 10 → 429), correct-password-during-lockout refused (no bypass), per-(ip, username) isolation, full reset cycle via successful login, unknown-user latency now ≥10 ms with ratio <3× (oracle collapsed), uniform 401 body.
- **README:** login-throttling note (policy, 429 semantics, in-memory state, reverse-proxy guidance) + timing-equalization note.

Verification: Python **854/854** (smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression **572** incl. 14 R-13, attack-the-fixes 29); browser **208/208** on a rebuilt image with fresh volume (6/6 migrations, fresh install); typecheck server+client clean.

---

## v1.12.0 — R-12 backup/restore runbook + round-trip guard (B-12)

**Docs + test-only change — no source, migration, or client modifications.**

B-12 (P4, reclassified from P2 by R-12 investigation): the documented `pg_dump` path is live-verified working (full drop-and-restore round-trip, identical data, healthy app); no in-product backup surface is warranted for the single-operator self-hosted model. Real gaps closed:

- **README "Data & backups" → verified runbook:** backup command, restore procedure with the previously undocumented **stop-app → drop/recreate-DB prerequisite** (restoring over a live schema fails on `CREATE TABLE` collisions), a verify-after-restore step, and the whole-volume snapshot alternative.
- **`final_regression.py` +6 R-12 checks** (`final_regression: 558`): the exact runbook shape is regression-guarded in the test rig — `pg_dump` → restore into a scratch database with `ON_ERROR_STOP` → company/voucher row counts match source → scratch dropped. Future schema/migration drift that would break a plain-SQL restore for operators is now caught before release.

## v1.11.0 — R-11 purchase-side settlement coverage (B-11)

**Test-only change — no source, migration, or client modifications.**

B-11 (P3, reclassified from P2 by R-11 investigation): purchase-return / Debit-Note flows were implemented and correct but had **zero purchase-side regression coverage** — the creditor-side mirror of the bill-wise machinery (BUG-002 covers debtors only) and the hand-computed BP assertion were the only supplier-side proofs.

- `final_regression.py` **+21 R-11 checks** (`final_regression: 552`): creditor-side adversarial mirror (wrong-party, nonexistent bill, over-open, direction-mismatch rejections), **Debit Note settling a purchase bill via mixed-sign `against_ref`**, DN over-settlement rejection, payment settling the DN-reduced remainder, **advance-to-creditor consumed by a later purchase's credit entry** (direction-strict pattern), one voucher settling two open bills via opposing entries, AP-report assertions at every stage, GSTR-3B ITC reversal from the DN, TB identity throughout.
- `reconcile.py` (+3 → 61 checks): bill-wise Debit Note (DN-2: goods return 8,000 + duty 1,440 settling bill PUR-1) woven into the hand-computed scenario; all downstream independent expectations recomputed (TB 7,64,400, purchases 42,000, profit 1,26,000, Sigma 19,560, ITC 3,780, net GST 24,840) — the full-period identity `netCgst − ITC == CGST ledger net credit` now also holds across a **bill-wise** DN.

## v1.10.0 — R-10 duplicate-submission idempotency (B-10)

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
- GST reporting integrity)** The ₹1,215 IGST defect: GST reports now treat booked duty amounts as authoritative; supply-type contradictions are flagged (`supplyMismatch`), never silently zeroed. Ledger GST == GSTR-1 == GSTR-3B is an enforced invariant with a permanent regression test.
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
