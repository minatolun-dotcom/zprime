# R-44 Investigation — zprime v1.42.0 · F-42-2 Starter Inventory Masters

**Status:** investigation complete — implementation NOT started (per protocol).
**Baseline:** HEAD `fb2f59c8804387ee6f744653cd70f3a50ff9ea36` = `v1.42.0-1-gfb2f59c` (release commit `03e4d35` = tag `v1.42.0`, pushed, 44 tags); working tree clean apart from the intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md` and `scripts/__pycache__/`. No source, test, migration, or doc file modified.

---

## 1. Executive Summary

F-42-2 (R-42, P4): **fresh companies start with zero units and zero godowns**, so an operator's first inventoried item hits two dead-ends — the Unit `*`-required picker is empty, and the godown select shows only "—". The server works fine (item POST succeeds with any existing unit; godown is optional), so this is a first-hour UX gap, not a defect.

Two candidate designs were investigated:

- **Option A (recommended): seed two starter units + one starter godown** inside `seedCompanyTx`, in the same transaction that already seeds groups/voucher-types/ledgers. Opt-out is the existing Masters pages (reserved-flag not needed — they are deletable/alterable like any master). No migration, no API change, no schema change, no frontend change.
- **Option B (rejected for now): a Gateway "Getting Started" checklist card** listing unpopulated master kinds. More surface, more code, deferred value — R-42 showed operators find the Masters menu fine; the pain is the empty required picker, which A eliminates outright.

A third, narrower option (frontend-only: pre-create masters from `Companies.tsx` after POST) was rejected: it splits seeding across two owners, breaks atomicity (a crash between company-create and masters-create leaves a half-seeded company), and duplicates what `seedCompanyTx` already does.

## 2. Verified Current State (evidence)

| Question | Answer | Evidence |
|---|---|---|
| What does company creation seed today? | Reserved groups → default voucher types → 10 starter ledgers (Cash, P&L A/c, IGST/CGST/SGST/CESS/TDS/RCM/TCS duty ledgers, Salary Payable). **No units, no godowns.** | `server/src/routes/companies.ts` `seedCompanyTx()` (lines 52–122); POST `/companies` wraps `insert + seedCompanyTx + owner membership` in one transaction |
| Are units/godowns seeded anywhere else? | No. Fresh DB rows confirm: freshly created companies have `units=0, godowns=0, ledgers=10`. | Live query against `zprime-db-1`: companies 1 and 34 show exactly 10 ledgers, 0 units, 0 godowns |
| Is godown optional on inventory entries? | Yes — `godownId` is nullable/optional in the voucher schema. | `inventoryEntrySchema` (`server/src/lib/routes.ts` line 95) |
| Is unit optional on a stock item? | **No — `unitId` is NOT NULL** with FK to `units`. | `stockItems` table (`server/src/db/schema.ts` line 200); `refs: { unitId: { table: units, label: "Unit" } }` FK guard in `masters.ts` |
| What does the operator hit first? | Stock Items form has `Unit *` required; with zero units the select is empty → the item cannot be saved at all. Godown select shows only "—" (usable but bare). | `MasterPage.tsx` units/godowns/stock-items field configs; run.js masters section (lines 67–97) |
| What do the test suites do today? | They work around the gap: run.js creates units ("Pieces"/pcs, "Box of 10"/box) and godowns (Main Warehouse, Retail Shop) before items; the R-42 drill tripped over the same gap live. | `scripts/acceptance/run.js` lines 67–70; R-42 drill log (units select never populated; godown "Main Warehouse" missing) |
| Conventions for reserved/seeded masters? | Groups use `isReserved: true` + `forbidDeleteReserved`; units/godowns have NO reserved concept — every row is deletable via generic CRUD. | `seedCompanyTx` groups loop; `crud()` opts in `crud.ts` |
| Uniqueness constraints? | `units_company_symbol_uq (company_id, symbol)`, `godown_company_name_uq (company_id, name)` — idempotent seeding per company is naturally safe. | schema.ts lines 171, 192 |
| Where would the UI show progress? | Gateway already has a Books Health card pattern (TB balanced/out banner) — the natural home if Option B were ever wanted. | `Gateway.tsx` lines 157–168 |

## 3. NOT A BUG — VERIFIED

- Inventory vouchers **work** without godowns (godownId optional) and **cannot** work without a unit (NOT NULL by design — every qty needs a unit of measure, Tally parity).
- Nothing in the posting path is affected by this finding; it is purely first-hour data-entry friction.
- The existing README/PROJECT note (v1.41.0) already tells operators to create units/godowns first — accurate but the gap remains.

## 4. Option A — Proposed Design (for approval)

Extend `seedCompanyTx` (same transaction, after starter ledgers):

| Kind | Seed | Rationale |
|---|---|---|
| units | `Numbers` / `Nos` / 0 decimals | Tally's default unit name; symbol unique-safe per company |
| units | `Pieces` / `pcs` / 0 decimals | What run.js and real traders commonly create first |
| godowns | `Main` | Neutral, short; Tally uses "Main Location" — "Main" avoids implying a warehouse the operator may not have |

Properties:

- **Atomic** — rides the existing `insert companies + seed + membership` transaction; a failed seed aborts the whole company creation (no half-seeded state), exactly like today's ledgers.
- **No migration, no schema change** — plain inserts into existing tables inside the existing function.
- **No new API surface** — nothing to authorize (R-03 boundary untouched); the rows appear via existing `/c/:cid/units` and `/c/:cid/godowns` reads.
- **Fully operator-editable** — units/godowns have no reserved flag; alter/delete through the normal Masters pages. Deleting a seeded unit that no item references is a normal CRUD delete; if an item references it, the existing FK guard returns the standard friendly error.
- **Idempotent per company** — unique (company_id, symbol)/(company_id, name) make double-seeding impossible; seeding only ever runs once per company anyway (inside creation).
- **Zero effect on existing data** — no backfill of existing companies (they already have whatever the operator created; force-adding "Nos"/"Main" to live companies would be exactly the kind of unrequested mutation zprime avoids).
- **Test impact** — suites that create their own units/godowns keep working: run.js uses `selectOption({ label: "pcs (Pieces)" })` style labels from its own created rows; two extra rows in the list do not break any assertion that counts rows (verified: no suite asserts `units.length === 0` or exact counts on a fresh company — run.js always creates its own first). The R-42 drill's fresh-company unit/godown friction disappears by construction.
- **Docs impact** — flip the README "Notes & limits" sentence and the PROJECT.md F-42-2 note from "create units/godowns first" to "starter units (Nos, Pieces) and godown (Main) are seeded; edit or delete them on the Masters pages".

Acceptance criteria for implementation:

1. POST /companies → GET units shows exactly `Nos`, `Pieces`; GET godowns shows exactly `Main`; ledgers/groups/voucher-types unchanged (10 starter ledgers still).
2. Stock-item creation on a brand-new company succeeds using the seeded `Nos` unit without creating any unit first (UI + API).
3. Seeded rows are alterable/deletable via the normal Masters UI.
4. Upgrade path: existing companies are untouched (no migration); fresh install gains the seeds.
5. r44_ui.js: fresh company → Units page shows the two seeds; Godowns page shows `Main`; create an item picking `Nos` with zero prior setup; delete `Main` succeeds; typechecks + full browser battery green.

## 5. Option B — Gateway checklist card (deferred)

A "Getting Started" card on Gateway listing master kinds still empty (no units, no godowns, no items…). Nice discoverability, but: more client code, a new health-query, and R-42's drill showed the Masters menu is discoverable — the actual blocker was the empty required Unit picker. Option A removes the blocker; B can ride a later polish release if operators still want a checklist. Not recommended now.

## 6. Scope & Risk

| Area | Change? |
|---|---|
| Accounting math | **None** |
| Schema / migrations | **None** |
| API surface / authorization | **None** (seed lives inside the existing transactional route) |
| Frontend | **None** for Option A |
| Existing data / upgrades | **None** (no backfill by design) |
| Blast radius | One function (`seedCompanyTx`) + docs + one new browser suite |

## 7. Final Recommendation

**Option A** — seed `Nos`, `Pieces` units and `Main` godown in `seedCompanyTx`. Smallest possible diff that eliminates the F-42-2 dead-end by construction, honors atomicity, touches nothing else, and flips the v1.41.0 operator note from "work around it" to "already handled".

Verdict line for the roadmap: **F-42-2 CONFIRMED AS UX GAP — OPTION A RECOMMENDED (seed starter masters in the creation transaction)**.

Awaiting approval to implement. Nothing has been modified.
