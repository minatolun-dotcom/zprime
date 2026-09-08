CREATE TABLE "bill_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"entry_id" integer NOT NULL,
	"bill_type" text NOT NULL,
	"bill_name" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"due_date" date
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"mailing_name" text,
	"address" text,
	"city" text,
	"state" text,
	"state_code" text,
	"pincode" text,
	"phone" text,
	"email" text,
	"gstin" text,
	"financial_year_start" date NOT NULL,
	"books_begin_from" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"name" text NOT NULL,
	"designation" text,
	"join_date" date,
	"pan" text,
	"bank_name" text,
	"bank_account" text,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "godowns" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"name" text NOT NULL,
	"parent_id" integer,
	"nature" text NOT NULL,
	"is_reserved" boolean DEFAULT false NOT NULL,
	"affects_gross" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"voucher_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"godown_id" integer,
	"qty" numeric(18, 4) NOT NULL,
	"rate" numeric(18, 4) DEFAULT '0' NOT NULL,
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"kind" text DEFAULT 'stock' NOT NULL,
	"hsn_sac" text,
	"gst_rate" numeric(5, 2),
	"order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledgers" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"name" text NOT NULL,
	"group_id" integer NOT NULL,
	"opening_balance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"gstin" text,
	"gst_registration_type" text DEFAULT 'none' NOT NULL,
	"taxability" text DEFAULT 'none' NOT NULL,
	"hsn_sac" text,
	"gst_rate" numeric(5, 2),
	"duty_head" text,
	"is_bank_cash" boolean DEFAULT false NOT NULL,
	"bank_account_number" text,
	"cheque_enabled" boolean DEFAULT false NOT NULL,
	"cheque_payer_name" text,
	"tds_section_id" integer,
	"bill_wise" boolean DEFAULT false NOT NULL,
	"party_address" text,
	"party_state" text,
	"party_phone" text,
	"party_email" text,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pay_heads" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"ledger_id" integer NOT NULL,
	"affects_gross" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payslips" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"voucher_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"month" text NOT NULL,
	"lines" jsonb NOT NULL,
	"gross" numeric(18, 2) NOT NULL,
	"deductions" numeric(18, 2) NOT NULL,
	"net" numeric(18, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salary_structures" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"head_id" integer NOT NULL,
	"monthly_amount" numeric(18, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"name" text NOT NULL,
	"group_id" integer,
	"category_id" integer,
	"unit_id" integer NOT NULL,
	"hsn_sac" text,
	"gst_rate" numeric(5, 2) DEFAULT '18' NOT NULL,
	"taxability" text DEFAULT 'taxable' NOT NULL,
	"costing_method" text DEFAULT 'weighted_avg' NOT NULL,
	"opening_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"opening_rate" numeric(18, 4) DEFAULT '0' NOT NULL,
	"opening_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"standard_sale_price" numeric(18, 4) DEFAULT '0' NOT NULL,
	"standard_cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"min_qty" numeric(18, 4) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tds_sections" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"section" text NOT NULL,
	"description" text,
	"rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"threshold" numeric(18, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"name" text NOT NULL,
	"symbol" text NOT NULL,
	"decimal_places" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "voucher_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"voucher_id" integer NOT NULL,
	"ledger_id" integer NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"gst_rate" numeric(5, 2),
	"hsn_sac" text,
	"tds_section_id" integer,
	"order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voucher_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"name" text NOT NULL,
	"short_code" text NOT NULL,
	"category" text NOT NULL,
	"affects_stock" boolean DEFAULT false NOT NULL,
	"numbering" text DEFAULT 'automatic' NOT NULL,
	"prefix" text DEFAULT '' NOT NULL,
	"suffix" text DEFAULT '' NOT NULL,
	"start_number" integer DEFAULT 1 NOT NULL,
	"function_key" text
);
--> statement-breakpoint
CREATE TABLE "vouchers" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"voucher_type_id" integer NOT NULL,
	"date" date NOT NULL,
	"number" text NOT NULL,
	"reference" text,
	"ref_date" date,
	"narration" text DEFAULT '' NOT NULL,
	"party_ledger_id" integer,
	"is_cancelled" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"cheque_number" text,
	"cheque_date" date,
	"place_of_supply" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bill_allocations" ADD CONSTRAINT "bill_allocations_entry_id_voucher_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."voucher_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "godowns" ADD CONSTRAINT "godowns_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_entries" ADD CONSTRAINT "inventory_entries_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_entries" ADD CONSTRAINT "inventory_entries_item_id_stock_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."stock_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledgers" ADD CONSTRAINT "ledgers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledgers" ADD CONSTRAINT "ledgers_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_heads" ADD CONSTRAINT "pay_heads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_heads" ADD CONSTRAINT "pay_heads_ledger_id_ledgers_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_head_id_pay_heads_id_fk" FOREIGN KEY ("head_id") REFERENCES "public"."pay_heads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_categories" ADD CONSTRAINT "stock_categories_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_groups" ADD CONSTRAINT "stock_groups_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tds_sections" ADD CONSTRAINT "tds_sections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_entries" ADD CONSTRAINT "voucher_entries_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_entries" ADD CONSTRAINT "voucher_entries_ledger_id_ledgers_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_types" ADD CONSTRAINT "voucher_types_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_voucher_type_id_voucher_types_id_fk" FOREIGN KEY ("voucher_type_id") REFERENCES "public"."voucher_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bills_entry_idx" ON "bill_allocations" USING btree ("entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "emp_company_name_uq" ON "employees" USING btree ("company_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "godown_company_name_uq" ON "godowns" USING btree ("company_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_company_name_uq" ON "groups" USING btree ("company_id","name");--> statement-breakpoint
CREATE INDEX "inv_voucher_idx" ON "inventory_entries" USING btree ("voucher_id");--> statement-breakpoint
CREATE INDEX "inv_item_idx" ON "inventory_entries" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledgers_company_name_uq" ON "ledgers" USING btree ("company_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "ph_company_name_uq" ON "pay_heads" USING btree ("company_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "pslip_emp_month_uq" ON "payslips" USING btree ("employee_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "ss_emp_head_uq" ON "salary_structures" USING btree ("employee_id","head_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sc_company_name_uq" ON "stock_categories" USING btree ("company_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "sg_company_name_uq" ON "stock_groups" USING btree ("company_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "item_company_name_uq" ON "stock_items" USING btree ("company_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "tds_company_section_uq" ON "tds_sections" USING btree ("company_id","section");--> statement-breakpoint
CREATE UNIQUE INDEX "units_company_symbol_uq" ON "units" USING btree ("company_id","symbol");--> statement-breakpoint
CREATE INDEX "entries_voucher_idx" ON "voucher_entries" USING btree ("voucher_id");--> statement-breakpoint
CREATE INDEX "entries_ledger_idx" ON "voucher_entries" USING btree ("ledger_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vt_company_name_uq" ON "voucher_types" USING btree ("company_id","name");--> statement-breakpoint
CREATE INDEX "vouchers_company_date_idx" ON "vouchers" USING btree ("company_id","date");--> statement-breakpoint
CREATE INDEX "vouchers_type_idx" ON "vouchers" USING btree ("voucher_type_id");