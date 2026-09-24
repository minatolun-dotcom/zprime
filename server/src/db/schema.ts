import { sql } from "drizzle-orm";
import {
  pgTable, serial, integer, text, boolean, date, timestamp, numeric, index, uniqueIndex, jsonb,
} from "drizzle-orm/pg-core";
// (drizzle-orm/pg-core exports reviewed for R-02: no new column types needed —
// timestamp/text/integer already imported. R-28 adds `sql` for the partial
// unique indexes that enforce submission idempotency at the DB level.)

// R-22: the R-17 actor-provance column triple, shared by the 9 master tables
// (groups, ledgers, units, stock_groups, stock_categories, godowns,
// stock_items, employees, pay_heads). Excluded: voucher_types + tds_sections
// (system-seeded at company creation, no user-facing creation surface).
// NULL = system-seeded or pre-R-22 — honest, never fabricated.
const masterActor = () => ({
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  updatedBy: integer("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
});

// ---------- Users & Companies ----------
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// R-03: user <-> company membership junction (Model C). The authorization
// boundary: a user may access a company ONLY through a membership row, checked
// server-side on every request inside cid(). role is membership metadata
// ("owner" | "accountant") — NOT an RBAC permission matrix (later feature).
export const userCompanies = pgTable(
  "user_companies",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("owner"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("user_companies_user_company_uq").on(t.userId, t.companyId), index("user_companies_company_id_idx").on(t.companyId)],
);

export const companies = pgTable("companies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  mailingName: text("mailing_name"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  stateCode: text("state_code"),
  pincode: text("pincode"),
  phone: text("phone"),
  email: text("email"),
  gstin: text("gstin"),
  financialYearStart: date("financial_year_start").notNull(), // e.g. 2025-04-01
  booksBeginFrom: date("books_begin_from").notNull(),
  // R-06 (B-01): when false (default), outward inventory movements that would
  // drive an item's chronological stock quantity negative are rejected at
  // posting. Opt-in per company for dispatch-first workflows.
  allowNegativeStock: boolean("allow_negative_stock").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- Accounting Masters ----------
export const groups = pgTable("groups", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  parentId: integer("parent_id"),
  nature: text("nature").notNull(), // Assets | Liabilities | Income | Expenses
  isReserved: boolean("is_reserved").notNull().default(false),
  affectsGross: boolean("affects_gross").notNull().default(false),
  // R-22: actor provance, stamped server-side from the verified JWT identity
  // (same shape/rule as R-17 vouchers). NULL = system-seeded or pre-R-22.
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  updatedBy: integer("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
}, (t) => [uniqueIndex("groups_company_name_uq").on(t.companyId, t.name)]);

export const ledgers = pgTable("ledgers", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  groupId: integer("group_id").notNull().references(() => groups.id),
  openingBalance: numeric("opening_balance", { precision: 18, scale: 2 }).notNull().default("0"), // dr +, cr -
  // GST
  gstin: text("gstin"),
  gstRegistrationType: text("gst_registration_type").notNull().default("none"), // regular | composition | unregistered | consumer | none
  taxability: text("taxability").notNull().default("none"), // taxable | exempt | nil | none
  hsnSac: text("hsn_sac"),
  gstRate: numeric("gst_rate", { precision: 5, scale: 2 }),
  dutyHead: text("duty_head"), // IGST | CGST | SGST | CESS (for Duties & Taxes ledgers)
  // Banking / cheque
  isBankCash: boolean("is_bank_cash").notNull().default(false),
  bankAccountNumber: text("bank_account_number"),
  chequeEnabled: boolean("cheque_enabled").notNull().default(false),
  chequePayerName: text("cheque_payer_name"),
  // TDS: expense ledger attracts TDS under section
  tdsSectionId: integer("tds_section_id"),
  // R-27: TCS — party/sale ledger attracts TCS under a section (s. 206C)
  tcsSectionId: integer("tcs_section_id"),
  // Bill-wise
  billWise: boolean("bill_wise").notNull().default(false),
  // Party contact
  partyAddress: text("party_address"),
  partyState: text("party_state"),
  // R-24: NIC v1.01 BuyerDtls mandates a PIN code; the payload validator
  // reports its absence (never guesses). Nullable — pre-R-24 rows are honest.
  partyPincode: text("party_pincode"),
  partyPhone: text("party_phone"),
  partyEmail: text("party_email"),
  isActive: boolean("is_active").notNull().default(true),
  // R-22: actor provance (R-17 pattern). NULL = pre-R-22 row (no backfill).
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  updatedBy: integer("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
}, (t) => [uniqueIndex("ledgers_company_name_uq").on(t.companyId, t.name)]);

export const voucherTypes = pgTable("voucher_types", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  shortCode: text("short_code").notNull(),
  category: text("category").notNull(), // Accounting | Inventory | Payroll
  affectsStock: boolean("affects_stock").notNull().default(false),
  numbering: text("numbering").notNull().default("automatic"), // automatic | manual
  prefix: text("prefix").notNull().default(""),
  suffix: text("suffix").notNull().default(""),
  startNumber: integer("start_number").notNull().default(1),
  // R-57 (R-55 Option B): Tally's voucher-numbering periodicity. 'never' =
  // the pre-R-57 single never-resetting counter (every existing type —
  // byte-identical behaviour); 'fiscal' = the automatic counter restarts
  // each financial year (counter is per company + type + FY of the voucher
  // date, FY-begin month from the company's stored financialYearStart).
  numberingPeriodicity: text("numbering_periodicity").notNull().default("never"), // never | fiscal
  functionKey: text("function_key"),
}, (t) => [uniqueIndex("vt_company_name_uq").on(t.companyId, t.name)]);

export const tdsSections = pgTable("tds_sections", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  section: text("section").notNull(), // 194C, 194J ...
  description: text("description"),
  rate: numeric("rate", { precision: 5, scale: 2 }).notNull().default("0"),
  threshold: numeric("threshold", { precision: 18, scale: 2 }).notNull().default("0"),
  // R-33: how the threshold legally binds — 'single' (per payment, e.g. 194C's
  // ₹30k-per-payment leg), 'aggregate' (per payee per FY, e.g. 194J's ₹50k),
  // null = advisory wording only. NEVER used to block a voucher (R-33 Option A:
  // advisories are honest nudges; the operator judges; the books record).
  thresholdMode: text("threshold_mode"),
}, (t) => [uniqueIndex("tds_company_section_uq").on(t.companyId, t.section)]);

