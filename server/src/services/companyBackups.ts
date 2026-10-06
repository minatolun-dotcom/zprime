// R-88: per-company (manual) backup/restore — scoped to one company_id.
//
// A company backup is a SQL artifact of ONLY that company's rows (every
// company-scoped table, filtered to the chosen cid), gzipped, sha256'd, paired
// with a manifest whose scope = { kind: "company", cid, name }, and uploaded as
// a dump+manifest pair into the SAME shared Drive folder the deployment backup
// uses. A company restore downloads the pair, verifies sha256, and applies it
// SCOPED to that cid into the EXISTING app database — other companies are never
// touched. The existing deployment backup/restore, connect/disconnect, settings,
// and scheduler are untouched.
//
// Restorative dependency order (mirrors the order company creation + import use):
//   1. companies (cid)               — everything else FKs into it
//   2. groups
//   3. voucherTypes
//   4. tdsSections
//   5. tcsSections
//   6. units
//   7. stockGroups
//   8. stockCategories
//   9. godowns
//  10. stockItems                    — unitId FK
//  11. employees
//  12. cost_categories
//  13. cost_centres                 — categoryId FK
//  14. ledgers                      — groupId FK
//  15. pay_heads                    — ledgerId FK (must follow ledgers)
//  16. salary_structures            — employeeId + headId FKs
//  17. voucherCounters              — voucherTypeId FK (company+type+fy)
//  18. vouchers                     — voucherTypeId FK
//  19. voucherEntries               — voucherId + ledgerId FKs
//  20. billAllocations              — entryId FK
//  21. voucherCostAllocations       — entryId + costCentreId FKs
//  22. inventoryEntries             — voucherId + itemId (+godownId) FKs
//  23. payslips                     — voucherId + employeeId FKs
//  24. audit_events                 — companyId (+voucherId/actorId) FKs
//  25. idempotency_keys             — companyId + voucherId FKs
//  26. irp_submissions              — companyId (+voucherId) FKs
//  27. irp_ewb_ops                  — companyId + submissionId FKs
//
// Excluded from a company artifact (deployment data): users, user_companies,
// backup_settings, backup_runs (the deployment audit trail — never part of a
// company's accounting estate; company-scoped run rows are written live AFTER a
// company backup completes, not bundled into the artifact).
//
// No shell: every child process uses execFile/spawn with an args array; the DB
// password travels only via the child's PGPASSWORD env (same posture as the
// deployment restore path).

import { spawn } from "node:child_process";
import type { Writable } from "node:stream";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "../db/index.js";
import {
  backupRuns, companies, groups, ledgers, voucherTypes, tdsSections, tcsSections,
  units, stockGroups, stockCategories, godowns, stockItems, employees, payHeads,
  salaryStructures, costCategories, costCentres, vouchers, voucherEntries,
  billAllocations, inventoryEntries, voucherCostAllocations, auditEvents,
  idempotencyKeys, payslips, irpSubmissions, irpEwbOps, voucherCounters,
} from "../db/schema.js";
import { eq, asc } from "drizzle-orm";
import * as drive from "../lib/gdrive.js";
import { driveCreds, pruneRemote, getSettings, isInFlight, setInFlight } from "./backups.js";


// ---- company-scoped table set, in restorative dependency order ----

interface TableDef {
  name: string;            // SQL table name (quoted)
  columns: string[];       // column names (quoted) — the COPY column list
  // rows for the chosen cid, each row = array of raw column values (one per
  // column); encoded to COPY text format by copyLit() below.
  fetch: (cid: number) => Promise<unknown[][]>;
}

/** Encode one value as a COPY text-format field (PG "text" COPY encoding):
 *  null → \\N; numbers/booleans plainly; strings with every backslash, tab,
 *  newline and CR backslash-escaped; jsonb as its JSON text (stringified first,
 *  so an object column never degrades to "[object Object]"); Date as ISO-8601.
 *  NOT SQL-literal syntax: inside COPY FROM stdin, quotes are ordinary data and
 *  the bare word NULL would load as the 4-char string "NULL", not as SQL NULL.
 *  Round-trips exactly with copyUnlit(): encoder escapes every backslash, so a
 *  field that reads exactly \\N is unambiguously a null.
 */
