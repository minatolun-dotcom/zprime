import { z } from "zod";
import { db } from "../db/index.js";
import { companies, userCompanies } from "../db/schema.js";
import { and, eq } from "drizzle-orm";

/** Company-scoped helper: parse :cid, ensure numeric, existing AND that the
 *  authenticated user holds a membership on it (R-03 authorization boundary).
 *  Unauthorized companies answer 404 — indistinguishable from unknown — so no
 *  other user's company existence leaks. Membership is resolved server-side on
 *  EVERY request (never from JWT/body/headers), so revocation is immediate.
 *  The single authorization point for all /api/c/:cid/* routes. */
export async function cid(req: any): Promise<number> {
  const cid = parseInt((req.params as any).cid, 10);
  if (!Number.isFinite(cid) || cid <= 0) throw bad("Invalid company");
  const uid = req.userId;
  if (!Number.isFinite(uid) || uid <= 0) throw bad("Company not found", 404);
  const [row] = await db
    .select({ id: companies.id })
    .from(companies)
    .innerJoin(userCompanies, and(eq(userCompanies.companyId, companies.id), eq(userCompanies.userId, uid)))
    .where(eq(companies.id, cid))
    .limit(1);
  if (!row) throw bad("Company not found", 404);
  return cid;
}

/** Create a 4xx error with an explicit HTTP status. */
export function bad(msg: string, status = 400): Error {
  return Object.assign(new Error(msg), { statusCode: status });
}

/** Validate a YYYY-MM-DD string is a real calendar date (rejects 2025-02-30 etc). */
export function calendarDate(msg = "Invalid date") {
  return z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, msg)
    .refine((s) => {
      const [y, m, d] = s.split("-").map((x) => parseInt(x, 10));
      if (m < 1 || m > 12 || d < 1 || d > 31) return false;
      const dt = new Date(`${s}T00:00:00Z`);
      return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === s;
    }, { message: msg });
}

/** Free-text cap: sane upper bound, trimmed. */
export const shortText = (max = 200) => z.string().trim().max(max);
export const longText = (max = 4000) => z.string().trim().max(max);

/** Unwrap a Postgres error that may be nested inside a DrizzleQueryError
 *  (drizzle >= 0.31 wraps driver errors and keeps the original as .cause). */
export function pgCode(err: any): string | undefined {
  let e = err;
  for (let i = 0; i < 5 && e; i++) {
    if (typeof e.code === "string" && /^\d{5}$/.test(e.code)) return e.code;
    e = e.cause;
  }
  return undefined;
}

/** Translate raw PostgreSQL error codes into safe 4xx responses. Anything
 *  already carrying a statusCode (from bad()) passes through untouched;
 *  unknown errors pass through to the global 500 sanitizer. */
export function pgFriendly(err: any): Error {
  const code = pgCode(err);
  switch (code) {
    case "23505": return bad("Duplicate value: this record already exists", 409);
    case "23503": return bad("Referenced record does not exist or is still in use");
    case "22P02": return bad("Invalid value format");
    case "22001": return bad("Value too long for a field");
    case "23514": return bad("Value violates a data constraint");
    case "22003": return bad("Numeric value out of range");
    case "23502": return bad("A required field is missing");
    default: return err?.statusCode ? err : err;
  }
}

export const voucherEntrySchema = z.object({
  ledgerId: z.number().int().positive(),
  amount: z.number().finite(),
  gstRate: z.number().finite().min(0).max(100).nullable().optional(),
  hsnSac: z.string().max(50).nullable().optional(),
  tdsSectionId: z.number().int().positive().nullable().optional(),
  tcsSectionId: z.number().int().positive().nullable().optional(),
});

export const billSchema = z.object({
  billType: z.enum(["new_ref", "against_ref", "advance", "on_account"]),
  billName: z.string().trim().min(1).max(100),
  amount: z.number().finite(),
  dueDate: calendarDate("Invalid bill due date").nullable().optional(),
});

export const inventoryEntrySchema = z.object({
  itemId: z.number().int().positive(),
  godownId: z.number().int().positive().nullable().optional(),
  qty: z.number().finite(),
  rate: z.number().finite().default(0),
  amount: z.number().finite().default(0),
  // "physical" = Physical Stock counted-qty row (stock.ts computes the diff at running avg)
  kind: z.enum(["stock", "source", "target", "physical"]).default("stock"),
  hsnSac: z.string().max(50).nullable().optional(),
  gstRate: z.number().finite().min(0).max(100).nullable().optional(),
});