// R-27: TCS sections (Income-tax s. 206C) — mirror of tds_sections. Rates
// genuinely vary (0.1% under 206C(1H), 1% scrap/minerals, higher without PAN),
// so the operator defines them per company; threshold is stored as report
// reference data, never enforced (same operator-judgment posture as TDS).
export const tcsSections = pgTable("tcs_sections", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  section: text("section").notNull(), // 206C(1), 206C(1H) ...
  description: text("description"),
  rate: numeric("rate", { precision: 5, scale: 2 }).notNull().default("0"),
  threshold: numeric("threshold", { precision: 18, scale: 2 }).notNull().default("0"),
  // R-33: same advisory-only mode field as tds_sections (see above).
  thresholdMode: text("threshold_mode"),
}, (t) => [uniqueIndex("tcs_company_section_uq").on(t.companyId, t.section)]);

// ---------- Inventory Masters ----------
export const units = pgTable("units", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // Numbers
  symbol: text("symbol").notNull(), // Nos
  decimalPlaces: integer("decimal_places").notNull().default(0),
  ...masterActor(),
}, (t) => [uniqueIndex("units_company_symbol_uq").on(t.companyId, t.symbol)]);

export const stockGroups = pgTable("stock_groups", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  ...masterActor(),
}, (t) => [uniqueIndex("sg_company_name_uq").on(t.companyId, t.name)]);

export const stockCategories = pgTable("stock_categories", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  ...masterActor(),
}, (t) => [uniqueIndex("sc_company_name_uq").on(t.companyId, t.name)]);

export const godowns = pgTable("godowns", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  ...masterActor(),
}, (t) => [uniqueIndex("godown_company_name_uq").on(t.companyId, t.name)]);

export const stockItems = pgTable("stock_items", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  groupId: integer("group_id"),
  categoryId: integer("category_id"),
  unitId: integer("unit_id").notNull().references(() => units.id),
  hsnSac: text("hsn_sac"),
  gstRate: numeric("gst_rate", { precision: 5, scale: 2 }).notNull().default("18"),
  taxability: text("taxability").notNull().default("taxable"),
  costingMethod: text("costing_method").notNull().default("weighted_avg"), // weighted_avg | fifo
  openingQty: numeric("opening_qty", { precision: 18, scale: 4 }).notNull().default("0"),
  openingRate: numeric("opening_rate", { precision: 18, scale: 4 }).notNull().default("0"),
  openingValue: numeric("opening_value", { precision: 18, scale: 2 }).notNull().default("0"),
  standardSalePrice: numeric("standard_sale_price", { precision: 18, scale: 4 }).notNull().default("0"),
  standardCost: numeric("standard_cost", { precision: 18, scale: 4 }).notNull().default("0"),
  minQty: numeric("min_qty", { precision: 18, scale: 4 }).notNull().default("0"),
  ...masterActor(),
}, (t) => [uniqueIndex("item_company_name_uq").on(t.companyId, t.name)]);