function copyLit(v: unknown): string {
  if (v == null) return "\\N";
  let s: string;
  if (typeof v === "number") {
    if (Number.isNaN(v) || !Number.isFinite(v)) return "\\N";
    s = String(v);
  } else if (typeof v === "boolean") {
    s = v ? "true" : "false";
  } else if (typeof v === "bigint") {
    s = String(v);
  } else if (v instanceof Date) {
    s = v.toISOString();
  } else if (typeof v === "object") {
    s = JSON.stringify(v) ?? "\\N"; // jsonb/json columns (drizzle hands back objects)
  } else {
    s = String(v);
  }
  return s.replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

/** Decode one COPY text-format field back to its string form (the inverse of
 *  copyLit's escaping; used only by the companies in-place UPDATE, which must
 *  re-emit values as SQL literals rather than feed COPY back). \\N ⇒ null.
 */
function copyUnlit(f: string): string | null {
  if (f === "\\N") return null;
  let out = "";
  for (let i = 0; i < f.length; i++) {
    const ch = f[i];
    if (ch === "\\" && i + 1 < f.length) {
      const n = f[++i];
      if (n === "n") out += "\n";
      else if (n === "r") out += "\r";
      else if (n === "t") out += "\t";
      else if (n === "b") out += "\b";
      else if (n === "f") out += "\f";
      else out += n; // \\ → backslash, \v → v, or an escaped non-control char
    } else {
      out += ch;
    }
  }
  return out;
}

async function tableRows(table: TableDef, cid: number): Promise<string[]> {
  const rows = await table.fetch(cid);
  return rows.map((cols) => table.columns.map((_, i) => copyLit(cols[i])).join("\t"));
}

const COMPANY_TABLES: TableDef[] = [
  {
    name: "\"companies\"",
    columns: ["id","name","mailing_name","address","city","state","state_code","pincode","phone","email","gstin","financial_year_start","books_begin_from","allow_negative_stock","created_at"],
    fetch: async (cid) => {
      const rows = await db.select().from(companies).where(eq(companies.id, cid));
      return rows.map((r) => [r.id, r.name, r.mailingName, r.address, r.city, r.state, r.stateCode, r.pincode, r.phone, r.email, r.gstin, r.financialYearStart, r.booksBeginFrom, r.allowNegativeStock ? true : false, r.createdAt]);
    },
  },
  {
    name: "\"groups\"",
    columns: ["id","company_id","name","parent_id","nature","is_reserved","affects_gross","created_by","updated_by","updated_at"],
    fetch: async (cid) => {
      const rows = await db.select().from(groups).where(eq(groups.companyId, cid)).orderBy(asc(groups.id));
      return rows.map((r) => [r.id, r.companyId, r.name, r.parentId, r.nature, r.isReserved ? true : false, r.affectsGross ? true : false, r.createdBy, r.updatedBy, r.updatedAt]);
    },
  },
  {
    name: "\"voucher_types\"",
    columns: ["id","company_id","name","short_code","category","affects_stock","numbering","prefix","suffix","start_number","numbering_periodicity","allow_zero_value_entries","function_key"],
    fetch: async (cid) => {
      const rows = await db.select().from(voucherTypes).where(eq(voucherTypes.companyId, cid)).orderBy(asc(voucherTypes.id));
      return rows.map((r) => [r.id, r.companyId, r.name, r.shortCode, r.category, r.affectsStock ? true : false, r.numbering, r.prefix, r.suffix, r.startNumber, r.numberingPeriodicity, r.allowZeroValueEntries ? true : false, r.functionKey]);
    },
  },
  {
    name: "\"tds_sections\"",
    columns: ["id","company_id","section","description","rate","threshold","threshold_mode"],
    fetch: async (cid) => {
      const rows = await db.select().from(tdsSections).where(eq(tdsSections.companyId, cid)).orderBy(asc(tdsSections.id));
      return rows.map((r) => [r.id, r.companyId, r.section, r.description, r.rate, r.threshold, r.thresholdMode]);
    },
  },
  {
    name: "\"tcs_sections\"",
    columns: ["id","company_id","section","description","rate","threshold","threshold_mode"],
    fetch: async (cid) => {
      const rows = await db.select().from(tcsSections).where(eq(tcsSections.companyId, cid)).orderBy(asc(tcsSections.id));
      return rows.map((r) => [r.id, r.companyId, r.section, r.description, r.rate, r.threshold, r.thresholdMode]);
    },
  },
  {
    name: "\"units\"",
    columns: ["id","company_id","name","symbol","decimal_places","created_by","updated_by","updated_at"],
    fetch: async (cid) => {
      const rows = await db.select().from(units).where(eq(units.companyId, cid)).orderBy(asc(units.id));
      return rows.map((r) => [r.id, r.companyId, r.name, r.symbol, r.decimalPlaces, r.createdBy, r.updatedBy, r.updatedAt]);
    },
  },
  {
    name: "\"stock_groups\"",
    columns: ["id","company_id","name","created_by","updated_by","updated_at"],
    fetch: async (cid) => {
      const rows = await db.select().from(stockGroups).where(eq(stockGroups.companyId, cid)).orderBy(asc(stockGroups.id));
      return rows.map((r) => [r.id, r.companyId, r.name, r.createdBy, r.updatedBy, r.updatedAt]);
    },
  },
  {
    name: "\"stock_categories\"",
    columns: ["id","company_id","name","created_by","updated_by","updated_at"],
    fetch: async (cid) => {
      const rows = await db.select().from(stockCategories).where(eq(stockCategories.companyId, cid)).orderBy(asc(stockCategories.id));
      return rows.map((r) => [r.id, r.companyId, r.name, r.createdBy, r.updatedBy, r.updatedAt]);
    },
  },
  {
    name: "\"godowns\"",
    columns: ["id","company_id","name","created_by","updated_by","updated_at"],
    fetch: async (cid) => {
      const rows = await db.select().from(godowns).where(eq(godowns.companyId, cid)).orderBy(asc(godowns.id));
      return rows.map((r) => [r.id, r.companyId, r.name, r.createdBy, r.updatedBy, r.updatedAt]);
    },
  },
  {
    name: "\"stock_items\"",
    columns: ["id","company_id","name","group_id","category_id","unit_id","hsn_sac","gst_rate","taxability","costing_method","opening_qty","opening_rate","opening_value","standard_sale_price","standard_cost","min_qty","created_by","updated_by","updated_at"],
    fetch: async (cid) => {
      const rows = await db.select().from(stockItems).where(eq(stockItems.companyId, cid)).orderBy(asc(stockItems.id));
      return rows.map((r) => [r.id, r.companyId, r.name, r.groupId, r.categoryId, r.unitId, r.hsnSac, r.gstRate, r.taxability, r.costingMethod, r.openingQty, r.openingRate, r.openingValue, r.standardSalePrice, r.standardCost, r.minQty, r.createdBy, r.updatedBy, r.updatedAt]);
    },
  },
  {
    name: "\"employees\"",
    columns: ["id","company_id","name","designation","join_date","pan","bank_name","bank_account","is_active","created_by","updated_by","updated_at"],
    fetch: async (cid) => {
      const rows = await db.select().from(employees).where(eq(employees.companyId, cid)).orderBy(asc(employees.id));
      return rows.map((r) => [r.id, r.companyId, r.name, r.designation, r.joinDate, r.pan, r.bankName, r.bankAccount, r.isActive ? true : false, r.createdBy, r.updatedBy, r.updatedAt]);
    },
  },
  {
    name: "\"cost_categories\"",
    columns: ["id","company_id","name","created_by","updated_by","updated_at"],
    fetch: async (cid) => {
      const rows = await db.select().from(costCategories).where(eq(costCategories.companyId, cid)).orderBy(asc(costCategories.id));
      return rows.map((r) => [r.id, r.companyId, r.name, r.createdBy, r.updatedBy, r.updatedAt]);
    },
  },
  {
    name: "\"cost_centres\"",
    columns: ["id","company_id","name","category_id","created_by","updated_by","updated_at"],
    fetch: async (cid) => {
      const rows = await db.select().from(costCentres).where(eq(costCentres.companyId, cid)).orderBy(asc(costCentres.id));
      return rows.map((r) => [r.id, r.companyId, r.name, r.categoryId, r.createdBy, r.updatedBy, r.updatedAt]);
    },
  },
  {
    name: "\"ledgers\"",
    columns: ["id","company_id","name","group_id","opening_balance","gstin","gst_registration_type","taxability","hsn_sac","gst_rate","duty_head","is_bank_cash","bank_account_number","cheque_enabled","cheque_payer_name","tds_section_id","tcs_section_id","bill_wise","track_cost_centre","party_address","party_state","party_pincode","party_phone","party_email","is_active","created_by","updated_by","updated_at"],
    fetch: async (cid) => {
      const rows = await db.select().from(ledgers).where(eq(ledgers.companyId, cid)).orderBy(asc(ledgers.id));
      return rows.map((r) => [r.id, r.companyId, r.name, r.groupId, r.openingBalance, r.gstin, r.gstRegistrationType, r.taxability, r.hsnSac, r.gstRate, r.dutyHead, r.isBankCash ? true : false, r.bankAccountNumber, r.chequeEnabled ? true : false, r.chequePayerName, r.tdsSectionId, r.tcsSectionId, r.billWise ? true : false, r.trackCostCentre ? true : false, r.partyAddress, r.partyState, r.partyPincode, r.partyPhone, r.partyEmail, r.isActive ? true : false, r.createdBy, r.updatedBy, r.updatedAt]);
    },
  },
  {
    name: "\"pay_heads\"",
    columns: ["id","company_id","name","type","ledger_id","affects_gross","created_by","updated_by","updated_at"],
    fetch: async (cid) => {
      const rows = await db.select().from(payHeads).where(eq(payHeads.companyId, cid)).orderBy(asc(payHeads.id));
      return rows.map((r) => [r.id, r.companyId, r.name, r.type, r.ledgerId, r.affectsGross ? true : false, r.createdBy, r.updatedBy, r.updatedAt]);
    },
  },
  {
    name: "\"salary_structures\"",
    columns: ["id","company_id","employee_id","head_id","monthly_amount"],
    fetch: async (cid) => {
      const rows = await db.select().from(salaryStructures).where(eq(salaryStructures.companyId, cid)).orderBy(asc(salaryStructures.id));
      return rows.map((r) => [r.id, r.companyId, r.employeeId, r.headId, r.monthlyAmount]);
    },
  },
  {
    name: "\"voucher_counters\"",
    columns: ["id","company_id","voucher_type_id","last_number","fy"],
    fetch: async (cid) => {
      const rows = await db.select().from(voucherCounters).where(eq(voucherCounters.companyId, cid)).orderBy(asc(voucherCounters.id));
      return rows.map((r) => [r.id, r.companyId, r.voucherTypeId, r.lastNumber, r.fy]);
    },
  },
  {
    name: "\"vouchers\"",
    columns: ["id","company_id","voucher_type_id","date","number","fy","reference","ref_date","narration","party_ledger_id","is_optional","bank_txn_type","reconciled_at","is_rcm","is_cancelled","cancelled_by","cancelled_at","created_by","updated_by","updated_at","cancel_reason","source","cheque_number","cheque_date","bank_ref_id","is_post_dated","deposit_slip_printed_at","place_of_supply","order_voucher_id","invoice_details","created_at"],
    fetch: async (cid) => {
      const rows = await db.select().from(vouchers).where(eq(vouchers.companyId, cid)).orderBy(asc(vouchers.id));
      return rows.map((r) => [r.id, r.companyId, r.voucherTypeId, r.date, r.number, r.fy, r.reference, r.refDate, r.narration, r.partyLedgerId, r.isOptional ? true : false, r.bankTxnType, r.reconciledAt, r.isRcm ? true : false, r.isCancelled ? true : false, r.cancelledBy, r.cancelledAt, r.createdBy, r.updatedBy, r.updatedAt, r.cancelReason, r.source, r.chequeNumber, r.chequeDate, r.bankRefId, r.isPostDated ? true : false, r.depositSlipPrintedAt, r.placeOfSupply, r.orderVoucherId, r.invoiceDetails, r.createdAt]);
    },
  },
  {
    name: "\"voucher_entries\"",
    columns: ["id","voucher_id","ledger_id","amount","gst_rate","hsn_sac","tds_section_id","tcs_section_id","narration","order"],
    fetch: async (cid) => {
      const rows = await db.select().from(voucherEntries).innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id)).where(eq(vouchers.companyId, cid)).orderBy(asc(voucherEntries.id));
      return rows.map((r) => [r.voucher_entries.id, r.voucher_entries.voucherId, r.voucher_entries.ledgerId, r.voucher_entries.amount, r.voucher_entries.gstRate, r.voucher_entries.hsnSac, r.voucher_entries.tdsSectionId, r.voucher_entries.tcsSectionId, r.voucher_entries.narration, r.voucher_entries.order]);
    },
  },
  {
    name: "\"bill_allocations\"",
    columns: ["id","entry_id","bill_type","bill_name","amount","due_date"],
    fetch: async (cid) => {
      const rows = await db.select().from(billAllocations).innerJoin(voucherEntries, eq(billAllocations.entryId, voucherEntries.id)).innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id)).where(eq(vouchers.companyId, cid)).orderBy(asc(billAllocations.id));
      return rows.map((r) => [r.bill_allocations.id, r.bill_allocations.entryId, r.bill_allocations.billType, r.bill_allocations.billName, r.bill_allocations.amount, r.bill_allocations.dueDate]);
    },
  },
  {
    name: "\"voucher_cost_allocations\"",
    columns: ["id","entry_id","cost_centre_id","amount"],
    fetch: async (cid) => {
      const rows = await db.select().from(voucherCostAllocations).innerJoin(voucherEntries, eq(voucherCostAllocations.entryId, voucherEntries.id)).innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id)).where(eq(vouchers.companyId, cid)).orderBy(asc(voucherCostAllocations.id));
      return rows.map((r) => [r.voucher_cost_allocations.id, r.voucher_cost_allocations.entryId, r.voucher_cost_allocations.costCentreId, r.voucher_cost_allocations.amount]);
    },
  },
  {
    name: "\"inventory_entries\"",
    columns: ["id","voucher_id","item_id","godown_id","qty","rate","amount","kind","hsn_sac","gst_rate","discount_pct","order"],
    fetch: async (cid) => {
      const rows = await db.select().from(inventoryEntries).innerJoin(vouchers, eq(inventoryEntries.voucherId, vouchers.id)).where(eq(vouchers.companyId, cid)).orderBy(asc(inventoryEntries.id));
      return rows.map((r) => [r.inventory_entries.id, r.inventory_entries.voucherId, r.inventory_entries.itemId, r.inventory_entries.godownId, r.inventory_entries.qty, r.inventory_entries.rate, r.inventory_entries.amount, r.inventory_entries.kind, r.inventory_entries.hsnSac, r.inventory_entries.gstRate, r.inventory_entries.discountPct, r.inventory_entries.order]);
    },
  },
  {
    name: "\"payslips\"",
    columns: ["id","company_id","voucher_id","employee_id","month","lines","gross","deductions","net"],
    fetch: async (cid) => {
      const rows = await db.select().from(payslips).where(eq(payslips.companyId, cid)).orderBy(asc(payslips.id));
      return rows.map((r) => [r.id, r.companyId, r.voucherId, r.employeeId, r.month, r.lines, r.gross, r.deductions, r.net]);
    },
  },
  {
    name: "\"audit_events\"",
    columns: ["id","company_id","voucher_id","actor_id","action","detail","created_at"],
    fetch: async (cid) => {
      const rows = await db.select().from(auditEvents).where(eq(auditEvents.companyId, cid)).orderBy(asc(auditEvents.id));
      return rows.map((r) => [r.id, r.companyId, r.voucherId, r.actorId, r.action, r.detail, r.createdAt]);
    },
  },
  {
    name: "\"idempotency_keys\"",
    columns: ["id","company_id","key","voucher_id","created_at"],
    fetch: async (cid) => {
      const rows = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.companyId, cid)).orderBy(asc(idempotencyKeys.id));
      return rows.map((r) => [r.id, r.companyId, r.key, r.voucherId, r.createdAt]);
    },
  },
  {
    name: "\"irp_submissions\"",
    columns: ["id","company_id","voucher_id","kind","status","irn","ack_no","ack_date","signed_qr_code","signed_invoice","ewb_no","ewb_valid_until","response","error","requested_by","created_at"],
    fetch: async (cid) => {
      const rows = await db.select().from(irpSubmissions).where(eq(irpSubmissions.companyId, cid)).orderBy(asc(irpSubmissions.id));
      return rows.map((r) => [r.id, r.companyId, r.voucherId, r.kind, r.status, r.irn, r.ackNo, r.ackDate, r.signedQrCode, r.signedInvoice, r.ewbNo, r.ewbValidUntil, r.response, r.error, r.requestedBy, r.createdAt]);
    },
  },
  {
    name: "\"irp_ewb_ops\"",
    columns: ["id","company_id","submission_id","op","request","response","error","requested_by","created_at"],
    fetch: async (cid) => {
      const rows = await db.select().from(irpEwbOps).where(eq(irpEwbOps.companyId, cid)).orderBy(asc(irpEwbOps.id));
      return rows.map((r) => [r.id, r.companyId, r.submissionId, r.op, r.request, r.response, r.error, r.requestedBy, r.createdAt]);
    },
  },
];

