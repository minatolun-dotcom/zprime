import {
  pgTable, serial, integer, text, boolean, date, timestamp, numeric, index, uniqueIndex, jsonb,
} from "drizzle-orm/pg-core";
// (drizzle-orm/pg-core exports reviewed for R-02: no new column types needed —
// timestamp/text/integer already imported.)

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
  // Bill-wise
  billWise: boolean("bill_wise").notNull().default(false),
  // Party contact
  partyAddress: text("party_address"),
  partyState: text("party_state"),
  partyPhone: text("party_phone"),
  partyEmail: text("party_email"),
  isActive: boolean("is_active").notNull().default(true),
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
  functionKey: text("function_key"),
}, (t) => [uniqueIndex("vt_company_name_uq").on(t.companyId, t.name)]);

export const tdsSections = pgTable("tds_sections", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  section: text("section").notNull(), // 194C, 194J ...
  description: text("description"),
  rate: numeric("rate", { precision: 5, scale: 2 }).notNull().default("0"),
  threshold: numeric("threshold", { precision: 18, scale: 2 }).notNull().default("0"),
}, (t) => [uniqueIndex("tds_company_section_uq").on(t.companyId, t.section)]);

// ---------- Inventory Masters ----------
export const units = pgTable("units", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // Numbers
  symbol: text("symbol").notNull(), // Nos
  decimalPlaces: integer("decimal_places").notNull().default(0),
}, (t) => [uniqueIndex("units_company_symbol_uq").on(t.companyId, t.symbol)]);

export const stockGroups = pgTable("stock_groups", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
}, (t) => [uniqueIndex("sg_company_name_uq").on(t.companyId, t.name)]);

export const stockCategories = pgTable("stock_categories", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
}, (t) => [uniqueIndex("sc_company_name_uq").on(t.companyId, t.name)]);

export const godowns = pgTable("godowns", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
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
}, (t) => [uniqueIndex("counter_company_type_uq").on(t.companyId, t.voucherTypeId)]);

export const vouchers = pgTable("vouchers", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  voucherTypeId: integer("voucher_type_id").notNull().references(() => voucherTypes.id),
  date: date("date").notNull(),
  number: text("number").notNull(),
  reference: text("reference"),
  refDate: date("ref_date"),
  narration: text("narration").notNull().default(""),
  partyLedgerId: integer("party_ledger_id"),
  isCancelled: boolean("is_cancelled").notNull().default(false),
  // R-02 cancellation metadata (Model A: mark + exclude). R-03: now a real FK
  // to users.id — deleted users do not block voucher history (ON DELETE set
  // null). Populated from the authenticated session when available.
  cancelledBy: integer("cancelled_by").references(() => users.id, { onDelete: "set null" }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
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
  uniqueIndex("vouchers_company_type_number_uq").on(t.companyId, t.voucherTypeId, t.number),
]);

export const voucherEntries = pgTable("voucher_entries", {
  id: serial("id").primaryKey(),
  voucherId: integer("voucher_id").notNull().references(() => vouchers.id, { onDelete: "cascade" }),
  ledgerId: integer("ledger_id").notNull().references(() => ledgers.id),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(), // signed: dr +, cr -
  gstRate: numeric("gst_rate", { precision: 5, scale: 2 }), // snapshot for service lines
  hsnSac: text("hsn_sac"), // snapshot for service lines
  tdsSectionId: integer("tds_section_id"), // snapshot for TDS reporting
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
}, (t) => [uniqueIndex("emp_company_name_uq").on(t.companyId, t.name)]);

export const payHeads = pgTable("pay_heads", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull(), // earning | deduction | employer_contribution
  ledgerId: integer("ledger_id").notNull().references(() => ledgers.id),
  affectsGross: boolean("affects_gross").notNull().default(true),
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