// ---------- Vouchers ----------
// Per (company, voucherType) number counter for atomic voucher numbering.
// nextSeq() advances the row with UPDATE ... RETURNING so concurrent writers
// can never draw the same number. Deletion never rewinds it.
export const voucherCounters = pgTable("voucher_counters", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  voucherTypeId: integer("voucher_type_id").notNull().references(() => voucherTypes.id, { onDelete: "cascade" }),
  lastNumber: integer("last_number").notNull().default(0),
  // R-57: FY key (fiscal-year BEGIN date) for periodicity 'fiscal' counters —
  // one row per (company, type, FY), so each year restarts at startNumber.
  // '' for 'never' types (the classic single counter). NOT NULL is load-bearing:
  // a NULL bucket would make the unique index treat every counter row as
  // distinct (SQL: NULL != NULL) and split the never-series across rows.
  fy: text("fy").notNull().default(""),
}, (t) => [uniqueIndex("counter_company_type_fy_uq").on(t.companyId, t.voucherTypeId, t.fy)]);

export const vouchers = pgTable("vouchers", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  voucherTypeId: integer("voucher_type_id").notNull().references(() => voucherTypes.id),
  date: date("date").notNull(),
  number: text("number").notNull(),
  // R-57: FY key (fiscal-year BEGIN date) this voucher belongs to — stamped
  // on every API/import write; the number-uniqueness index is scoped to it.
  // '' = 'never'-periodicity series (the classic single counter, pre-R-57
  // rows included — their old (company, type, number) uniqueness guarantees
  // they cannot collide once folded into that bucket).
  fy: text("fy").notNull().default(""),
  reference: text("reference"),
  refDate: date("ref_date"),
  narration: text("narration").notNull().default(""),
  partyLedgerId: integer("party_ledger_id"),
  // R-23: reverse charge — the RECIPIENT self-accounts the GST on this inward
  // (s. 9(3)/9(4)). Marked per-transaction, not per-supplier (one supplier can
  // mix regular goods and RCM services). Default false: every existing voucher
  // is honestly regular-charge; RCM vouchers post their self-assessed duty on
  // a dutyHead='RCM' ledger, which the GSTR-3B classifies into Table 4(A)(3).
  isRcm: boolean("is_rcm").notNull().default(false),
  isCancelled: boolean("is_cancelled").notNull().default(false),
  // R-02 cancellation metadata (Model A: mark + exclude). R-03: now a real FK
  // to users.id — deleted users do not block voucher history (ON DELETE set
  // null). Populated from the authenticated session when available.
  cancelledBy: integer("cancelled_by").references(() => users.id, { onDelete: "set null" }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  // R-17: audit-trail groundwork — actor provance, stamped server-side from
  // the verified JWT identity on every write path (manual, import, edit).
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  updatedBy: integer("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
  cancelReason: text("cancel_reason"),
  source: text("source").notNull().default("manual"), // manual | import | payroll
  chequeNumber: text("cheque_number"),
  chequeDate: date("cheque_date"),
  placeOfSupply: text("place_of_supply"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("vouchers_company_date_idx").on(t.companyId, t.date),
  index("vouchers_type_idx").on(t.voucherTypeId),
  // Database is the final authority: duplicate numbers within a company+voucher
  // type are impossible (across concurrent writes, manual or automatic numbering).
  // R-57: uniqueness gains the fy dimension — two FYs can each restart at 1.
  // NULL-fy (legacy) rows are exempt from unique enforcement by SQL rule.
  uniqueIndex("vouchers_company_type_fy_number_uq").on(t.companyId, t.voucherTypeId, t.fy, t.number),
]);

// R-18: full audit feature — append-only voucher event log. One row per
// lifecycle transition (create | edit | cancel | uncancel | delete), written
// in the SAME transaction as the state change (an event exists iff the change
// committed). voucherId is nullable + ON DELETE set null: a hard delete must
// not erase its own trail — history detaches and the terminal delete event
// (with its snapshot) survives. No backfill: pre-R-18 vouchers honestly show
// an empty history.
export const auditEvents = pgTable(
  "audit_events",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    voucherId: integer("voucher_id").references(() => vouchers.id, { onDelete: "set null" }),
    actorId: integer("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(), // create | edit | cancel | uncancel | delete
    detail: text("detail"), // cancel reason; delete snapshot; NULL otherwise
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_events_company_voucher_idx").on(t.companyId, t.voucherId), index("audit_events_company_created_idx").on(t.companyId, t.createdAt)],
);

// R-10 (B-10): server-side idempotency for voucher creation. A client-generated
// key identifies one business event; replaying it returns the ORIGINAL voucher
// instead of posting a duplicate. Company-scoped, one row per accepted event;
// the key row is written in the SAME transaction as the voucher insert.
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    voucherId: integer("voucher_id").notNull().references(() => vouchers.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("idempotency_keys_company_key_uq").on(t.companyId, t.key)],
);

export const voucherEntries = pgTable("voucher_entries", {
  id: serial("id").primaryKey(),
  voucherId: integer("voucher_id").notNull().references(() => vouchers.id, { onDelete: "cascade" }),
  ledgerId: integer("ledger_id").notNull().references(() => ledgers.id),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(), // signed: dr +, cr -
  gstRate: numeric("gst_rate", { precision: 5, scale: 2 }), // snapshot for service lines
  hsnSac: text("hsn_sac"), // snapshot for service lines
  tdsSectionId: integer("tds_section_id"), // snapshot for TDS reporting
  tcsSectionId: integer("tcs_section_id"), // snapshot for TCS reporting (R-27)
  order: integer("order").notNull().default(0),
}, (t) => [index("entries_voucher_idx").on(t.voucherId), index("entries_ledger_idx").on(t.ledgerId)]);

export const billAllocations = pgTable("bill_allocations", {
  id: serial("id").primaryKey(),
  entryId: integer("entry_id").notNull().references(() => voucherEntries.id, { onDelete: "cascade" }),
  billType: text("bill_type").notNull(), // new_ref | against_ref | advance | on_account
  billName: text("bill_name").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(), // signed
  dueDate: date("due_date"),
}, (t) => [index("bills_entry_idx").on(t.entryId)]);

export const inventoryEntries = pgTable("inventory_entries", {
  id: serial("id").primaryKey(),
  voucherId: integer("voucher_id").notNull().references(() => vouchers.id, { onDelete: "cascade" }),
  itemId: integer("item_id").notNull().references(() => stockItems.id),
  godownId: integer("godown_id"),
  qty: numeric("qty", { precision: 18, scale: 4 }).notNull(), // signed: in +, out -
  rate: numeric("rate", { precision: 18, scale: 4 }).notNull().default("0"),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull().default("0"),
  kind: text("kind").notNull().default("stock"), // stock | source (consumption) | target (production)
  hsnSac: text("hsn_sac"),
  gstRate: numeric("gst_rate", { precision: 5, scale: 2 }),
  order: integer("order").notNull().default(0),
}, (t) => [index("inv_voucher_idx").on(t.voucherId), index("inv_item_idx").on(t.itemId)]);

// ---------- Payroll ----------
export const employees = pgTable("employees", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  designation: text("designation"),
  joinDate: date("join_date"),
  pan: text("pan"),
  bankName: text("bank_name"),
  bankAccount: text("bank_account"),
  isActive: boolean("is_active").notNull().default(true),
  ...masterActor(),
}, (t) => [uniqueIndex("emp_company_name_uq").on(t.companyId, t.name)]);

export const payHeads = pgTable("pay_heads", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull(), // earning | deduction | employer_contribution
  ledgerId: integer("ledger_id").notNull().references(() => ledgers.id),
  affectsGross: boolean("affects_gross").notNull().default(true),
  ...masterActor(),
}, (t) => [uniqueIndex("ph_company_name_uq").on(t.companyId, t.name)]);