// ---- manifest scope shapes ----

export interface CompanyManifestScope {
  kind: "company";
  cid: number;
  name: string;
}

export interface DeploymentManifestScope {
  kind: "deployment";
}

export type BackupManifestScope = DeploymentManifestScope | CompanyManifestScope;

export interface BackupManifest {
  app: string;
  created_at: string;
  format: string;
  file: string;
  bytes: number;
  sha256: string;
  pg_dump_version?: string; // present on deployment dumps only
  scope: BackupManifestScope;
}

// ---- artifact format ----

// A company artifact's SQL text is built once at backup time and written to disk
// (gzipped) both for upload AND so the restore path can re-read the exact same
// COPY blocks from the file it downloaded. The restore path NEVER re-queries the
// live DB for the rows it is restoring — that would defeat the point of backing
// up from a point in time.
//
// Format (plain SQL, pg COPY stdin style):
//   -- zprime company backup (R-88)
//   -- scope: company, cid = <n>, name = <name>
//   -- created_at: <iso>
//   -- format: company-scoped COPY restore, gzipped
//   SET statement_timeout = 0;
//   COPY "t1" (c1, c2, ...) FROM stdin;
//   <tab-separated rows, one per line>
//   \.
//   COPY "t2" (...) FROM stdin;
//   ...
//   \.
//
// The restore parser re-extracts each COPY block by table name, in the same
// COMPANY_TABLES order, and feeds the block's rows to psql.

