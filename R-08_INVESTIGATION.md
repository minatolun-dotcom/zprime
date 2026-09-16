# R-08 Investigation — zprime v1.7.0 · B-07 Cross-Company Master References

**Status:** investigation complete — implementation NOT started (per protocol).
**Verdict:** `R-08 CONFIRMED — INVESTIGATION REQUIRED` (P1, live-reproduced with a proven accounting-corruption chain).
**Baseline:** HEAD `f6c921f4237aa70aae33cf8ce96c788082466465` = tag `v1.7.0`; working tree clean except this report and the intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md`. No source/test/migration/doc file modified. Probe scripts in `/tmp` only; probe data in the disposable Docker stack.

---

## 1. Executive Summary

The action plan's B-07 claim — "cross-company master references accepted; crud.ts has no resource→company validation" — is **CONFIRMED and worse than characterized**. The audit graded it as a validation-hygiene P1 (XGRP probe: ledger with a foreign group id accepted). Live verification on v1.7.0 shows the gap is not hygiene: it is a **proven path to silently unbalanced books**.

The demonstrated chain:

```
pay-head in Company A referencing Company B's ledger   (accepted, 200)
  → salary structure on that head                      (accepted, 200)
  → POST /payroll/process posts a Payroll voucher in A
      with a DEBIT against Company B's ledger          (accepted, 200)
  → ledgerBalances() is company-join-scoped → the debit
    is invisible to A's reports AND B's reports
  → A's Trial Balance: Dr=0 / Cr=10,000 — UNBALANCED, silently
  → A's Balance Sheet: difference = 10,000