export const salaryStructures = pgTable("salary_structures", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  headId: integer("head_id").notNull().references(() => payHeads.id, { onDelete: "cascade" }),
  monthlyAmount: numeric("monthly_amount", { precision: 18, scale: 2 }).notNull().default("0"),
}, (t) => [uniqueIndex("ss_emp_head_uq").on(t.employeeId, t.headId)]);

export const payslips = pgTable("payslips", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  voucherId: integer("voucher_id").notNull().references(() => vouchers.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  month: text("month").notNull(), // YYYY-MM
  lines: jsonb("lines").notNull(), // [{headName, type, amount}]
  gross: numeric("gross", { precision: 18, scale: 2 }).notNull(),
  deductions: numeric("deductions", { precision: 18, scale: 2 }).notNull(),
  net: numeric("net", { precision: 18, scale: 2 }).notNull(),
}, (t) => [uniqueIndex("pslip_emp_month_uq").on(t.employeeId, t.month)]);

// ---------- R-28: IRP/EWB connectivity (opt-in) ----------
// Per-company NIC IRP/EWB API credentials. Secrets are stored AES-256-GCM
// encrypted at rest (lib/crypto.ts; key from the IRP_ENC_KEY env — the boot
// path refuses to run if encrypted rows exist and the key is missing/invalid,
// the R-09 fail-fast posture). Reads are masked: plaintext secrets never
// leave the server. AppKey material is deliberately NOT stored — a fresh
// 32-byte key is generated per auth session (the SEK it unlocks dies with
// the 6h token, so nothing long-lived depends on it).
// R-29: verbatim ledger of EWB lifecycle operations (vehicle update, validity
// extension, cancellation) against an accepted e-way bill submission. One row
// per attempted op — the R-28 legal posture (persist verbatim, never delete)
// extended to the ops surface. Request/response JSONB are the exact NIC wire
// shapes as seen by zprime (post-encryption-decryption).
export const irpEwbOps = pgTable("irp_ewb_ops", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  submissionId: integer("submission_id").references(() => irpSubmissions.id, { onDelete: "cascade" }),
  op: text("op").notNull(), // vehewb | extend | cancel
  request: jsonb("request"), // what zprime sent to the NIC action (plaintext payload)
  response: jsonb("response"), // decrypted NIC response, verbatim
  error: jsonb("error"), // IRP ErrorDetails or transport message on failure
  requestedBy: integer("requested_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("irp_ewb_ops_submission_idx").on(t.submissionId, t.createdAt),
]);