async function buildCompanyArtifactSql(cid: number, companyName: string): Promise<{ sql: string; tableTexts: Map<string, string> }> {
  const lines: string[] = [];
  lines.push(`-- zprime company backup (R-88)`);
  lines.push(`-- scope: company, cid = ${cid}, name = ${companyName}`);
  lines.push(`-- created_at: ${new Date().toISOString()}`);
  lines.push(`-- format: company-scoped COPY restore, gzipped`);
  lines.push(``);
  lines.push(`SET statement_timeout = 0;`);
  lines.push(``);
  const tableTexts = new Map<string, string>();
  for (const table of COMPANY_TABLES) {
    const rows = await tableRows(table, cid);
    if (rows.length === 0) {
      tableTexts.set(table.name, "");
      continue;
    }
    // COPY text format: each row is tab-separated SQL literals, the block is
    // terminated by a literal backslash-dot ("\.") on its own line. NOTE: this
    // terminator MUST be written as a plain string — in a template literal,
    // "\." is not a recognized escape and evaluates to a bare ".", which the
    // restore parser (and psql) cannot recognize as end-of-data.
    // Quote every column: "order" (voucher_entries, inventory_entries) is a
    // reserved word — a bare name breaks the COPY statement.
    lines.push(`COPY ${table.name} (${table.columns.map((c) => `"${c}"`).join(", ")}) FROM stdin;`);
    lines.push(rows.join("\n"));
    lines.push("\\.");
    tableTexts.set(table.name, rows.join("\n"));
  }
  return { sql: lines.join("\n"), tableTexts };
}

