#!/usr/bin/env python3
"""
Independent expectation engine for the zprime acceptance test — the
accountant's own parallel set of books. Shares NO code and NO queries with
zprime. Input: state.json (the business events as entered). Output:
expected.json with every month-end report figure recomputed from first
principles.

Sign conventions: ledger amounts positive = Debit, negative = Credit.
Openings: positive = Dr opening, negative = Cr opening.
"""
import json, sys
from datetime import date, timedelta

R = lambda x: round(x + 1e-9, 2)

# State-name → GST state code (mirror of the server's stateCodeFromName subset
# needed by the acceptance scenario).
STATE_CODES = {"Karnataka": "29", "Maharashtra": "27", "Delhi": "07", "Tamil Nadu": "33",
               "Gujarat": "24", "Telangana": "36", "Uttar Pradesh": "09", "West Bengal": "19",
               "Rajasthan": "08", "Kerala": "32", "Haryana": "06", "Punjab": "03",
               "Madhya Pradesh": "23", "Andhra Pradesh": "37", "Bihar": "10", "Odisha": "21"}

ASSET_GROUPS = {"Cash-in-Hand", "Bank Accounts", "Sundry Debtors", "Fixed Assets",
                "Investments", "Loans & Advances (Asset)", "Stock-in-Hand",
                "Deposits (Asset)", "Current Assets", "Branch / Divisions",
                "Misc. Expenses (Asset)", "Suspense A/c"}
LIAB_GROUPS = {"Capital Account", "Sundry Creditors", "Duties & Taxes", "Provisions",
               "Current Liabilities", "Loans (Liability)", "Bank OD A/c",
               "Secured Loans", "Unsecured Loans", "Reserves & Surplus"}
PL_GROUPS = ["Sales Accounts", "Purchase Accounts", "Direct Expenses",
             "Direct Incomes", "Indirect Expenses", "Indirect Incomes"]

OUT_TYPES = {"Sales", "Delivery Note"}      # stock out
IN_TYPES = {"Purchase", "Receipt Note"}     # stock in
CN_DN = {"Credit Note", "Debit Note"}


def prev_day(d):
    return (date.fromisoformat(d) - timedelta(days=1)).isoformat()