export const voucherSchema = z.object({
  voucherTypeId: z.number().int().positive(),
  date: calendarDate("date must be a valid YYYY-MM-DD calendar date"),
  number: shortText(60).optional(),
  reference: shortText(100).nullable().optional(),
  refDate: calendarDate("refDate must be a valid calendar date").nullable().optional(),
  narration: longText(1000).default(""),
  partyLedgerId: z.number().int().positive().nullable().optional(),
  chequeNumber: shortText(50).nullable().optional(),
  chequeDate: calendarDate("chequeDate must be a valid calendar date").nullable().optional(),
  placeOfSupply: shortText(100).nullable().optional(),
  // R-23: reverse charge — the recipient self-accounts the GST on this inward
  // (s. 9(3)/9(4)). Server truth only; client-supplied values beyond the
  // boolean are meaningless. Import path does not set it (later scope).
  isRcm: z.boolean().optional().default(false),
  // R-10 (B-10): optional client-generated idempotency key. One key = one
  // business event; replaying it returns the original voucher. Also accepted
  // via the X-Idempotency-Key header (header wins). Server caps length and
  // scopes the key to the authenticated company.
  idempotencyKey: shortText(200).optional(),
  entries: z.array(
    z.object({
      ...voucherEntrySchema.shape,
      bills: z.array(billSchema).optional().default([]),
    })
  ),
  inventoryEntries: z.array(inventoryEntrySchema).optional().default([]),
});

export type VoucherInput = z.infer<typeof voucherSchema>;

// ---------- master schemas (group/TDS/payroll masters have real domain rules) ----------

// The UI (and historic API consumers) send numeric fields as strings (form
// inputs / <select> values). Coerce numeric-looking strings before validating —
// null/undefined pass through for optional fields. Each use builds its own
// refined schema (ZodEffects doesn't chain number refinements).
const numF = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v);

const GROUP_NATURES = ["Assets", "Liabilities", "Income", "Expenses"] as const;

export const groupSchema = z.object({
  name: z.string().trim().min(1, "Group name is required").max(200),
  parentId: z.preprocess(numF, z.number().int().positive().nullable().optional()),
  nature: z.preprocess((v) => (v === "" || v == null ? undefined : v),
    z.enum(GROUP_NATURES, { message: "nature must be Assets | Liabilities | Income | Expenses" }).optional()),
  affectsGross: z.boolean().optional(),
});

export const tdsSectionSchema = z.object({
  section: z.string().trim().min(1, "Section is required (e.g. 194C)").max(50),
  description: z.string().max(1000).nullable().optional(),
  rate: z.preprocess(numF, z.number().finite().min(0, "rate cannot be negative").max(100, "rate cannot exceed 100%").nullable().optional()),
  threshold: z.preprocess(numF, z.number().finite().min(0, "threshold cannot be negative").nullable().optional()),
});

export const tcsSectionSchema = tdsSectionSchema;

export const payHeadSchema = z.object({
  name: z.string().trim().min(1, "Pay head name is required").max(200),
  type: z.enum(["earning", "deduction", "employer_contribution"], { message: "type must be earning | deduction | employer_contribution" }),
  ledgerId: z.preprocess(numF, z.number().int().positive()),
  affectsGross: z.boolean().optional(),
});

export const salaryStructureSchema = z.object({
  lines: z.array(z.object({
    headId: z.preprocess(numF, z.number().int().positive()),
    // A deduction head's amount is the amount DEDUCTED — always non-negative.
    // Negative values would silently inflate net pay (finding A-03).
    monthlyAmount: z.preprocess(numF, z.number().finite().min(0, "Salary amounts cannot be negative")),
  })).min(1, "At least one pay head line is required"),
});

/** Trim every string value (master create/update payloads). */
export function trimStrings<T extends Record<string, unknown>>(data: T): T {
  const out: any = {};
  for (const [k, v] of Object.entries(data)) out[k] = typeof v === "string" ? v.trim() : v;
  return out;
}
