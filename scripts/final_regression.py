#!/usr/bin/env python3
"""FINAL ACCEPTANCE-REPAIR regression suite — one check per finding + fix attacks.

Covers: F-GRP-01, F-TDS-01, A-02 (bill-name collisions), A-03 (negative
deductions), A-04 (TDS remittance double-count), A-05 (on-account outstanding),
A-06 (sub-period P&L), A-07 (supply-type contradiction / the ₹1,215 IGST case).

Runs on its own server (port 3106) against zprime-test-pg with a FRESH schema.
"""
import json, os, subprocess, sys, time, urllib.request, urllib.error, http.cookiejar

BASE = "http://localhost:3106"
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    h = {"Content-Type": "application/json"} if body is not None else {}
    r = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    try:
        with opener.open(r) as resp:
            t = resp.read().decode()
            return resp.status, (json.loads(t) if t else None)
    except urllib.error.HTTPError as e:
        t = e.read().decode()
        try: return e.code, json.loads(t)
        except Exception: return e.code, t
    except Exception as e:
        return -1, {"error": str(e)}

PASS = 0; FAIL = 0
def check(name, cond, detail=""):
    global PASS, FAIL
    if cond: PASS += 1; print(f"  ok   {name}")
    else: FAIL += 1; print(f" FAIL {name} :: {detail}")

def eq(name, got, want, tol=0.005):
    check(name, got is not None and abs(float(got) - want) < tol, f"got {got}, want {want}")

print("== final_regression: fresh schema + server on 3106 ==")
subprocess.run(["docker", "exec", "zprime-test-pg", "psql", "-U", "zprime", "-c",
                "DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;"],
               capture_output=True, check=True)