class Engine:
    def __init__(self, state):
        self.fyStart = state["fyStart"]
        self.stateCode = state["company"]["stateCode"]
        self.ledgers = {l["name"]: l for l in state["masters"]["ledgers"]}
        # The company seed auto-creates these ledgers (server/src/routes/companies.ts)
        SEED = {"Cash": {"group": "Cash-in-Hand", "isBankCash": True},
                "Profit & Loss A/c": {"group": "Capital Account"},
                "IGST": {"group": "Duties & Taxes", "dutyHead": "IGST"},
                "CGST": {"group": "Duties & Taxes", "dutyHead": "CGST"},
                "SGST/UTGST": {"group": "Duties & Taxes", "dutyHead": "SGST"},
                "CESS": {"group": "Duties & Taxes", "dutyHead": "CESS"},
                "TDS Payable": {"group": "Duties & Taxes", "dutyHead": "TDS"},
                "Salary Payable": {"group": "Current Liabilities"}}
        for n, meta in SEED.items():
            self.ledgers.setdefault(n, {"name": n, **meta})
        self.items = {i["name"]: i for i in state["masters"]["items"]}
        self.employees = state["masters"].get("employees", [])
        self.monthEnds = state["monthEnds"]
        # Normalize lines: runner records dr/cr (+Debit/−Credit); engine works with signed amount.
        norm = []
        for v in state["vouchers"]:
            if v.get("_deleted"):
                continue
            # R-02 cancellation semantics: a cancelled voucher is INACTIVE — it
            # contributes to no active report, inventory movement, GST figure or
            # bill. Model A (mark + exclude), exactly like the application.
            if v.get("_cancelled"):
                continue
            lines = []
            for e in self.lines_of(v):
                if "amount" not in e:
                    amt = float(e["dr"]) if e.get("dr") is not None else -float(e.get("cr") or 0)
                    e = {**e, "amount": R(amt)}
                lines.append(e)
            norm.append({**v, "lines": lines})
        self.vouchers = sorted(norm, key=lambda v: (v["date"], v.get("seq", 0)))

    # ---------------- ledger balances ----------------
    def lines_of(self, v):
        """Ledger lines for a voucher; Payroll expands to its ledger postings
        (mirrors server/src/routes/payroll.ts: earning heads Dr, deduction heads Cr,
        Salary Payable Cr net)."""
        if v["type"] != "Payroll":
            return v.get("lines", [])
        out = []
        for emp in v.get("employees", []):
            st = emp["structure"]
            heads = v.get("heads", {})  # head name -> {ledger, type}
            for hname, amt in st.items():
                amt = float(amt)
                if not amt:
                    continue
                h = heads.get(hname, {"ledger": "Salaries" if amt > 0 else "Salary Payable",
                                      "type": "earning" if amt > 0 else "deduction"})
                if (amt > 0) == (h["type"] == "earning"):
                    out.append({"ledger": h["ledger"], "amount": R(abs(amt))})
                else:
                    out.append({"ledger": h["ledger"], "amount": R(-abs(amt))})
            # Server math (routes/payroll.ts): gross = Σ earning heads only;
            # deductions = Σ deduction heads (always positive); net = gross - ded.
            gross = R(sum(float(x) for k, x in st.items()
                          if heads.get(k, {}).get("type") != "deduction"))
            ded = R(sum(abs(float(x)) for k, x in st.items()
                        if heads.get(k, {}).get("type") == "deduction"))
            out.append({"ledger": "Salary Payable", "amount": -R(gross - ded)})
        return out

    def ledger_closings(self, as_of):
        clos = {n: R(float(l.get("opening", 0))) for n, l in self.ledgers.items()}
        for v in self.vouchers:
            if v["date"] > as_of:
                continue
            for e in self.lines_of(v):
                clos[e["ledger"]] = R(clos.get(e["ledger"], 0) + e["amount"])
        return clos

    def tb(self, frm, to):
        opening = self.ledger_closings(prev_day(frm))
        rows = []
        tot_d = tot_c = 0.0
        for n in sorted(self.ledgers):
            op = opening[n]  # master opening + movements before `from` (app semantics)
            per_d = per_c = 0.0
            for v in self.vouchers:
                if not (frm <= v["date"] <= to):
                    continue
                for e in self.lines_of(v):
                    if e["ledger"] != n:
                        continue
                    if e["amount"] > 0:
                        per_d = R(per_d + e["amount"])
                    else:
                        per_c = R(per_c - e["amount"])
            if abs(op) < 0.005 and abs(per_d) < 0.005 and abs(per_c) < 0.005:
                continue
            cl = R(op + per_d - per_c)
            rows.append({"name": n, "group": self.ledgers[n].get("group", ""),
                         "openingDr": op if op > 0 else 0, "openingCr": -op if op < 0 else 0,
                         "periodDr": per_d, "periodCr": per_c,
                         "closingDr": cl if cl > 0 else 0, "closingCr": -cl if cl < 0 else 0})
            tot_d = R(tot_d + (cl if cl > 0 else 0))
            tot_c = R(tot_c + (-cl if cl < 0 else 0))
        # App default TB displays CLOSING balances; totals are closing totals.
        return {"rows": rows, "totalDebit": tot_d, "totalCredit": tot_c}

    # ---------------- stock (at COST) ----------------
    def stock_position(self, as_of):
        pos = {}
        for name, it in self.items.items():
            pos[name] = {"costing": it.get("costing", "weighted_avg"), "qty": 0.0,
                         "value": 0.0, "layers": [], "inQ": 0.0, "inV": 0.0, "outQ": 0.0, "outV": 0.0}
            oq, ov = float(it.get("openingQty", 0)), float(it.get("openingValue", 0))
            if oq:
                pos[name]["qty"] = R(pos[name]["qty"] + oq)
                pos[name]["value"] = R(pos[name]["value"] + ov)
                pos[name]["inQ"] = R(pos[name]["inQ"] + oq)
                pos[name]["inV"] = R(pos[name]["inV"] + ov)
                if pos[name]["costing"] == "fifo":
                    pos[name]["layers"].append([oq, R(ov / oq) if oq else 0])

        def wavg(p):
            return R(p["value"] / p["qty"]) if abs(p["qty"]) > 1e-9 else 0

        def take_out(p, qty):
            """Consume qty at cost; returns cost value consumed."""
            cost = 0.0
            if p["costing"] == "fifo":
                need = qty
                while need > 1e-9 and p["layers"]:
                    lq, lr = p["layers"][0]
                    t = min(lq, need)
                    cost = R(cost + t * lr)
                    p["layers"][0][0] = R(lq - t)
                    if p["layers"][0][0] <= 1e-9:
                        p["layers"].pop(0)
                    need = R(need - t)
                if need > 1e-9:  # beyond layers: value at last known avg
                    a = wavg(p)
                    cost = R(cost + need * a)
            else:
                a = wavg(p)
                cost = R(min(qty, max(p["qty"], 0)) * a) if a else 0.0
            return cost

        def add_in(p, qty, value):
            p["qty"] = R(p["qty"] + qty)
            p["value"] = R(p["value"] + value)
            p["inQ"] = R(p["inQ"] + qty)
            p["inV"] = R(p["inV"] + value)
            if p["costing"] == "fifo" and qty > 0 and R(value) > 0:
                p["layers"].append([qty, R(value / qty)])

        def add_out(p, qty):
            cost = take_out(p, qty)
            p["qty"] = R(p["qty"] - qty)
            p["value"] = R(p["value"] - cost)
            if p["value"] < 0 and p["value"] > -0.01:
                p["value"] = 0.0
            p["outQ"] = R(p["outQ"] + qty)
            p["outV"] = R(p["outV"] + cost)

        for v in self.vouchers:
            if v["date"] > as_of:
                continue
            t = v["type"]
            for ie in v.get("items", []):
                name = ie["item"]
                qty = abs(float(ie["qty"]))
                amt = R(abs(float(ie["amount"])) if ie.get("amount") is not None else R(abs(float(ie["qty"])) * float(ie["rate"])))
                p = pos[name]
                if t in IN_TYPES:
                    add_in(p, qty, amt)
                elif t in OUT_TYPES:
                    add_out(p, qty)
                elif t == "Credit Note":
                    add_in(p, qty, amt)
                elif t == "Debit Note":
                    add_out(p, qty)
                elif t == "Physical Stock":
                    counted = qty
                    a = wavg(p)
                    diff = R(counted - p["qty"])
                    p["value"] = R(p["value"] + R(diff * a))
                    p["qty"] = counted
                    if p["costing"] == "fifo":
                        p["layers"] = [[counted, a]] if counted > 0 else []
                elif t in ("Stock Journal", "Manufacturing Journal"):
                    if ie.get("kind") == "target":
                        add_in(p, qty, amt)
                    else:
                        add_out(p, qty)
        return {n: {"qty": R(p["qty"]), "value": R(p["value"]), "costing": p["costing"]}
                for n, p in pos.items()}

    def stock_value(self, as_of):
        return R(sum(p["value"] for p in self.stock_position(as_of).values()))

    # ---------------- GST ----------------
    def gst_of(self, v):
        """Mirror of the app's documented semantics: taxable = |sum of non-duty
        TAXABLE Sales/Purchase lines| (exempt/nil excluded); duties = |sum| per
        duty head (input and output both positive)."""
        taxable = R(sum(abs(e["amount"]) for e in v.get("lines", [])
                        if self.ledgers.get(e["ledger"], {}).get("group") in ("Sales Accounts", "Purchase Accounts")
                        and self.ledgers.get(e["ledger"], {}).get("taxability", "none") == "taxable"))
        def dh(e, _self=self):
            return e.get("dutyHead") or _self.ledgers.get(e["ledger"], {}).get("dutyHead")
        igst = R(sum(abs(e["amount"]) for e in v.get("lines", []) if dh(e) == "IGST"))
        cgst = R(sum(abs(e["amount"]) for e in v.get("lines", []) if dh(e) == "CGST"))
        sgst = R(sum(abs(e["amount"]) for e in v.get("lines", []) if dh(e) == "SGST"))
        pname = v.get("party")
        party = self.ledgers.get(pname, {}) if isinstance(pname, str) else (pname or {})
        direction = "outward" if v["type"] in ("Sales", "Credit Note") else "inward"
        # Mirror the app's supply-type rule (services/gst.ts voucherGst): resolve
        # place of supply from partyState or GSTIN prefix; if it cannot differ from
        # the company state, IGST columns are zeroed (and vice versa).
        pos = party.get("partyState")
        pos_code = None
        if pos:
            pos_code = pos if (isinstance(pos, str) and len(pos) == 2 and pos.isdigit()) else STATE_CODES.get(pos)
        if pos_code is None and party.get("gstin"):
            pos_code = str(party["gstin"])[:2]
        inter = pos_code is not None and pos_code != self.stateCode
        return {"taxable": taxable, "igst": igst if inter else 0, "cgst": 0 if inter else cgst,
                "sgst": 0 if inter else sgst,
                "direction": direction, "b2b": bool(party.get("gstin")),
                "party": pname if isinstance(pname, str) else party.get("name"),
                "type": v["type"], "number": v.get("number", ""),
                "date": v["date"]}

    def gst_list(self, frm, to):
        return [self.gst_of(v) for v in self.vouchers
                if frm <= v["date"] <= to and v["type"] in ("Sales", "Purchase", "Credit Note", "Debit Note")]

    def gstr1(self, frm, to):
        """Expected GSTR-1: Sales net of Credit Notes, split B2B/B2C by party GSTIN."""
        out = {"b2b": {"taxable": 0, "igst": 0, "cgst": 0, "sgst": 0, "count": 0},
               "b2c": {"taxable": 0, "igst": 0, "cgst": 0, "sgst": 0, "count": 0}}
        cn = {"taxable": 0, "igst": 0, "cgst": 0, "sgst": 0}
        for v in self.vouchers:
            if not (frm <= v["date"] <= to):
                continue
            if v["type"] not in ("Sales", "Credit Note"):
                continue
            g = self.gst_of(v)
            b = out["b2b"] if g["b2b"] else out["b2c"]
            sgn = 1 if v["type"] == "Sales" else -1
            b["taxable"] = R(b["taxable"] + sgn * g["taxable"])
            b["igst"] = R(b["igst"] + sgn * g["igst"])
            b["cgst"] = R(b["cgst"] + sgn * g["cgst"])
            b["sgst"] = R(b["sgst"] + sgn * g["sgst"])
            b["count"] += 1 if v["type"] == "Sales" else 0
            if v["type"] == "Credit Note":
                cn["taxable"] = R(cn["taxable"] + g["taxable"])
                cn["igst"] = R(cn["igst"] + g["igst"])
                cn["cgst"] = R(cn["cgst"] + g["cgst"])
                cn["sgst"] = R(cn["sgst"] + g["sgst"])
        # HSN expected from items (hsn, gstRate): sale qty + sale value
        hsn = {}
        for v in self.vouchers:
            if not (frm <= v["date"] <= to) or v["type"] not in ("Sales", "Credit Note"):
                continue
            sgn = 1 if v["type"] == "Sales" else -1
            for ie in v.get("items", []):
                it = self.items[ie["item"]]
                k = (it.get("hsn", "-"), float(it.get("gstRate", 0)))
                h = hsn.setdefault(k, {"hsn": k[0], "rate": k[1], "qty": 0.0, "taxable": 0})
                h["qty"] = R(h["qty"] + sgn * abs(float(ie["qty"])))
                h["taxable"] = R(h["taxable"] + sgn * abs(float(ie.get("amount", 0))))
        return {"b2b": out["b2b"], "b2c": out["b2c"], "cdnr": cn, "hsn": list(hsn.values())}

    def gstr3b(self, frm, to):
        out = {"taxable": 0, "igst": 0, "cgst": 0, "sgst": 0}
        itc = {"taxable": 0, "igst": 0, "cgst": 0, "sgst": 0}
        for v in self.vouchers:
            if not (frm <= v["date"] <= to):
                continue
            if v["type"] not in ("Sales", "Purchase", "Credit Note", "Debit Note"):
                continue
            g = self.gst_of(v)
            bucket = out if g["direction"] == "outward" else itc
            sgn = 1 if v["type"] in ("Sales", "Purchase") else -1
            for k in ("taxable", "igst", "cgst", "sgst"):
                bucket[k] = R(bucket[k] + sgn * g[k])
        net = {k: R(out[k] - itc[k]) for k in ("igst", "cgst", "sgst")}
        net["total"] = R(sum(net.values()))
        return {"outward": out, "itc": itc, "net": net}

    # ---------------- bills ----------------
    def _entry_bills(self, v, e):
        """Mirror the client's automatic bill attach (VoucherScreen.save): on
        Sales/Purchase/CN/DN, a bill-wise party row gets new_ref (name =
        SHORTCODE-number per the A-02 fix); explicit billRef = against_ref;
        anything else on_account."""
        PARTY = ("Sales", "Purchase", "Credit Note", "Debit Note")
        CODE = {"Sales": "SALES", "Purchase": "PURCH", "Credit Note": "CRN", "Debit Note": "DRN"}
        out = []
        is_party_row = bool(v.get("party")) and e["ledger"] == v["party"]
        if e.get("billRef"):
            out.append({"type": "against_ref", "name": e["billRef"], "amount": e["amount"]})
        elif is_party_row and v["type"] in PARTY:
            num = v.get("number", "")
            name = f"{CODE[v['type']]}-{num}" if num else f"{v.get('date', '')}-{0}"
            out.append({"type": "new_ref", "name": name, "amount": e["amount"]})
        else:
            out.append({"type": "on_account", "name": "On Account", "amount": e["amount"]})
        return out

    def bills(self, as_of, group_name):
        per = {}
        for v in self.vouchers:
            if v["date"] > as_of:
                continue
            for e in self.lines_of(v):
                led = self.ledgers.get(e["ledger"], {})
                if led.get("group") != group_name:
                    continue
                L = per.setdefault(e["ledger"], {"bills": {}, "onAccount": 0.0})
                for b in self._entry_bills(v, e):
                    if b["type"] == "on_account":
                        L["onAccount"] = R(L["onAccount"] + b["amount"])
                    else:
                        cur = L["bills"].get(b["name"], 0.0)
                        L["bills"][b["name"]] = R(cur + b["amount"])
        out = {}
        for name, L in per.items():
            oa = L["onAccount"]
            open_bills = {k: amt for k, amt in L["bills"].items() if abs(amt) > 0.004}
            # A-05 fix semantics: on-account net is merged into the party total
            # (surfaced as the synthetic "On Account" bill by the server).
            total = R(sum(open_bills.values()) + oa)
            if abs(total) > 0.004 or open_bills or abs(oa) > 0.004:
                out[name] = {"bills": open_bills, "onAccount": oa, "total": total}
        return out

    # ---------------- TDS ----------------
    def tds(self, frm, to):
        # Mirror of the app: sections come from tdsSectionId on the TDS duty entry.
        # F-TDS-01 (section masters unusable) → every deduction lands "Unspecified".
        out = {}
        for v in self.vouchers:
            if not (frm <= v["date"] <= to):
                continue
            for e in self.lines_of(v):
                is_tds_cr = e["ledger"] == "TDS Payable" and e["amount"] < 0
                if not (e.get("tdsSection") or is_tds_cr):
                    continue
                if e.get("tdsSection") and e["amount"] >= 0:
                    continue
                s = e.get("tdsSection") or "Unspecified"
                o = out.setdefault(s, {"section": s, "amount": 0, "count": 0})
                o["amount"] = R(o["amount"] + abs(e["amount"]))
                o["count"] += 1
        return out

    # ---------------- P&L ----------------
    def pnl(self, frm, to):
        op = self.stock_value(prev_day(frm))
        cl = self.stock_value(to)
        g = {k: 0.0 for k in PL_GROUPS}
        for v in self.vouchers:
            if not (frm <= v["date"] <= to):
                continue
            for e in self.lines_of(v):
                grp = self.ledgers.get(e["ledger"], {}).get("group")
                if grp in g:
                    g[grp] = R(g[grp] + e["amount"])
        sales = -g["Sales Accounts"]
        purchases = g["Purchase Accounts"]
        dex = g["Direct Expenses"]
        din = -g["Direct Incomes"]
        iex = g["Indirect Expenses"]
        iin = -g["Indirect Incomes"]
        cogs = R(purchases + op - cl + dex - din)
        gross = R(sales - cogs)
        net = R(gross - iex + iin)
        return {"sales": sales, "purchases": purchases, "openingStock": op, "closingStock": cl,
                "cogs": cogs, "grossProfit": gross, "directExpenses": dex, "directIncome": din,
                "indirectExpenses": iex, "indirectIncome": iin, "netProfit": net}

    def pnl_app_sub(self, frm, to):
        """Mirror of the server's profitAndLoss for a SUB-period: ledger sums are
        cumulative-through-`to` closings (ledgerBalances(from,to).closing), with
        opening/closing stock lines layered on top. Used to verify A-06 exactly."""
        clos0 = self.ledger_closings(prev_day(frm))
        g = {k: 0.0 for k in PL_GROUPS}
        for v in self.vouchers:
            if v["date"] > to:
                continue
            for e in self.lines_of(v):
                grp = self.ledgers.get(e["ledger"], {}).get("group")
                if grp in g:
                    g[grp] = R(g[grp] + e["amount"])
        sales = -g["Sales Accounts"]
        purchases = g["Purchase Accounts"]
        dex = g["Direct Expenses"]
        din = -g["Direct Incomes"]
        iex = g["Indirect Expenses"]
        iin = -g["Indirect Incomes"]
        op = self.stock_value(prev_day(frm))
        cl = self.stock_value(to)
        cogs = R(purchases + op - cl + dex - din)
        gross = R(sales - cogs)
        net = R(gross - iex + iin)
        return net

    # ---------------- registers ----------------
    def register(self, frm, to, typeName):
        rows = []
        for v in self.vouchers:
            if v["type"] != typeName or not (frm <= v["date"] <= to):
                continue
            party = v.get("party")
            if isinstance(party, str): party = {"name": party}
            party = (party or {}).get("name")
            amt = R(sum(abs(e["amount"]) for e in v.get("lines", [])
                        if self.ledgers.get(e["ledger"], {}).get("group") in
                        ("Sundry Debtors", "Sundry Creditors")))
            gst = R(sum(abs(e["amount"]) for e in v.get("lines", [])
                        if (e.get("dutyHead") or self.ledgers.get(e["ledger"], {}).get("dutyHead"))))
            rows.append({"date": v["date"], "number": v.get("number", ""), "party": party,
                         "amount": amt, "gst": gst})
        return {"rows": rows, "total": R(sum(r["amount"] for r in rows))}

    def salary_register(self):
        rows = []
        for v in self.vouchers:
            if v["type"] != "Payroll":
                continue
            for emp in v.get("employees", []):
                st = emp["structure"]
                # Server math: deductions sum by head TYPE and are always positive;
                # net = gross - deductions. (A-03: server accepts negative deduction
                # amounts and inflates net — recorded separately, not mirrored here.)
                # Server math: gross = Σ earning heads; ded = Σ deduction heads.
                heads = v.get("heads", {})
                gross = R(sum(float(x) for k, x in st.items()
                              if heads.get(k, {}).get("type") != "deduction"))
                ded = R(sum(abs(float(x)) for k, x in st.items()
                            if heads.get(k, {}).get("type") == "deduction"))
                rows.append({"month": v.get("payrollMonth", v["date"][:7]), "employee": emp["name"],
                             "gross": gross, "deductions": ded, "net": R(gross - ded)})
        return rows

    # ---------------- balance sheet ----------------
    def bs(self, as_of):
        clos = self.ledger_closings(as_of)
        pl = self.pnl(self.fyStart, as_of)
        stock = self.stock_position(as_of)
        stock_val = R(sum(p["value"] for p in stock.values()))
        assets, liabs = {}, {}
        for n, v in clos.items():
            g = self.ledgers[n].get("group")
            if g == "Stock-in-Hand":
                continue  # replaced by inventory valuation
            if g in ASSET_GROUPS:
                assets[g] = R(assets.get(g, 0) + v)
            elif g in LIAB_GROUPS:
                liabs[g] = R(liabs.get(g, 0) + v)
        assets["Stock-in-Hand"] = stock_val
        # Liabilities are credit-normal: ledger closings are negative → positive display.
        # Server adds signed pnl.netProfit (a loss reduces liabilities) AFTER the flip.
        assets = {k: R(v) for k, v in assets.items() if abs(v) > 0.004}
        liabs = {k: R(-v) for k, v in liabs.items() if abs(v) > 0.004}
        if abs(pl["netProfit"]) > 0.004:
            liabs["Profit & Loss A/c"] = pl["netProfit"]
        ta = R(sum(assets.values()))
        tl = R(sum(liabs.values()))
        return {"assets": assets, "liabilities": liabs, "totalAssets": ta, "totalLiabilities": tl,
                "difference": R(tl - ta), "stockValue": stock_val, "netProfit": pl["netProfit"]}

    def cash_bank(self, frm, to):
        out = []
        for n, l in sorted(self.ledgers.items()):
            if not l.get("isBankCash"):
                continue
            op = R(float(l.get("opening", 0)))
            for v in self.vouchers:
                if v["date"] >= frm:
                    continue
                for e in self.lines_of(v):
                    if e["ledger"] == n:
                        op = R(op + e["amount"])
            pd = pc = 0.0
            for v in self.vouchers:
                if not (frm <= v["date"] <= to):
                    continue
                for e in self.lines_of(v):
                    if e["ledger"] == n:
                        if e["amount"] > 0:
                            pd = R(pd + e["amount"])
                        else:
                            pc = R(pc - e["amount"])
            out.append({"name": n, "opening": op, "periodDr": pd, "periodCr": pc,
                        "closing": R(op + pd - pc)})
        return out

    def gstr1_app(self, frm, to):
        """Mirror of the APP's GSTR-1 (R-05 semantics): Table 9 holds SUPPLIES
        only (Sales), notes are reported separately in `cdnr` with positive
        magnitudes. The proper netted variant remains gstr1()."""
        out = {"b2b": {"taxable": 0.0, "igst": 0.0, "cgst": 0.0, "sgst": 0.0, "count": 0},
               "b2c": {"taxable": 0.0, "igst": 0.0, "cgst": 0.0, "sgst": 0.0, "count": 0}}
        cn = {"taxable": 0.0, "igst": 0.0, "cgst": 0.0, "sgst": 0.0}
        # R-01: independent HSN expectation — OUTWARD SALES ONLY (voucher-type
        # semantics, never inventory direction; CN stays out of Table 12).
        hsn = {}
        for v in self.vouchers:
            if not (frm <= v["date"] <= to) or v["type"] not in ("Sales", "Credit Note"):
                continue
            g = self.gst_of(v)
            if v["type"] == "Credit Note":
                for k in ("taxable", "igst", "cgst", "sgst"):
                    cn[k] = R(cn[k] + g[k])
                continue
            b = out["b2b"] if g["b2b"] else out["b2c"]
            for k in ("taxable", "igst", "cgst", "sgst"):
                b[k] = R(b[k] + g[k])
            b["count"] += 1
            for ie in v.get("items", []):
                it = self.items[ie["item"]]
                k = (it.get("hsn", "-"), float(it.get("gstRate", 0)))
                h = hsn.setdefault(k, {"hsn": k[0], "rate": k[1], "qty": 0.0, "taxable": 0})
                h["qty"] = R(h["qty"] + abs(float(ie["qty"])))
                h["taxable"] = R(h["taxable"] + abs(float(ie.get("amount", 0))))
        self._hsn_last = list(hsn.values())
        out["cdnr"] = cn
        return out

    def gstr3b_app(self, frm, to):
        """Mirror of the APP's GSTR-3B (R-05 semantics): notes REVERSE — credit
        notes subtract from outward, debit notes subtract from ITC — so the
        net position matches the ledgers. (Pre-R-05 the app counted notes as
        positive supplies; that mirror is gone.)"""
        out = {"taxable": 0.0, "igst": 0.0, "cgst": 0.0, "sgst": 0.0}
        itc = {"taxable": 0.0, "igst": 0.0, "cgst": 0.0, "sgst": 0.0}
        for v in self.vouchers:
            if not (frm <= v["date"] <= to):
                continue
            if v["type"] not in ("Sales", "Purchase", "Credit Note", "Debit Note"):
                continue
            g = self.gst_of(v)
            bucket = out if g["direction"] == "outward" else itc
            sgn = -1 if v["type"] in CN_DN else 1
            for k in ("taxable", "igst", "cgst", "sgst"):
                bucket[k] = R(bucket[k] + sgn * g[k])
        net = {k: R(out[k] - itc[k]) for k in ("igst", "cgst", "sgst")}
        net["total"] = R(sum(net.values()))
        return {"outward": out, "itc": itc, "net": net}

    def months(self):
        res = {}
        for me in self.monthEnds:
            ms = me[:8] + "01"
            res[me] = {
                "tb": self.tb(self.fyStart, me),
                "pnl": self.pnl(self.fyStart, me),
                "pnlMonth": self.pnl(ms, me),
                "pnlAppSub": self.pnl_app_sub(ms, me),
                "bs": self.bs(me),
                "stock": self.stock_position(me),
                "stockTotal": self.stock_value(me),
                "receivables": self.bills(me, "Sundry Debtors"),
                "payables": self.bills(me, "Sundry Creditors"),
                "gstr1": self.gstr1(self.fyStart, me),
                "gstr3b": self.gstr3b(self.fyStart, me),
                "gstr1AppMonth": self.gstr1_app(ms, me),
                "hsnMonth": getattr(self, "_hsn_last", []),
                "gstr3bAppMonth": self.gstr3b_app(ms, me),
                "gstr3bAppCum": self.gstr3b_app(self.fyStart, me),
                "tds": self.tds(self.fyStart, me),
                "cashBank": self.cash_bank(self.fyStart, me),
                # O-1: sub-period cash/bank — a FIXED mid-FY window (May 1–31)
                # viewed with LATER (June) vouchers already in the books. The UI
                # scenario in run.js pins this same window. Independently computed
                # by the period-correct cash_bank() (opening < frm, movement in [frm,to]).
                "cashBankSub": self.cash_bank("2026-05-01", "2026-05-31"),
                "salesRegister": self.register(self.fyStart, me, "Sales"),
                "purchaseRegister": self.register(self.fyStart, me, "Purchase"),
                "salaryRegister": self.salary_register(),
                "ledgerClosings": self.ledger_closings(me),
            }
        return res


if __name__ == "__main__":
    state = json.load(open(sys.argv[1]))
    eng = Engine(state)
    json.dump({"months": eng.months()}, open(sys.argv[1].replace("state.json", "expected.json"), "w"), indent=1)
    print("expected.json written for", ", ".join(state["monthEnds"]))