// ---- shared helpers (small, copied from the deployment engine's posture) ----

function pgTarget() {
  const u = new URL(process.env.DATABASE_URL ?? "");
  if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must be a postgres:// URL");
  }
  return {
    host: u.hostname || "db",
    port: u.port || "5432",
    user: decodeURIComponent(u.username || "zprime"),
    password: decodeURIComponent(u.password || ""),
    database: decodeURIComponent(u.pathname.replace(/^\//, "")) || "zprime",
  };
}

function childEnv(target: ReturnType<typeof pgTarget>, database = target.database): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PGHOST: target.host,
    PGPORT: target.port,
    PGUSER: target.user,
    PGPASSWORD: target.password,
    PGDATABASE: database,
    PGSSLMODE: "disable",
  };
}

// ---- company backup ----

export interface CompanyBackupInput {
  cid: number;
  companyName: string;
}

export async function runCompanyBackup(input: CompanyBackupInput, trigger: "manual", actorId: number): Promise<{ fileName: string; size: number; sha256: string; driveFileId: string }> {
  if (isInFlight()) throw new Error("A backup or restore is already running");
  setInFlight(true);
  const startedAt = new Date();
  const target = pgTarget();
  const gzPath = path.join(os.tmpdir(), `zprime-company-${crypto.randomBytes(6).toString("hex")}.sql.gz`);
  try {
    const { sql, tableTexts } = await buildCompanyArtifactSql(input.cid, input.companyName);
    const { createGzip } = await import("node:zlib");
    const gzBuf = await new Promise<Buffer>((resolve, reject) => {
      const gz = createGzip();
      const chunks: Buffer[] = [];
      gz.on("data", (c) => chunks.push(c));
      gz.on("end", () => resolve(Buffer.concat(chunks)));
      gz.on("error", reject);
      gz.write(sql);
      gz.end();
    });
    await fs.promises.writeFile(gzPath, gzBuf);

    const sha256 = crypto.createHash("sha256").update(gzBuf).digest("hex");
    const stamp = `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${crypto.randomBytes(2).toString("hex")}`;
    const safeName = input.companyName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60) || "company";
    const baseName = `zprime-${input.cid}-${safeName}-${stamp}`;
    const dumpName = `${baseName}.sql.gz`;
    const manifestName = `${baseName}.manifest.json`;
    const manifest = Buffer.from(
      JSON.stringify(
        {
          app: "zprime",
          created_at: new Date().toISOString(),
          format: "company-scoped COPY restore, gzipped",
          file: dumpName,
          bytes: gzBuf.length,
          sha256,
          scope: { kind: "company", cid: input.cid, name: input.companyName },
        },
        null,
        2,
      ),
    );

    const creds = await driveCreds();
    const folderId = await drive.ensureFolder(creds, (await getSettings()).folderName);
    const dumpFileId = await drive.uploadFile(creds, folderId, dumpName, "application/gzip", gzBuf);
    await drive.uploadFile(creds, folderId, manifestName, "application/json", manifest);

    // Shared retention prune across deployment + company pairs in the same folder
    // (shared retention_count for v1 per the approved scope).
    await pruneRemote(creds, folderId);

    const finishedAt = new Date();
    await db.insert(backupRuns).values({
      kind: "backup",
      trigger,
      status: "ok",
      startedAt,
      finishedAt,
      fileName: dumpName,
      fileSize: gzBuf.length,
      sha256,
      driveFileId: dumpFileId,
      scopeKind: "company",
      companyId: input.cid,
      actorId,
    });
    return { fileName: dumpName, size: gzBuf.length, sha256, driveFileId: dumpFileId };
  } catch (err: any) {
    await db.insert(backupRuns).values({
      kind: "backup",
      trigger,
      status: "error",
      startedAt,
      finishedAt: new Date(),
      scopeKind: "company",
      companyId: input.cid,
      error: String(err?.message ?? err).slice(0, 500),
      actorId,
    }).catch(() => undefined);
    throw err;
  } finally {
    await fs.promises.rm(gzPath, { force: true }).catch(() => undefined);
    setInFlight(false);
  }
}