export const irpCredentials = pgTable("irp_credentials", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  environment: text("environment").notNull().default("sandbox"), // sandbox | production
  clientId: text("client_id").notNull(),
  clientSecretEnc: text("client_secret_enc").notNull(), // base64(nonce+tag+ciphertext), GCM
  gstin: text("gstin").notNull(),
  username: text("username").notNull(),
  passwordEnc: text("password_enc").notNull(),
  // R-30: direct e-way bill generation rides the NIC EWB-API (a SEPARATE
  // portal from the e-invoice IRP, with its own credentials — the taxpayer's
  // ewaybillgst.gov.in username/password). Nullable: absent = EWB-from-IRN
  // only (B2B); present = direct GENEWB also available (B2C). Same GCM
  // at-rest encryption as the IRP secrets.
  ewbUsername: text("ewb_username"),
  ewbPasswordEnc: text("ewb_password_enc"),
  // NIC publishes per-environment public keys (portal download). Operators
  // paste the PEM here (or set IRP_NIC_PUBLIC_KEY env as a default). Never
  // hardcoded in source.
  publicKeyPem: text("public_key_pem"),
  // Base-URL override for mock/test IRPs (CI) and self-hosted adapters.
  endpointOverride: text("endpoint_override"),
  ...masterActor(),
}, (t) => [uniqueIndex("irp_creds_company_env_uq").on(t.companyId, t.environment)]);

// Submission ledger — the legal record ("an invoice without IRN will not be
// a legal document"). IRP responses are stored VERBATIM (decrypted JSON as
// received); accepted rows are never deleted by the application. Lifecycle:
// pending → accepted | rejected | error. Two PARTIAL unique indexes enforce
// idempotency at the DB level: at most one accepted and at most one pending
// row per (voucher, kind) — a concurrent second submit loses on the insert
// (no second network call), while rejected/error rows release the slot so
// the operator can retry with history intact.
export const irpSubmissions = pgTable("irp_submissions", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  voucherId: integer("voucher_id").references(() => vouchers.id, { onDelete: "set null" }),
  kind: text("kind").notNull(), // e-invoice | ewaybill
  status: text("status").notNull(), // pending | accepted | rejected | error | cancelled (R-29: cancelled = EWB cancelled on the NIC; row retained verbatim)
  irn: text("irn"),
  ackNo: text("ack_no"),
  ackDate: text("ack_date"),
  ewbNo: text("ewb_no"),
  ewbValidUntil: text("ewb_valid_until"),
  response: jsonb("response"), // decrypted IRP response, verbatim
  error: jsonb("error"), // IRP ErrorDetails or transport message
  requestedBy: integer("requested_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("irp_subs_company_created_idx").on(t.companyId, t.createdAt),
  uniqueIndex("irp_subs_accepted_uq").on(t.voucherId, t.kind).where(sql`status = 'accepted'`),
  uniqueIndex("irp_subs_pending_uq").on(t.voucherId, t.kind).where(sql`status = 'pending'`),
]);