```

Root cause is one design gap at the trust boundary: `crud.ts` validates company ownership of the *row* (`companyId = c` on every list/get/put/delete) but never validates *referenced FK ids in the body*, and the schema FKs (`ledgers.group_id → groups.id`, `stock_items.unit_id → units.id`, `pay_heads.ledger_id → ledgers.id`, …) are global with no `companyId` scoping. The voucher path does this correctly (`assertTypeTx`/`assertLedgersTx`/`assertRefsTx` all company-scoped) — the master CRUD path and two payroll sub-routes never received the same treatment.

## 2. Baseline Integrity

- `git rev-parse HEAD` → `f6c921f4237aa70aae33cf8ce96c788082466465` = `v1.7.0` ✓
- `git describe --tags` → `v1.7.0` ✓
- `git status --short` → `?? ZLEDGER_PRODUCTION_ACTION_PLAN.md` (intentional only) ✓
- No repository file modified by this investigation.

## 3. Action-Plan Claim Re-Verification

| Claim (action plan) | v1.7.0 reality | Disposition |
|---|---|---|
| "Cross-company master references accepted (ledger.groupId FK is global)" | Confirmed for ledgers.groupId, stock-items.unitId, pay-heads.ledgerId, salary-structure.headId | **CONFIRMED BUG** |
| "crud.ts has no resource→company validation" | Half-true: row ownership IS validated (list/get/put/delete all scope `companyId = c`; DELETE is safe). What is missing is **body-reference validation** on POST/PUT | Refined — the gap is body FK refs |
| "voucher path already validates" | Confirmed — `assertLedgersTx` + `assertRefsTx` + `assertTypeTx` (vouchers.ts:25-55, 426-429) are fully company-scoped; also groups' `parentId` is validated in `beforeSave` (masters.ts F-GRP-01) | Accurate |
| Severity P1 | Confirmed — and now *demonstrated* as accounting corruption, not just acceptance of odd input | P1 holds, evidence strengthened |

## 4. Live Reproduction (v1.7.0, disposable stack :3000)

Companies A and B under the same authenticated owner (R-03 Model C — memberships; no privilege escalation involved, matching real deployments where one accountant keeps several companies).

| Step | Request | Result |
|---|---|---|
| P1 | `POST /c/A/ledgers {"groupId": <B's group>}` | **200** — accepted; ledger stored with `groupId` = B's group id |
| P2 | `POST /c/A/stock-items {"unitId": <B's unit>}` | **200** — accepted |
| P3a | `POST /c/A/pay-heads {"ledgerId": <B's ledger>}` | **200** — accepted |
| P3b | `PUT /c/A/salary-structure/:emp {"headId": <that head>}` | **200** — accepted |
| P3c | `POST /c/A/payroll/process {month}` | **200** — voucher posted, net 10,000 |
| P3d | A's Trial Balance | **Dr=0 / Cr=10,000 — UNBALANCED**, silently; only `Salary Payable Cr 10,000` visible, the Dr side landed on B's ledger |
| P3e | B's Trial Balance / ledger statement | Foreign ledger **ABSENT** from B's reports; ledger statement 404 for both companies (`ledgerVouchers` scopes the ledger by `companyId = c` first) |
| P4 | A's Balance Sheet | `difference = 10,000`, totalAssets = 0 |

**Why the money vanishes:** `ledgerBalances()` (accounting.ts:20-66) inner-joins `voucher_entries → vouchers → ledgers` filtered by `vouchers.companyId = c`. An entry in A's voucher pointing at B's ledger survives the join (the entry belongs to A's voucher), but the ledger row is B's — and `trialBalance`/`buildGroupTree` fold by the **ledger's** group membership. Net effect: the entry is counted once in neither company's tree-fold reports. A's TB lists per-ledger rows — the B-ledger row (when it has a nonzero opening/movement) would render with **B's group name**; in `buildGroupTree` the balance is **dropped entirely** (`byId.get(b.groupId)` misses A's tree → `continue`). Two different report paths disagree — the hallmark of a broken reference.

## 5. Findings

| ID | Area | Finding | Severity | Reproducible | Disposition |
|---|---|---|---|---|---|
| F-08-1 | Master CRUD + payroll | Body FK references accepted across companies: ledgers.`groupId`, stock-items.`unitId` (and stock group/category ids), pay-heads.`ledgerId`, salary-structure.`headId`. Combined with payroll processing this produces **silently unbalanced books** (proven: TB Dr=0/Cr=10,000, BS difference 10,000) | **P1** | YES | **CONFIRMED BUG → R-08 core** |
| F-08-2 | Report fold | A ledger referencing a foreign group renders in TB with the foreign group's name (ledgerBalances join is not company-scoped on groups) and is **dropped** from BS/Group-Summary tree folds — report paths disagree for the same ledger | P2 | YES (code-traced + P1/P4 evidence) | CONFIRMED — fixed by F-08-1 (valid refs make the case unreachable) |
| F-08-3 | Delete coupling | `ledgers.group_id → groups.id` is NO ACTION: B cannot delete its own group while A's ledger references it (FK 23503 → pgFriendly 400). Confusing cross-company availability coupling | P3 | Schema-evident | CONFIRMED — fixed by F-08-1 |
| F-08-4 | Voucher path | `assertTypeTx`/`assertLedgersTx`/`assertRefsTx` are fully company-scoped; groups' `parentId` validated in beforeSave; crud list/get/put/delete row-scoped; DELETE FK-protected | — | code-verified | NOT A BUG — VERIFIED (these layers are correct) |

Existing coverage: **zero** — no test anywhere posts a cross-company master reference (the audit's XGRP probe never graduated into the suite).

## 6. Affected Code (complete map)

- `server/src/routes/crud.ts` — generic POST/PUT accept arbitrary body fields; no ref validation hook exists (opts has `schema`/`beforeSave` but only groups use beforeSave).
- `server/src/routes/masters.ts` — `crud(app, "ledgers", …)` and `crud(app, "stock-items", …)` registered with no ref validation.
- `server/src/routes/payroll.ts` — `crud(app, "pay-heads", …)` no ref validation; `PUT /salary-structure/:employeeId` validates the employee but not `headId`; `POST /payroll/process` trusts `head.ledgerId` (heads are company-scoped, their ledger refs are not) and has **no** `assertLedgersTx` equivalent.
- `server/src/db/schema.ts` — `ledgers.groupId` (line 67), `stockItems.unitId` (line 149), `payHeads.ledgerId` (line 255): `.references(() => …)` with no company scoping and no `onDelete` (NO ACTION).
- Correct today (no change needed): vouchers.ts validation trio; import.ts `ensure*` helpers (create/lookup only within the importing company's transaction); groups beforeSave.

## 7. Proposed R-08 Scope (for approval — NOT implemented)

**R-08 title:** *Company-scope validation for master references (and the payroll posting path).*

1. **Central helper in crud.ts:** an `opts.refs` spec, e.g. `refs: { groupId: groups, unitId: units, ledgerId: ledgers }` — before insert/update, every provided ref id is verified to exist with `companyId = c` (single query per table, `inArray`), else **400** ("Group does not exist in this company" — 404 not required: these are validation failures, not existence leaks; matches `assertRefsTx` wording). Wire into: ledgers (`groupId`), stock-items (`unitId`, `groupId`→stockGroups, `categoryId`→stockCategories), pay-heads (`ledgerId`). Empty/null refs stay allowed where the column is nullable.
2. **salary-structure PUT:** validate each `headId` belongs to `c` (same helper or inline query — the route already validates the employee).
3. **Payroll posting belt-and-braces:** before building entries, assert every used `head.ledgerId` belongs to `c` (defense-in-depth so legacy bad pay-head rows fail loudly at posting instead of corrupting books).
4. **Schema FKs (optional, additive migration 0005):** composite-FK scoping (`FOREIGN KEY (company_id, group_id) REFERENCES groups (company_id, id)`) requires unique indexes on `(id, company_id)` per table — additive and safe, but a schema-level change. Recommend **deferring the migration**: route-level validation (1–3) closes every reachable path; the DB-level hardening can ride a later schema-task to keep R-08 minimal. To be decided by human review.
5. **Tests:** final_regression block (+~12): ledger/item/pay-head/salary-structure cross-company refs → 400 with named-master message; in-company refs still 200; payroll with a legacy foreign-ledger pay-head → 400 (belt-and-braces); FK-delete coupling assertion; a full end-to-end re-run of the probe chain asserting the corruption is impossible. Independent-engine impact: none (engine only models valid books).
6. **No migration required** for the route-level fix; no accounting-mathematics change; no client change (error messages surface through the existing master-page error banner). R-03/R-06/R-07 untouched.

**Grandfathering note:** existing books could contain cross-company refs only if someone posted them deliberately (the API allowed it silently). After the fix such rows keep working (read paths unchanged); only *new* writes are validated, and payroll fails loudly per (3) if it encounters a legacy bad row. A diagnostic SQL query will be documented in the release notes for operators to check their data.

## 8. Out of Scope

Composite-FK DB enforcement (recommended deferral, see 7.4), fixing already-corrupted books (operator action, documented), import-path changes (already safe), voucher-path changes (already safe), any report-layer workaround for F-08-2 (unreachable once refs are valid).

## 9. Final Recommendation

R-08 is confirmed at **P1** — the only remaining known path to silently unbalanced books. The fix is small, centralized in `crud.ts` + two payroll touch-points, fully covered by new regression checks, and carries no accounting-mathematics or migration burden (option 4 deferred).

**Investigation is complete. Awaiting human review and scope approval.**