// ---- company restore ----

export async function restoreCompany(baseName: string, cid: number, actorId: number): Promise<{ fileName: string; sha256: string }> {
  if (isInFlight()) throw new Error("A backup or restore is already running");
  setInFlight(true);
  const startedAt = new Date();
  const target = pgTarget();
  const gzPath = path.join(os.tmpdir(), `zprime-company-restore-${crypto.randomBytes(6).toString("hex")}.sql.gz`);
  try {
    const creds = await driveCreds();
    const folderId = await drive.ensureFolder(creds, (await getSettings()).folderName);
    const files = await drive.listFiles(creds, folderId);
    const dump = files.find((f) => f.name === `${baseName}.sql.gz`);
    const manifest = files.find((f) => f.name === `${baseName}.manifest.json`);
    if (!dump || !manifest) throw new Error("Backup pair not found in the Drive folder");
    const manifestBytes = await drive.downloadFile(creds, manifest.id);
    const meta = JSON.parse(manifestBytes.toString("utf8")) as BackupManifest;
    if (meta.scope.kind !== "company" || (meta.scope as CompanyManifestScope).cid !== cid) {
      throw new Error(`Scope mismatch: this backup is for company cid ${(meta.scope as CompanyManifestScope).cid ?? "?"}, not company ${cid}`);
    }
    if (meta.file !== dump.name || !meta.sha256) throw new Error("Manifest does not match this dump — refusing to restore");
    const dumpBytes = await drive.downloadFile(creds, dump.id);
    const actual = crypto.createHash("sha256").update(dumpBytes).digest("hex");
    if (actual !== meta.sha256) {
      throw new Error(`Integrity check FAILED (sha256 mismatch: expected ${meta.sha256.slice(0, 12)}…, got ${actual.slice(0, 12)}…) — refusing to restore`);
    }
    await fs.promises.writeFile(gzPath, dumpBytes);

    const gzData = await fs.promises.readFile(gzPath);
    const { gunzipSync } = await import("node:zlib");
    const sqlText = gunzipSync(gzData).toString("utf8");
    const filtered = sqlText.replace(/^SET transaction_timeout[^\n]*$/gm, "");
    const sqlPath = gzPath.slice(0, -3) + ".sql";
    await fs.promises.writeFile(sqlPath, filtered);

    // Apply the artifact's own COPY blocks (re-extracted from the downloaded
    // file), scoped to cid, in dependency order. Other companies are never
    // touched by construction (the artifact contains no other-cid rows and the
    // DELETE is scoped to this cid).
    await applyCompanyArtifact(target, cid, filtered, tableTextsFromSql(sqlText));

    const finishedAt = new Date();
    await db.insert(backupRuns).values({
      kind: "restore",
      trigger: "manual",
      status: "ok",
      startedAt,
      finishedAt,
      fileName: dump.name,
      fileSize: dumpBytes.length,
      sha256: meta.sha256,
      driveFileId: dump.id,
      scopeKind: "company",
      companyId: cid,
      actorId,
    });
    return { fileName: dump.name, sha256: meta.sha256 };
  } catch (err: any) {
    await db.insert(backupRuns).values({
      kind: "restore",
      trigger: "manual",
      status: "error",
      startedAt,
      finishedAt: new Date(),
      scopeKind: "company",
      companyId: cid,
      error: String(err?.message ?? err).slice(0, 500),
      actorId,
    }).catch(() => undefined);
    throw err;
  } finally {
    await fs.promises.rm(gzPath, { force: true }).catch(() => undefined);
    await fs.promises.rm(gzPath.slice(0, -3) + ".sql", { force: true }).catch(() => undefined);
    setInFlight(false);
  }
}

