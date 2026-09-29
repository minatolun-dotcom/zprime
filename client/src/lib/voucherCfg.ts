// R-83 Option B (F-83-5 + F-83-3): Tally's in-entry F12 configuration for the
// voucher screen — presentation/context toggles a Tally operator expects to
// own, persisted PER COMPANY in localStorage (Tally scopes F12 per company
// too; defaults restore today's behaviour byte-identically, so every existing
// surface and suite contract holds until the operator flips a toggle).
//
// ZERO ACCOUNTING SURFACE: every setting is presentation or context-only.
//  - mode            "voucher" (Dr/Cr + item grid, today's always-on layout)
//                    | "invoice" (Tally As-Invoice: To/By select + one Amount
//                    column; the SAME LedgerRow.amount is booked — sign still
//                    carries Dr/Cr — so postings are byte-identical both ways)
//  - showPartyBalance   party closing beside Party A/c (R-83 Option A)
//  - showBillsList      open-bills picker in Against Bill (R-83 Option A)
//  - showInvoiceDetails expand the Party/Dispatch/Order section by default
//  - warnNegativeCash   the negative-cash advisory strip (server advisory is
//                       unaffected — this silences only the client mirror)
//  - warnLongNumber     warn when a voucher number exceeds 16 chars (Tally)
export interface VoucherCfg {
  mode: "voucher" | "invoice";
  showPartyBalance: boolean;
  showBillsList: boolean;
  showInvoiceDetails: boolean;
  warnNegativeCash: boolean;
  warnLongNumber: boolean;
}

export const DEFAULT_VOUCHER_CFG: VoucherCfg = {
  mode: "voucher",
  showPartyBalance: true,
  showBillsList: true,
  showInvoiceDetails: false,
  warnNegativeCash: true,
  warnLongNumber: true,
};

const key = (cid: string) => `zprime_voucher_cfg_${cid}`;

export function loadVoucherCfg(cid: string | undefined): VoucherCfg {
  if (!cid) return { ...DEFAULT_VOUCHER_CFG };
  try {
    const raw = localStorage.getItem(key(cid));
    if (!raw) return { ...DEFAULT_VOUCHER_CFG };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_VOUCHER_CFG, ...(parsed && typeof parsed === "object" ? parsed : {}) };
  } catch {
    return { ...DEFAULT_VOUCHER_CFG };
  }
}

export function saveVoucherCfg(cid: string | undefined, cfg: VoucherCfg) {
  if (!cid) return;
  try {
    localStorage.setItem(key(cid), JSON.stringify(cfg));
  } catch { /* storage full/blocked — the session keeps the in-memory cfg */ }
}