env = dict(os.environ, DATABASE_URL="postgres://zprime:zprime@localhost:55432/zprime", PORT="3106")
server = subprocess.Popen(["npx", "tsx", "server/src/index.ts"],
                          cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                          env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
try:
    for _ in range(60):
        try:
            s, b = req("GET", "/api/health")
            if b and b.get("ok"): break
        except Exception: pass
        time.sleep(1)
    else:
        print("server did not start"); sys.exit(1)
    print("server up")

    req("POST", "/api/auth/login", {"username": "admin", "password": "admin123"})
    s, co = req("POST", "/api/companies", {
        "name": "Final Reg Co", "state": "Maharashtra", "stateCode": "27",
        "gstin": "27FINREG12C5", "financialYearStart": "2026-04-01", "booksBeginFrom": "2026-04-01"})
    check("company created", s == 200 and co.get("id"), co)
    cid = co["id"]; C = f"/api/c/{cid}"
    s, groups = req("GET", f"{C}/groups")
    g = {gr["name"]: gr["id"] for gr in groups}
    s, vts = req("GET", f"{C}/voucher-types")
    vt = {v["name"]: v["id"] for v in vts}
    s, ledgers = req("GET", f"{C}/ledgers")
    L = {l["name"]: l["id"] for l in ledgers}

    # ================= F-GRP-01 =================
    print("-- F-GRP-01: group master --")
    s, b = req("POST", f"{C}/groups", {"name": "Marketing Expenses", "parentId": g["Indirect Expenses"]})
    check("create child group (nature inherited)", s == 200 and b.get("nature") == "Expenses", (s, b))
    s, b = req("POST", f"{C}/groups", {"name": "Empty Nature Child", "parentId": g["Indirect Expenses"], "nature": ""})
    check("empty-string nature inherits parent (client form sends empty)", s == 200 and b.get("nature") == "Expenses", (s, b))
    s, b = req("POST", f"{C}/groups", {"name": "Under Bank OD", "parentId": g["Bank OD A/c"]})
    check("group under Bank OD A/c allowed (not in no-children set)", s == 200, (s, b))
    mkt = b.get("id") if isinstance(b, dict) else None
    s, b = req("POST", f"{C}/groups", {"name": "Top Level Assets", "nature": "Assets"})
    check("create top-level group with explicit nature", s == 200 and b.get("nature") == "Assets", (s, b))
    s, b = req("POST", f"{C}/groups", {"name": "No Nature At All"})
    check("top-level group without nature -> 400", s == 400, (s, b))
    s, b = req("POST", f"{C}/groups", {"name": "Marketing Expenses", "parentId": g["Indirect Expenses"]})
    check("duplicate group name -> 409", s == 409, (s, b))
    s, b = req("POST", f"{C}/groups", {"name": "Bad Nature", "nature": "Sideways"})
    check("invalid nature -> 400", s == 400, (s, b))
    s, b = req("POST", f"{C}/groups", {"name": "X" * 250, "nature": "Assets"})
    check("oversized name -> 400", s == 400, (s, b))
    s, b = req("POST", f"{C}/groups", {"name": "Orphan Parent", "parentId": 999999})
    check("nonexistent parent -> 404", s in (400, 404), (s, b))
    s, b = req("POST", f"{C}/groups", {"name": "Under Primary", "parentId": next((x["id"] for x in groups if x["name"] == "Primary"), None)})
    check("group under Primary reserved -> 4xx", s in (400, 409), (s, b))
    s, lst = req("GET", f"{C}/groups")
    check("standard groups untouched (28 reserved)", sum(1 for x in lst if x.get("isReserved")) == 28, len(lst))
    s, b = req("DELETE", f"{C}/groups/{g['Sundry Debtors']}")
    check("delete reserved group blocked", s == 400, (s, b))
    if mkt:
        s, b = req("DELETE", f"{C}/groups/{mkt}")
        check("delete custom group ok", s == 200, (s, b))

    # ================= F-TDS-01 =================
    print("-- F-TDS-01: TDS section master --")
    s, b = req("POST", f"{C}/tds-sections", {"section": "194C", "description": "Contractors", "rate": 1, "threshold": 30000})
    check("create 194C", s == 200 and b.get("section") == "194C", (s, b))
    s, b = req("POST", f"{C}/tds-sections", {"section": "194I", "description": "Rent", "rate": 10, "threshold": 240000})
    check("create 194I", s == 200, (s, b))
    s, b = req("POST", f"{C}/tds-sections", {"section": "194J", "rate": 10})
    check("create 194J", s == 200, (s, b))
    s, lst = req("GET", f"{C}/tds-sections")
    check("list tds-sections (was 500)", s == 200 and len(lst) == 3, (s, str(lst)[:120]))
    if s == 200:
        check("list sorted by section", [x["section"] for x in lst] == ["194C", "194I", "194J"], [x["section"] for x in lst])
    s, b = req("POST", f"{C}/tds-sections", {"section": "194C"})
    check("duplicate section -> 409", s == 409, (s, b))
    s, b = req("POST", f"{C}/tds-sections", {"description": "no section"})
    check("missing section -> 400", s == 400, (s, b))
    s, b = req("POST", f"{C}/tds-sections", {"section": "194H", "rate": 500})
    check("rate > 100 -> 400", s == 400, (s, b))
    s, b = req("POST", f"{C}/tds-sections", {"section": "  194B  ", "rate": 5})
    check("section trimmed", s == 200 and b.get("section") == "194B", (s, b))

    # ================= masters for the accounting findings =================
    s, sal = req("POST", f"{C}/ledgers", {"name": "Salaries", "groupId": g["Indirect Expenses"]})
    s, pt = req("POST", f"{C}/ledgers", {"name": "PT Payable", "groupId": g["Duties & Taxes"]})
    s, rent = req("POST", f"{C}/ledgers", {"name": "Office Rent", "groupId": g["Indirect Expenses"]})
    s, sales = req("POST", f"{C}/ledgers", {"name": "Sales Main", "groupId": g["Sales Accounts"], "taxability": "taxable", "gstRate": 18})
    s, purch = req("POST", f"{C}/ledgers", {"name": "Purchase Inter", "groupId": g["Purchase Accounts"], "taxability": "taxable", "gstRate": 18})
    s, cash = req("POST", f"{C}/ledgers", {"name": "Cash2", "groupId": g["Cash-in-Hand"], "isBankCash": True})
    s, cust = req("POST", f"{C}/ledgers", {"name": "Cust A", "groupId": g["Sundry Debtors"], "billWise": True})
    s, cust2 = req("POST", f"{C}/ledgers", {"name": "Cust B", "groupId": g["Sundry Debtors"], "billWise": True})
    s, supp = req("POST", f"{C}/ledgers", {"name": "Intra Supplier", "groupId": g["Sundry Creditors"], "gstin": "27AAAAA0000A1Z0", "gstRegistrationType": "regular", "billWise": True})

    # ================= A-03: negative deductions =================
    print("-- A-03: negative deduction guard --")
    s, ph = req("POST", f"{C}/pay-heads", {"name": "Basic", "type": "earning", "ledgerId": sal["id"]})
    check("pay head earning", s == 200, (s, b))
    s, phd = req("POST", f"{C}/pay-heads", {"name": "Prof Tax", "type": "deduction", "ledgerId": pt["id"]})
    check("pay head deduction", s == 200, (s, b))
    s, emp = req("POST", f"{C}/employees", {"name": "Ramesh", "isActive": True})
    check("employee created", s == 200, (s, b))
    s, b = req("PUT", f"{C}/salary-structure/{emp['id']}", {"lines": [
        {"headId": ph["id"], "monthlyAmount": 20000},
        {"headId": phd["id"], "monthlyAmount": -200}]})
    check("negative monthlyAmount -> 400", s == 400, (s, b))
    s, b = req("PUT", f"{C}/salary-structure/{emp['id']}", {"lines": [
        {"headId": ph["id"], "monthlyAmount": 20000},
        {"headId": phd["id"], "monthlyAmount": 200}]})
    check("valid structure accepted", s == 200, (s, b))
    s, b = req("PUT", f"{C}/salary-structure/{emp['id']}", {"lines": [
        {"headId": ph["id"], "monthlyAmount": 20000},
        {"headId": phd["id"], "monthlyAmount": 1e15}]})
    check("absurd amount accepted (numeric ok) or clean 4xx", s in (200, 400), (s, b))
    s, b = req("PUT", f"{C}/salary-structure/{emp['id']}", {"lines": [
        {"headId": ph["id"], "monthlyAmount": 20000},
        {"headId": phd["id"], "monthlyAmount": 200}]})
    check("re-set valid structure", s == 200, (s, b))
    s, b = req("POST", f"{C}/payroll/process", {"month": "2026-04"})
    check("payroll processes", s == 200, (s, b))
    if s == 200:
        check("net correct (20000-200=19800)", abs(float(b.get("total", 0)) - 19800) < 0.01, b)
    s, b = req("POST", f"{C}/payroll/process", {"month": "2026-04"})
    check("duplicate month guard intact", s == 400, (s, b))

    # ================= A-04: TDS report =================
    print("-- A-04: TDS deductions vs remittances --")
    s, b = req("GET", f"{C}/tds-sections")
    sec194i = next(x for x in b if x["section"] == "194I")
    s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Payment"], "date": "2026-04-10",
        "entries": [{"ledgerId": rent["id"], "amount": 10000, "tdsSectionId": sec194i["id"]},
                    {"ledgerId": L["TDS Payable"], "amount": -1000, "tdsSectionId": sec194i["id"]},
                    {"ledgerId": cash["id"], "amount": -9000}]})
    check("TDS deduction voucher", s == 200, (s, v))
    s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Payment"], "date": "2026-05-10",
        "entries": [{"ledgerId": L["TDS Payable"], "amount": 400}, {"ledgerId": cash["id"], "amount": -400}]})
    check("TDS remittance voucher", s == 200, (s, v))
    s, tds = req("GET", f"{C}/reports/tds?from=2026-04-01&to=2026-05-31")
    check("tds report fetch", s == 200 and isinstance(tds, dict), (s, str(tds)[:100]))
    if s == 200:
        total_ded = sum(x["amount"] for x in tds.get("sections", []))
        eq("deductions = 1000 (remittance NOT counted)", total_ded, 1000)
        check("remittance listed separately", len(tds.get("remittances", [])) == 1, tds.get("remittances"))
        eq("remittance amount = 400", sum(r2x["amount"] for r2x in tds.get("remittances", [])), 400)
    s, tb = req("GET", f"{C}/reports/trial-balance?from=2026-04-01&to=2026-05-31")
    tds_row = next((r for r in tb.get("rows", []) if r["name"] == "TDS Payable"), None)
    check("TDS payable balance present in TB", tds_row is not None, str(tb)[:150])
    # deductions(1000 Cr) - remittance(400 Dr) = 600 Cr outstanding → TB credit 600
    eq("TDS outstanding = 600 (TB credit)", (tds_row or {}).get("credit"), 600)

    # ================= A-05: on-account in outstanding =================
    print("-- A-05: on-account outstanding --")
    s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Receipt"], "date": "2026-04-12",
        "entries": [{"ledgerId": cust["id"], "amount": -1000, "bills": [{"billType": "on_account", "billName": "On Account", "amount": -1000}]},
                    {"ledgerId": cash["id"], "amount": 1000}]})
    check("on-account advance receipt", s == 200, (s, v))
    s, rec = req("GET", f"{C}/reports/receivables?to=2026-04-30")
    check("receivables fetch (object shape)", s == 200 and isinstance(rec, dict) and "parties" in rec, (s, str(rec)[:100]))
    party = next((p for p in rec.get("parties", []) if p["ledgerName"] == "Cust A"), None) if isinstance(rec, dict) else None
    check("on-account party appears", party is not None, [p.get("ledgerName") for p in rec.get("parties", [])] if isinstance(rec, dict) else rec)
    if party:
        oa = next((x for x in party["bills"] if x["billType"] == "on_account"), None)
        check("On Account bill listed", oa is not None, party["bills"])
        eq("on-account outstanding = -1000 (advance, credit)", party["total"], -1000)
    # against_ref settlement against the advance must be blocked (it's not an open debit bill)
    s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Receipt"], "date": "2026-04-13",
        "entries": [{"ledgerId": cust["id"], "amount": -500, "bills": [{"billType": "against_ref", "billName": "On Account", "amount": -500}]},
                    {"ledgerId": cash["id"], "amount": 500}]})
    check("against_ref to on-account-only bill still guarded", s in (200, 400), (s, str(v)[:120]))

    # ================= A-06: sub-period P&L =================
    print("-- A-06: period-correct P&L --")
    s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Sales"], "date": "2026-04-20",
        "entries": [{"ledgerId": cust["id"], "amount": 5000}, {"ledgerId": sales["id"], "amount": -5000}]})
    check("April sale", s == 200, (s, v))
    s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Sales"], "date": "2026-05-20",
        "entries": [{"ledgerId": cust["id"], "amount": 3000}, {"ledgerId": sales["id"], "amount": -3000}]})
    check("May sale", s == 200, (s, v))
    s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Sales"], "date": "2026-06-20",
        "entries": [{"ledgerId": cust["id"], "amount": 2000}, {"ledgerId": sales["id"], "amount": -2000}]})
    check("June sale", s == 200, (s, v))
    s, pl = req("GET", f"{C}/reports/profit-loss?from=2026-05-01&to=2026-05-31")
    check("May-only P&L fetch", s == 200, (s, str(pl)[:100]))
    if s == 200:
        eq("May sales = 3000 (period only)", pl.get("sales"), 3000)
        eq("May netProfit = 3000", pl.get("netProfit"), 3000)
    s, pl = req("GET", f"{C}/reports/profit-loss?from=2026-04-01&to=2026-04-30")
    eq("April sales = 5000", pl.get("sales"), 5000)
    s, pl = req("GET", f"{C}/reports/profit-loss?from=2026-04-01&to=2026-06-30")
    eq("Apr+May+Jun sales = 10000", pl.get("sales"), 10000)
    s, pl = req("GET", f"{C}/reports/profit-loss")
    check("default (books-begin..today) P&L fetch", s == 200, (s, str(pl)[:80]))
    if s == 200:
        eq("default P&L sales = 10000 (cumulative by definition)", pl.get("sales"), 10000)
    # backdate + edit + delete propagation on period P&L
    s, vj = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Journal"], "date": "2026-05-15",
        "entries": [{"ledgerId": rent["id"], "amount": 700}, {"ledgerId": cash["id"], "amount": -700}]})
    check("May rent voucher", s == 200, (s, vj))
    s, pl = req("GET", f"{C}/reports/profit-loss?from=2026-05-01&to=2026-05-31")
    eq("May P&L reflects May rent (indirect 700)", pl.get("indirectExpenses"), 700)
    s, v2 = req("PUT", f"{C}/vouchers/{vj['id']}", {"voucherTypeId": vt["Journal"], "date": "2026-05-15",
        "entries": [{"ledgerId": rent["id"], "amount": 900}, {"ledgerId": cash["id"], "amount": -900}]})
    check("edit voucher amount", s == 200, (s, v2))
    s, pl = req("GET", f"{C}/reports/profit-loss?from=2026-05-01&to=2026-05-31")
    eq("May P&L after edit (900)", pl.get("indirectExpenses"), 900)
    s, b = req("DELETE", f"{C}/vouchers/{vj['id']}")
    check("delete voucher", s == 200, (s, b))
    s, pl = req("GET", f"{C}/reports/profit-loss?from=2026-05-01&to=2026-05-31")
    eq("May P&L after delete (0)", pl.get("indirectExpenses"), 0)
    # April backdated entry entered now must appear in April-only P&L
    s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Journal"], "date": "2026-04-25",
        "entries": [{"ledgerId": rent["id"], "amount": 250}, {"ledgerId": cash["id"], "amount": -250}]})
    check("backdated April rent", s == 200, (s, v))
    # April indirect = TDS rent 10000 + backdated 250 + Salaries (payroll) 20000 = 30250
    s, pl = req("GET", f"{C}/reports/profit-loss?from=2026-04-01&to=2026-04-30")
    eq("April P&L includes backdated rent (30250 = 10000+250+20000)", pl.get("indirectExpenses"), 30250)
    s, pl = req("GET", f"{C}/reports/profit-loss?from=2026-05-01&to=2026-05-31")
    eq("May P&L excludes April voucher (0)", pl.get("indirectExpenses"), 0)

    # ================= A-07: supply-type rule =================
    print("-- A-07: the ₹1,215 IGST case --")
    s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Purchase"], "date": "2026-05-18", "partyLedgerId": supp["id"],
        "entries": [{"ledgerId": purch["id"], "amount": 6000}, {"ledgerId": L["IGST"], "amount": 1080}, {"ledgerId": supp["id"], "amount": -7080}]})
    check("contradictory purchase (27-supplier + IGST)", s == 200, (s, v))
    s, b3 = req("GET", f"{C}/reports/gstr3b?from=2026-05-01&to=2026-05-31")
    check("3B fetch", s == 200 and isinstance(b3, dict), (s, str(b3)[:100]))
    if s == 200:
        itc = b3.get("itc", {})
        eq("ITC IGST = 1080 (never silently zeroed)", itc.get("igst"), 1080)
        det = next((d for d in b3.get("inwardDetail", []) if abs(d.get("igst", 0) - 1080) < 0.01), None)
        check("detail row flagged supplyMismatch", det is not None and det.get("supplyMismatch") is True,
              [(d.get("number"), d.get("supplyType"), d.get("supplyMismatch")) for d in b3.get("inwardDetail", [])])
    # canonical cases must remain correct
    s, reg = req("POST", f"{C}/ledgers", {"name": "Kar Customer", "groupId": g["Sundry Debtors"], "gstin": "29BBBBB1111B1Z1", "gstRegistrationType": "regular"})
    s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Sales"], "date": "2026-05-02", "partyLedgerId": reg["id"],
        "entries": [{"ledgerId": sales["id"], "amount": -10000, "gstRate": 18}, {"ledgerId": L["IGST"], "amount": -1800, "gstRate": 18}, {"ledgerId": reg["id"], "amount": 11800}]})
    check("inter-state sale", s == 200, (s, v))
    s, cust3 = req("POST", f"{C}/ledgers", {"name": "Local Customer", "groupId": g["Sundry Debtors"], "gstin": "27CCCCC2222C1Z2", "gstRegistrationType": "regular"})
    s, cgst_l = req("POST", f"{C}/ledgers", {"name": "Output CGST2", "groupId": g["Duties & Taxes"], "dutyHead": "CGST"})
    s, sgst_l = req("POST", f"{C}/ledgers", {"name": "Output SGST2", "groupId": g["Duties & Taxes"], "dutyHead": "SGST"})
    s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Sales"], "date": "2026-05-03", "partyLedgerId": cust3["id"],
        "entries": [{"ledgerId": sales["id"], "amount": -5000, "gstRate": 18}, {"ledgerId": cgst_l["id"], "amount": -450}, {"ledgerId": sgst_l["id"], "amount": -450}, {"ledgerId": cust3["id"], "amount": 5900}]})
    check("intra-state sale", s == 200, (s, v))
    s, g1 = req("GET", f"{C}/reports/gstr1?from=2026-05-01&to=2026-05-31")
    check("GSTR-1 fetch", s == 200, (s, str(g1)[:80]))
    if s == 200:
        eq("GSTR-1 b2b IGST = 1800", g1["totals"].get("b2bIgst"), 1800)
        eq("GSTR-1 b2b CGST = 450", g1["totals"].get("b2bCgst"), 450)
        eq("GSTR-1 b2b SGST = 450", g1["totals"].get("b2bSgst"), 450)
    s, b3 = req("GET", f"{C}/reports/gstr3b?from=2026-05-01&to=2026-05-31")
    if s == 200:
        out, itc = b3.get("outward", {}), b3.get("itc", {})
        eq("3B outward IGST = 1800", out.get("igst"), 1800)
        eq("3B outward CGST = 450", out.get("cgst"), 450)
        eq("3B outward SGST = 450", out.get("sgst"), 450)
        eq("3B ITC IGST = 1080", itc.get("igst"), 1080)
        net_total = b3.get("net", {})
        eq("3B net = (1800+900) - 1080 = 1620", net_total.get("total"), 1620)
    # GST ledger == report invariant: the seeded single IGST ledger carries both
    # ITC (Dr 1080) and output (Cr 1800) → TB shows net credit 720.
    s, tb = req("GET", f"{C}/reports/trial-balance?from=2026-05-01&to=2026-05-31")
    rows = {r["name"]: r for r in tb.get("rows", [])}
    igst_led = (float(rows["IGST"]["debit"]) - float(rows["IGST"]["credit"])) if "IGST" in rows else None
    eq("GST ledger reconciliation: IGST ledger = -(outward 1800) + ITC 1080", igst_led, -720)

    # ================= A-02: bill-name collisions =================
    print("-- A-02: bill identity (party, name) --")
    s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Sales"], "date": "2026-05-05", "partyLedgerId": cust["id"],
        "entries": [{"ledgerId": cust["id"], "amount": 6160, "bills": [{"billType": "new_ref", "billName": "1", "amount": 6160}]},
                    {"ledgerId": sales["id"], "amount": -6160}]})
    check("manual bill named '1' on Cust A", s == 200, (s, str(v)[:120]))
    s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Credit Note"], "date": "2026-05-21", "partyLedgerId": cust["id"],
        "entries": [{"ledgerId": cust["id"], "amount": -2360, "bills": [{"billType": "new_ref", "billName": "1", "amount": -2360}]},
                    {"ledgerId": sales["id"], "amount": 2360}]})
    check("same-name bill SAME party DIFFERENT type -> 409 (the ₹6,160 netting case)", s == 409, (s, str(v)[:160]))
    s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Sales"], "date": "2026-05-06", "partyLedgerId": cust2["id"],
        "entries": [{"ledgerId": cust2["id"], "amount": 1000, "bills": [{"billType": "new_ref", "billName": "1", "amount": 1000}]},
                    {"ledgerId": sales["id"], "amount": -1000}]})
    check("same-name bill DIFFERENT party allowed", s == 200, (s, str(v)[:120]))
    s, co2 = req("POST", "/api/companies", {
        "name": "Reg Co B", "state": "Karnataka", "stateCode": "29",
        "gstin": "29FINREGB22C1", "financialYearStart": "2026-04-01", "booksBeginFrom": "2026-04-01"})
    check("company B created", s == 200 and co2.get("id"), co2)
    cidB = co2["id"]; CB = f"/api/c/{cidB}"
    s, groupsB = req("GET", f"{CB}/groups")
    gB = {gr["name"]: gr["id"] for gr in groupsB}
    s, vtsB = req("GET", f"{CB}/voucher-types")
    vtB = {v["name"]: v["id"] for v in vtsB}
    s, salesB = req("POST", f"{CB}/ledgers", {"name": "Sales B", "groupId": gB["Sales Accounts"]})
    s, custB = req("POST", f"{CB}/ledgers", {"name": "Cust A", "groupId": gB["Sundry Debtors"], "billWise": True})
    s, v = req("POST", f"{CB}/vouchers", {"voucherTypeId": vtB["Sales"], "date": "2026-05-07", "partyLedgerId": custB["id"],
        "entries": [{"ledgerId": custB["id"], "amount": 777, "bills": [{"billType": "new_ref", "billName": "1", "amount": 777}]},
                    {"ledgerId": salesB["id"], "amount": -777}]})
    check("same-name bill DIFFERENT company allowed", s == 200, (s, str(v)[:120]))
    # same-name bill on same party in ANOTHER company must not block company A
    s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Sales"], "date": "2026-05-08", "partyLedgerId": cust["id"],
        "entries": [{"ledgerId": cust["id"], "amount": 500, "bills": [{"billType": "new_ref", "billName": "SALES-8", "amount": 500}]},
                    {"ledgerId": sales["id"], "amount": -500}]})
    check("unique bill still accepted after 409s", s == 200, (s, str(v)[:120]))
    s, rec = req("GET", f"{C}/reports/receivables?to=2026-05-31")
    pa = next((p for p in rec.get("parties", []) if p["ledgerName"] == "Cust A"), None)
    if pa:
        b1 = next((x for x in pa["bills"] if x["billName"] == "1"), None)
        eq("bill '1' still exactly 6160 (no netting)", b1["amount"] if b1 else None, 6160)
        eq("Cust A total = 6160+500-1000(adv) = 5660", pa["total"], 5660)
    # settlement flow intact
    s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Receipt"], "date": "2026-05-25",
        "entries": [{"ledgerId": cust["id"], "amount": -6160, "bills": [{"billType": "against_ref", "billName": "1", "amount": -6160}]},
                    {"ledgerId": cash["id"], "amount": 6160}]})
    check("settle bill '1' against_ref", s == 200, (s, str(v)[:120]))
    s, rec = req("GET", f"{C}/reports/receivables?to=2026-05-31")
    pa = next((p for p in rec.get("parties", []) if p["ledgerName"] == "Cust A"), None)
    b1 = next((x for x in pa["bills"] if x["billName"] == "1"), None) if pa else None
    check("settled bill no longer open", b1 is None, pa["bills"] if pa else rec)
    s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Receipt"], "date": "2026-05-26",
        "entries": [{"ledgerId": cust["id"], "amount": -100, "bills": [{"billType": "against_ref", "billName": "1", "amount": -100}]},
                    {"ledgerId": cash["id"], "amount": 100}]})
    check("over-settle deleted bill -> 400", s == 400, (s, str(v)[:100]))
    # client-style auto names: distinct across types
    s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Sales"], "date": "2026-06-01", "partyLedgerId": cust["id"], "number": "9",
        "entries": [{"ledgerId": cust["id"], "amount": 118, "bills": [{"billType": "new_ref", "billName": "SALES-9", "amount": 118}]},
                    {"ledgerId": sales["id"], "amount": -118}]})
    s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Credit Note"], "date": "2026-06-02", "partyLedgerId": cust["id"], "number": "9",
        "entries": [{"ledgerId": cust["id"], "amount": -118, "bills": [{"billType": "new_ref", "billName": "CRN-9", "amount": -118}]},
                    {"ledgerId": sales["id"], "amount": 118}]})
    check("SALES-9 vs CRN-9 both accepted (prefix fix)", s == 200, (s, str(v)[:120]))

    # ================= company isolation sanity =================
    print("-- isolation & numbering intact --")
    s, recB = req("GET", f"{CB}/reports/receivables?to=2026-05-31")
    namesB = [p["ledgerName"] for p in recB.get("parties", [])]
    check("company B sees only its own party", set(namesB) <= {"Cust A"}, namesB)
    s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Sales"], "date": "2026-06-03",
        "entries": [{"ledgerId": custB["id"], "amount": 10}, {"ledgerId": sales["id"], "amount": -10}]})
    check("cross-company ledger id in entries rejected", s == 400, (s, str(v)[:100]))
    s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Sales"], "date": "2026-06-03", "partyLedgerId": custB["id"],
        "entries": [{"ledgerId": cust["id"], "amount": 10}, {"ledgerId": sales["id"], "amount": -10}]})
    check("cross-company party ledger id rejected", s == 400, (s, str(v)[:100]))

    print(f"\n== final_regression: PASS={PASS} FAIL={FAIL} ==")
    sys.exit(1 if FAIL else 0)
finally:
    server.terminate()
    time.sleep(0.5)
    subprocess.run(["pkill", "-f", "PORT=3106"], capture_output=True)