/** Parse the per-table COPY row-blocks out of a company artifact's SQL text.
 *  Returns a map of quoted-table-name -> tab-separated row text (empty string
 *  when the table had no rows in the artifact). Throw if the artifact is
 *  malformed (e.g. a block missing its \\.).
 */
function tableTextsFromSql(sqlText: string): Map<string, string> {
  const out = new Map<string, string>();
  // Each block:  COPY "t" (cols) FROM stdin;\n<rows>\n\.)
  const re = /^COPY ("[^"]+") \(([^)]+)\) FROM stdin;$/gm;
  let m: RegExpExecArray | null;
  let lastIdx = 0;
  while ((m = re.exec(sqlText)) !== null) {
    const tableName = m[1];
    // m[0] ends at ";" — the header line's newline is NOT consumed by $, so
    // the slice starts with it and must be stripped (a leading empty line
    // would otherwise be parsed as a one-field row, corrupting every block).
    const blockStart = m.index + m[0].length; // after the COPY header line
    const blockTail = sqlText.indexOf("\n\\.", blockStart);
    if (blockTail === -1) throw new Error(`artifact malformed: no \\. for table ${tableName}`);
    const rowsText = sqlText.slice(blockStart, blockTail).replace(/^\n/, "").replace(/\n$/, "");
    out.set(tableName, rowsText);
    lastIdx = m.index;
  }
  for (const table of COMPANY_TABLES) {
    if (!out.has(table.name)) out.set(table.name, "");
  }
  return out;
}

/** Apply a company artifact's COPY blocks, table by table in dependency order,
 *  in ONE transaction (atomic per AGENTS.md: a failed restore leaves no partial
 *  state). For every table: clear this company's rows, then COPY the artifact's
 *  rows back in. Both halves are FK-valid by construction:
 *
 *  - The DELETE half runs in REVERSE COMPANY_TABLES order (children first, so
 *    no referencing row is ever deleted after the row it references; company
 *    tables also carry cascade/no-action FKs to users/companies that never fire
 *    because delete predicates are scoped to this cid).
 *  - The COPY half runs in FORWARD COMPANY_TABLES order (parents first), and
 *    COMPANY_TABLES is ordered so every company-table FK target precedes its
 *    referencing table.
 *
 *  Tables without a company_id column: the four child tables of this company's
 *  vouchers/entries delete BY JOIN through the parent; the companies row itself
 *  is UPDATED in place from the artifact's own row (NOT deleted — a plain
 *  DELETE would cascade-wipe user_companies/members/irp_credentials, which are
 *  deployment data outside a company artifact, and would lock every member of
 *  the company out of the app; the module header documents exactly this split).
 *
 *  One psql process feeds every table's block (COPY FROM stdin needs psql on
 *  the wire anyway), with ON_ERROR_STOP=1 so any failure aborts the whole
 *  transaction. stdin is piped — with stdio "ignore" it would be null.
 */
