// The 28 standard pre-defined account groups, with parent + nature.
export type GroupNature = "Assets" | "Liabilities" | "Income" | "Expenses";

export interface DefaultGroup {
  name: string;
  parent: string | null; // null => primary
  nature: GroupNature;
  affectsGross?: boolean; // trading accounts affecting gross profit
}

export const DEFAULT_GROUPS: DefaultGroup[] = [
  { name: "Capital Account", parent: null, nature: "Liabilities" },
  { name: "Reserves & Surplus", parent: "Capital Account", nature: "Liabilities" },
  { name: "Loans (Liability)", parent: null, nature: "Liabilities" },
  { name: "Bank OD A/c", parent: "Loans (Liability)", nature: "Liabilities" },
  { name: "Secured Loans", parent: "Loans (Liability)", nature: "Liabilities" },
  { name: "Unsecured Loans", parent: "Loans (Liability)", nature: "Liabilities" },
  { name: "Current Liabilities", parent: null, nature: "Liabilities" },
  { name: "Duties & Taxes", parent: "Current Liabilities", nature: "Liabilities" },
  { name: "Provisions", parent: "Current Liabilities", nature: "Liabilities" },
  { name: "Sundry Creditors", parent: "Current Liabilities", nature: "Liabilities" },
  { name: "Fixed Assets", parent: null, nature: "Assets" },
  { name: "Investments", parent: null, nature: "Assets" },
  { name: "Current Assets", parent: null, nature: "Assets" },
  { name: "Bank Accounts", parent: "Current Assets", nature: "Assets" },
  { name: "Cash-in-Hand", parent: "Current Assets", nature: "Assets" },
  { name: "Deposits (Asset)", parent: "Current Assets", nature: "Assets" },
  { name: "Loans & Advances (Asset)", parent: "Current Assets", nature: "Assets" },
  { name: "Stock-in-Hand", parent: "Current Assets", nature: "Assets" },
  { name: "Sundry Debtors", parent: "Current Assets", nature: "Assets" },
  { name: "Branch / Divisions", parent: null, nature: "Assets" },
  { name: "Misc. Expenses (Asset)", parent: null, nature: "Assets" },
  { name: "Suspense A/c", parent: null, nature: "Assets" },
  { name: "Sales Accounts", parent: null, nature: "Income", affectsGross: true },
  { name: "Purchase Accounts", parent: null, nature: "Expenses", affectsGross: true },
  { name: "Direct Incomes", parent: null, nature: "Income", affectsGross: true },
  { name: "Direct Expenses", parent: null, nature: "Expenses", affectsGross: true },
  { name: "Indirect Incomes", parent: null, nature: "Income" },
  { name: "Indirect Expenses", parent: null, nature: "Expenses" },
];

export type VoucherCategory = "Accounting" | "Inventory" | "Payroll";

export interface DefaultVoucherType {
  name: string;
  shortCode: string;
  category: VoucherCategory;
  affectsStock: boolean;
  functionKey?: string; // hint for UI
  prefix?: string;
}

export const DEFAULT_VOUCHER_TYPES: DefaultVoucherType[] = [
  { name: "Contra", shortCode: "CNTRA", category: "Accounting", affectsStock: false, functionKey: "F4" },
  { name: "Payment", shortCode: "PAY", category: "Accounting", affectsStock: false, functionKey: "F5" },
  { name: "Receipt", shortCode: "RCPT", category: "Accounting", affectsStock: false, functionKey: "F6" },
  { name: "Journal", shortCode: "JV", category: "Accounting", affectsStock: false, functionKey: "F7" },
  { name: "Sales", shortCode: "SALES", category: "Accounting", affectsStock: true, functionKey: "F8" },
  { name: "Purchase", shortCode: "PURCH", category: "Accounting", affectsStock: true, functionKey: "F9" },
  { name: "Credit Note", shortCode: "CRN", category: "Accounting", affectsStock: true, functionKey: "Alt+F6" },
  { name: "Debit Note", shortCode: "DRN", category: "Accounting", affectsStock: true, functionKey: "Alt+F5" },
  { name: "Delivery Note", shortCode: "DLV", category: "Inventory", affectsStock: true, functionKey: "Alt+F8" },
  { name: "Receipt Note", shortCode: "RCN", category: "Inventory", affectsStock: true, functionKey: "Alt+F9" },
  { name: "Stock Journal", shortCode: "SJ", category: "Inventory", affectsStock: true, functionKey: "Alt+F7" },
  { name: "Physical Stock", shortCode: "PS", category: "Inventory", affectsStock: true, functionKey: "Ctrl+F7" },
  { name: "Manufacturing Journal", shortCode: "MJ", category: "Inventory", affectsStock: true, functionKey: "F10" },
  { name: "Payroll", shortCode: "PR", category: "Payroll", affectsStock: false },
];

// Duties & Taxes heads for GST
export const GST_DUTY_HEADS = ["IGST", "CGST", "SGST", "UTGST", "CESS"] as const;
export type GstDutyHead = (typeof GST_DUTY_HEADS)[number];

export const INDIAN_STATES: { code: string; name: string }[] = [
  { code: "01", name: "Jammu & Kashmir" }, { code: "02", name: "Himachal Pradesh" },
  { code: "03", name: "Punjab" }, { code: "04", name: "Chandigarh" },
  { code: "05", name: "Uttarakhand" }, { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" }, { code: "08", name: "Rajasthan" },
  { code: "09", name: "Uttar Pradesh" }, { code: "10", name: "Bihar" },
  { code: "11", name: "Sikkim" }, { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" }, { code: "14", name: "Manipur" },
  { code: "15", name: "Mizoram" }, { code: "16", name: "Tripura" },
  { code: "17", name: "Meghalaya" }, { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" }, { code: "20", name: "Jharkhand" },
  { code: "21", name: "Odisha" }, { code: "22", name: "Chhattisgarh" },
  { code: "23", name: "Madhya Pradesh" }, { code: "24", name: "Gujarat" },
  { code: "27", name: "Maharashtra" }, { code: "29", name: "Karnataka" },
  { code: "30", name: "Goa" }, { code: "31", name: "Lakshadweep" },
  { code: "32", name: "Kerala" }, { code: "33", name: "Tamil Nadu" },
  { code: "34", name: "Puducherry" }, { code: "35", name: "Andaman & Nicobar Islands" },
  { code: "36", name: "Telangana" }, { code: "37", name: "Andhra Pradesh" },
  { code: "38", name: "Ladakh" },
];