async function applyCompanyArtifact(
  target: ReturnType<typeof pgTarget>,
  cid: number,
  _sqlText: string,
  tableTexts: Map<string, string>,
): Promise<void> {
  // Tables WITHOUT a company_id column: the four child tables of this
  // company's vouchers/entries are reached BY JOIN through the parent;
  // companies itself is updated in place (never deleted — see below).
  const DELETE_BY_JOIN: Record<string, string> = {
    "\"voucher_entries\"": `DELETE FROM "voucher_entries" WHERE voucher_id IN (SELECT v.id FROM "vouchers" v WHERE v.company_id = ${cid});`,
    "\"bill_allocations\"": `DELETE FROM "bill_allocations" WHERE entry_id IN (SELECT ve.id FROM "voucher_entries" ve JOIN "vouchers" v ON v.id = ve.voucher_id WHERE v.company_id = ${cid});`,
    "\"voucher_cost_allocations\"": `DELETE FROM "voucher_cost_allocations" WHERE entry_id IN (SELECT ve.id FROM "voucher_entries" ve JOIN "vouchers" v ON v.id = ve.voucher_id WHERE v.company_id = ${cid});`,
    "\"inventory_entries\"": `DELETE FROM "inventory_entries" WHERE voucher_id IN (SELECT v.id FROM "vouchers" v WHERE v.company_id = ${cid});`,
  };

  const statements: string[] = ["BEGIN;"];

  // DELETE half — REVERSE COMPANY_TABLES order (children first, so no
  // referencing row outlives the row it references; e.g. pay_heads → ledgers
  // is NO ACTION with a NOT NULL column and must clear before ledgers).
  for (const table of [...COMPANY_TABLES].reverse()) {
    if (table.name === "\"companies\"") continue; // updated in place below — never deleted
    statements.push(DELETE_BY_JOIN[table.name] ?? `DELETE FROM ${table.name} WHERE company_id = ${cid};`);
  }

  // COPY half — FORWARD COMPANY_TABLES order (parents first). Tables the
  // artifact stored empty were already cleared above; nothing is re-inserted.
  for (const table of COMPANY_TABLES) {
    const rowsText = tableTexts.get(table.name) ?? "";
    if (table.name === "\"companies\"") {
      // The company row is UPDATED in place from the artifact's own row: a
      // DELETE would cascade-wipe user_companies/members/irp_credentials
      // (deployment data, excluded from company artifacts by design) and lock
      // every member out of the restored company. The id is pinned to the
      // target company — scope is verified before this function runs.
      if (!rowsText) throw new Error("company artifact contains no companies row");
      const rowVals = rowsText.split("\n")[0].split("\t");
      if (rowVals.length !== table.columns.length) {
        throw new Error("company artifact companies row has the wrong column count");
      }
      // rowsText is COPY text format, not SQL literals — decode each field
      // (\\N ⇒ SQL NULL, else the unescaped string) and re-emit as SQL
      // literals for the SET list. Quote each column (reserved word "order").
      const sets = table.columns
        .map((c, i) => [c, copyUnlit(rowVals[i])] as const)
        .filter(([c]) => c !== "id")
        .map(([c, v]) => `"${c}" = ${v === null ? "NULL" : "'" + v.replace(/'/g, "''") + "'"}`)
        .join(", ");
      statements.push(`UPDATE ${table.name} SET ${sets} WHERE id = ${cid};`);
      continue;
    }
    if (!rowsText) continue;
    // Same quoting rule as the artifact writer: reserved-word columns need
    // double quotes in the COPY statement.
    statements.push(`COPY ${table.name} (${table.columns.map((c) => `"${c}"`).join(", ")}) FROM stdin;`);
    statements.push(rowsText);
    statements.push("\\.");
  }

  // Forward-only id-sequence repair. Deployment restores get this for free
  // from pg_dump's setval lines; a company artifact must carry its own. A
  // sequence left BEHIND the restored max(id) makes the next insert collide;
  // setval(..., GREATEST(...) + 1, false) positions the sequence so the next
  // nextval returns GREATEST(current, max_id) + 1 — never backward (which
  // would hand out ids owned by other companies' rows), never below minvalue.
  for (const table of COMPANY_TABLES) {
    const bare = table.name.slice(1, -1); // "\"vouchers\"" -> vouchers
    statements.push(
      `SELECT setval(pg_get_serial_sequence('${table.name}', 'id'), ` +
      `GREATEST(COALESCE((SELECT last_value FROM pg_sequences WHERE schemaname = 'public' AND sequencename = '${bare}_id_seq'), 0), ` +
      `COALESCE((SELECT MAX(id) FROM ${table.name}), 0)) + 1, false);`,
    );
  }

  statements.push("COMMIT;");
  const stdinData = statements.join("\n") + "\n";

  await new Promise<void>((resolve, reject) => {
    const proc = spawn("psql", ["-X", "-v", "ON_ERROR_STOP=1", "--quiet", "-f", "-"], {
      env: childEnv(target),
      stdio: ["pipe", "pipe", "pipe"], // stdin MUST be piped: COPY FROM stdin reads it
    });
    proc.stdout?.on("data", () => {}); // drain so a large script cannot deadlock
    let stderr = "";
    proc.stderr?.on("data", (d) => { stderr += String(d); });
    proc.on("error", (e) => reject(new Error(`psql failed: ${e.message}`)));
    proc.on("close", (code) => {
      if (code === 0) { resolve(); return; }
      console.error(`[companyBackups] restore psql stderr: ${stderr.slice(0, 2000)}`);
      const sqlstate = stderr.match(/SQLSTATE\s+(\S+)/)?.[1];
      // Response-safe message: state only — no SQL, paths, or internals.
      reject(new Error(`company restore failed${sqlstate ? ` (SQLSTATE ${sqlstate})` : ""}`));
    });
    const stdinPipe = proc.stdin as Writable | null;
    if (!stdinPipe) { reject(new Error("psql stdin unavailable")); return; }
    stdinPipe.on("error", (e) => reject(new Error(`psql stdin write failed: ${e.message}`)));
    stdinPipe.end(stdinData);
  });
}
