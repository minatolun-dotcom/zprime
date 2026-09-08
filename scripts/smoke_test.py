#!/usr/bin/env python3
"""End-to-end smoke test for zprime. Run with server NOT started (script starts it)."""
import json, os, subprocess, time, sys, urllib.request, urllib.error, http.cookiejar

BASE = "http://localhost:3100"
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

def req(method, path, body=None, raw=False, xml=False):
    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body).encode() if not isinstance(body, str) else body.encode()
        headers["Content-Type"] = "text/plain" if xml else "application/json"
    r = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    try:
        with opener.open(r) as resp:
            text = resp.read().decode()
            return resp.status, (text if raw else (json.loads(text) if text else None))
    except urllib.error.HTTPError as e:
        text = e.read().decode()
        return e.code, (text if raw else (json.loads(text) if text else {"error": text}))

PASS = 0; FAIL = 0
def check(name, cond, detail=""):
    global PASS, FAIL
    if cond: PASS += 1; print(f"  ok  {name}")
    else: FAIL += 1; print(f" FAIL {name} {detail}")

# ---------- start server ----------
subprocess.run(["docker", "exec", "zprime-test-pg", "psql", "-U", "zprime", "-c",
                "DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;"], capture_output=True, check=True)
env = dict(os.environ, DATABASE_URL="postgres://zprime:zprime@localhost:55432/zprime", PORT="3100")
server = subprocess.Popen(
    ["npx", "tsx", "server/src/index.ts"],
    cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT,
)
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

    # ---------- auth ----------
    s, b = req("POST", "/api/auth/login", {"username": "admin", "password": "admin123"})
    check("login", s == 200 and b.get("username") == "admin", b)
    s, b = req("POST", "/api/auth/login", {"username": "admin", "password": "wrong"})
    check("bad login rejected", s == 401)

    # ---------- company ----------
    s, company = req("POST", "/api/companies", {
        "name": "Demo Traders", "state": "Maharashtra", "stateCode": "27",
        "gstin": "27DEMO1234A1Z5", "financialYearStart": "2025-04-01", "booksBeginFrom": "2025-04-01",
    })
    check("create company", s == 200 and company["id"] > 0, company)
    cid = company["id"]
    C = f"/api/c/{cid}"

    s, groups = req("GET", f"{C}/groups")
    check("28 default groups", len(groups) == 28, len(groups))
    s, vts = req("GET", f"{C}/voucher-types")
    names = {v["name"] for v in vts}
    check("default voucher types", {"Sales", "Purchase", "Payment", "Receipt", "Journal", "Payroll"} <= names, names)
    vt = {v["name"]: v["id"] for v in vts}

    # ---------- masters ----------
    g = {gr["name"]: gr["id"] for gr in groups}
    s, acme = req("POST", f"{C}/ledgers", {"name": "Acme Corp", "groupId": g["Sundry Debtors"], "gstin": "27ACME5678B1C3", "gstRegistrationType": "regular", "billWise": True})
    check("create party ledger", s == 200, acme)
    s, sl = req("POST", f"{C}/ledgers", {"name": "GST Sales - Local", "groupId": g["Sales Accounts"], "taxability": "taxable", "gstRate": "18"})
    s, sl2 = req("POST", f"{C}/ledgers", {"name": "GST Sales - Inter", "groupId": g["Sales Accounts"], "taxability": "taxable", "gstRate": "18"})
    s, ledgers = req("GET", f"{C}/ledgers")
    L = {l["name"]: l["id"] for l in ledgers}
    check("starter ledgers seeded", {"Cash", "IGST", "CGST", "SGST/UTGST", "TDS Payable"} <= set(L), set(L))

    # Opening entry: item opening stock 5000 Dr Opening Stock / Cr Capital
    s, opstock = req("POST", f"{C}/ledgers", {"name": "Opening Stock", "groupId": g["Stock-in-Hand"]})
    s, capital = req("POST", f"{C}/ledgers", {"name": "Proprietor Capital", "groupId": g["Capital Account"]})
    s, journal = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Journal"], "date": "2025-04-01",
        "entries": [{"ledgerId": opstock["id"], "amount": 5000}, {"ledgerId": capital["id"], "amount": -5000}]})
    check("opening journal posted", s == 200, journal)

    s, unit = req("POST", f"{C}/units", {"name": "Numbers", "symbol": "Nos", "decimalPlaces": 0})
    s, item = req("POST", f"{C}/stock-items", {"name": "Widget A", "unitId": unit["id"], "hsnSac": "8479", "gstRate": "18", "openingQty": "100", "openingRate": "50", "openingValue": "5000"})
    check("create stock item", s == 200, item)

    # ---------- vouchers ----------
    s, v = req("POST", f"{C}/vouchers", {
        "voucherTypeId": vt["Sales"], "date": "2025-04-15", "reference": "INV-001", "partyLedgerId": acme["id"],
        "entries": [
            {"ledgerId": acme["id"], "amount": 1180, "bills": [{"billType": "new_ref", "billName": "INV-001", "amount": 1180, "dueDate": "2025-05-15"}]},
            {"ledgerId": sl["id"], "amount": -1000, "gstRate": 18},
            {"ledgerId": L["CGST"], "amount": -90, "gstRate": 9},
            {"ledgerId": L["SGST/UTGST"], "amount": -90, "gstRate": 9},
        ],
        "inventoryEntries": [{"itemId": item["id"], "qty": -10, "rate": 100, "amount": 1000, "kind": "stock", "hsnSac": "8479", "gstRate": 18}],
    })
    check("sales voucher (1180 incl GST)", s == 200 and v.get("number") == "1", v)
    sale_voucher = v.get("id")

    s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Sales"], "date": "2025-04-15", "entries": [{"ledgerId": acme["id"], "amount": 500}]})
    check("unbalanced voucher rejected", s == 400, (s, v))    # purchase on credit with party
    s, vendor = req("POST", f"{C}/ledgers", {"name": "Supplies & Co", "groupId": g["Sundry Creditors"], "gstin": "27SUPP9999C1D9", "gstRegistrationType": "regular", "billWise": True})  # noqa
    s, pl = req("POST", f"{C}/ledgers", {"name": "GST Purchases", "groupId": g["Purchase Accounts"], "taxability": "taxable", "gstRate": "18"})
    s, v = req("POST", f"{C}/vouchers", {
        "voucherTypeId": vt["Purchase"], "date": "2025-04-10", "reference": "SUP-77", "partyLedgerId": vendor["id"],
        "entries": [
            {"ledgerId": vendor["id"], "amount": -590, "bills": [{"billType": "new_ref", "billName": "SUP-77", "amount": -590}]},
            {"ledgerId": pl["id"], "amount": 500, "gstRate": 18},
            {"ledgerId": L["CGST"], "amount": 45, "gstRate": 9},
            {"ledgerId": L["SGST/UTGST"], "amount": 45, "gstRate": 9},
        ],
        "inventoryEntries": [{"itemId": item["id"], "qty": 5, "rate": 100, "amount": 500, "kind": "stock"}],
    })
    check("purchase voucher (590 incl GST)", s == 200, v)
    purchase_voucher = v.get("id")

    s, v = req("POST", f"{C}/vouchers", {
        "voucherTypeId": vt["Receipt"], "date": "2025-04-20", "partyLedgerId": acme["id"],
        "entries": [
            {"ledgerId": L["Cash"], "amount": 600},
            {"ledgerId": acme["id"], "amount": -600, "bills": [{"billType": "against_ref", "billName": "INV-001", "amount": -600}]},
        ],
    })
    check("receipt voucher against bill", s == 200, v)
    receipt_voucher = v.get("id")

    # payment with cheque + TDS deduction
    s, wages = req("POST", f"{C}/ledgers", {"name": "Contractor Charges", "groupId": g["Indirect Expenses"], "tdsSectionId": None})
    s, tds194c = req("POST", f"{C}/tds-sections", {"section": "194C", "description": "Contractor", "rate": "2", "threshold": "30000"})
    s, _ = req("PUT", f"{C}/ledgers/{wages['id']}", {"tdsSectionId": tds194c["id"]})
    s, v = req("POST", f"{C}/vouchers", {
        "voucherTypeId": vt["Payment"], "date": "2025-04-25", "chequeNumber": "100234", "narration": "Being contractor paid",
        "entries": [
            {"ledgerId": wages["id"], "amount": 10000, "tdsSectionId": tds194c["id"]},
            {"ledgerId": L["TDS Payable"], "amount": -200, "tdsSectionId": tds194c["id"]},
            {"ledgerId": L["Cash"], "amount": -9800},
        ],
    })
    check("payment voucher with cheque + TDS", s == 200, v)

    # stock journal: 2 units of A -> 1 unit of B
    s, item_b = req("POST", f"{C}/stock-items", {"name": "Widget Kit", "unitId": unit["id"], "gstRate": "18", "openingQty": "0", "openingRate": "0", "openingValue": "0"})
    s, v = req("POST", f"{C}/vouchers", {
        "voucherTypeId": vt["Stock Journal"], "date": "2025-04-26",
        "entries": [{"ledgerId": L["Cash"], "amount": 0}],
        "inventoryEntries": [
            {"itemId": item["id"], "qty": -2, "rate": 50, "amount": 100, "kind": "source"},
            {"itemId": item_b["id"], "qty": 1, "rate": 100, "amount": 100, "kind": "target"},
        ],
    })
    check("stock journal (2A -> 1 Kit)", s == 200, v)

    # ---------- reports ----------
    s, tb = req("GET", f"{C}/reports/trial-balance?from=2025-04-01&to=2025-04-30")
    check("trial balance balanced", tb["totalDebit"] == tb["totalCredit"], (tb["totalDebit"], tb["totalCredit"]))

    s, day = req("GET", f"{C}/vouchers?from=2025-04-01&to=2025-04-30")
    check("day book has 6 vouchers", len(day) == 6, len(day))

    s, lv = req("GET", f"{C}/reports/ledger-vouchers/{acme['id']}?from=2025-04-01&to=2025-04-30")
    check("ledger vouchers Acme: closing 580", lv["closing"] == 580, lv["closing"])

    s, rec = req("GET", f"{C}/reports/receivables?to=2025-04-30")
    check("receivables: 580 outstanding on INV-001", abs(rec["total"] - 580) < 0.01, rec["total"])

    s, pay = req("GET", f"{C}/reports/payables?to=2025-04-30")
    check("payables: 590", abs(pay["total"] + 590) < 0.01 or abs(pay["total"] - 590) < 0.01, pay["total"])

    s, stock = req("GET", f"{C}/reports/stock-summary?to=2025-04-30")
    sm = {i["name"]: i for i in stock}
    check("stock: Widget A 93 (100+5-10-2)", sm["Widget A"]["closingQty"] == 93, sm["Widget A"]["closingQty"])
    check("stock: Widget Kit 1", sm["Widget Kit"]["closingQty"] == 1, sm.get("Widget Kit"))

    s, bs = req("GET", f"{C}/reports/balance-sheet?to=2025-04-30")
    check("balance sheet balances", abs(bs["difference"]) < 0.01, (bs["totalLiabilities"], bs["totalAssets"], bs["difference"]))

    s, pnl = req("GET", f"{C}/reports/profit-loss?from=2025-04-01&to=2025-04-30")
    check("P&L net = 1000-500-10000+... TDS-ledger sales only", isinstance(pnl["netProfit"], (int, float)), pnl["netProfit"])

    s, g1 = req("GET", f"{C}/reports/gstr1?from=2025-04-01&to=2025-04-30")
    check("GSTR-1 B2B has sales invoice", len(g1["b2b"]) == 1 and g1["b2b"][0]["taxable"] == 1000, g1["b2b"])
    check("GSTR-1 CGST 90 SGST 90", g1["totals"]["b2bCgst"] == 90 and g1["totals"]["b2bSgst"] == 90, g1["totals"])

    s, g3 = req("GET", f"{C}/reports/gstr3b?from=2025-04-01&to=2025-04-30")
    check("GSTR-3B net cgst = 45", abs(g3["net"]["cgst"] - 45) < 0.01, g3["net"])
    check("GSTR-3B net sgst = 45", abs(g3["net"]["sgst"] - 45) < 0.01, g3["net"])

    s, tds = req("GET", f"{C}/reports/tds?from=2025-04-01&to=2025-04-30")
    check("TDS report has 194C 200", any(x["section"] == "194C" and x["amount"] == 200 for x in tds["sections"]), tds["sections"])

    s, chq = req("GET", f"{C}/cheque-register")
    check("cheque register 100234", len(chq) == 1 and chq[0]["chequeNumber"] == "100234", chq)

    # voucher detail roundtrip
    s, detail = req("GET", f"{C}/vouchers/{sale_voucher}")
    check("voucher detail loads", s == 200 and len(detail["entries"]) == 4, detail.get("entries"))
    s, _ = req("DELETE", f"{C}/vouchers/{purchase_voucher}")
    s, day = req("GET", f"{C}/vouchers?from=2025-04-01&to=2025-04-30")
    check("voucher deleted", len(day) == 5, len(day))

    # ---------- payroll ----------
    s, emp = req("POST", f"{C}/employees", {"name": "Ravi Kumar", "designation": "Manager", "isActive": True})
    s, sal_ledger = req("POST", f"{C}/ledgers", {"name": "Salaries & Wages", "groupId": g["Indirect Expenses"]})
    s, pf = req("POST", f"{C}/ledgers", {"name": "PF Payable", "groupId": g["Current Liabilities"]})
    s, ph1 = req("POST", f"{C}/pay-heads", {"name": "Basic Salary", "type": "earning", "ledgerId": sal_ledger["id"], "affectsGross": True})
    s, ph2 = req("POST", f"{C}/pay-heads", {"name": "PF Deduction", "type": "deduction", "ledgerId": pf["id"], "affectsGross": True})
    s, _ = req("PUT", f"{C}/salary-structure/{emp['id']}", {"lines": [{"headId": ph1["id"], "monthlyAmount": 50000}, {"headId": ph2["id"], "monthlyAmount": 1800}]})
    s, res = req("POST", f"{C}/payroll/process", {"month": "2025-04"})
    check("payroll processed (48200 net)", s == 200 and abs(res.get("total", 0) - 48200) < 0.01, res)
    s, sr = req("GET", f"{C}/reports/salary-register")
    check("salary register row", len(sr) == 1 and abs(float(sr[0]["net"]) - 48200) < 0.01, sr)

    # payroll duplication guard
    s, res2 = req("POST", f"{C}/payroll/process", {"month": "2025-04"})
    check("payroll duplicate rejected", s == 400, res2)

    # ---------- XML import ----------
    xml = """<ENVELOPE>
 <BODY><IMPORTDATA><REQUESTDATA>
  <TALLYMESSAGE>
   <LEDGER NAME="Imported Customer">
    <PARENT>Sundry Debtors</PARENT>
    <OPENINGBALANCE>2500.00Dr</OPENINGBALANCE>
    <GSTIN>27IMPORT0000I1Z0</GSTIN>
   </LEDGER>
   <STOCKITEM NAME="Imported Item"><BASEUNITS>Nos</BASEUNITS><GSTRATE>18</GSTRATE><OPENINGBALANCE> 5 Nos</OPENINGBALANCE><STANDARDCOST>200.00</STANDARDCOST></STOCKITEM>
   <VOUCHER VCHTYPE="Sales" DATE="20250501" ACTION="Create">
    <DATE>20250501</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>IMP-01</VOUCHERNUMBER>
    <PARTYLEDGERNAME>Imported Customer</PARTYLEDGERNAME>
    <ALLINVENTORYENTRIES.LIST>
     <STOCKITEMNAME>Imported Item</STOCKITEMNAME><ACTUALQTY> 2 Nos</ACTUALQTY><RATE>200.00/Nos</RATE><AMOUNT>400.00</AMOUNT>
    </ALLINVENTORYENTRIES.LIST>
    <ALLLEDGERENTRIES.LIST><LEDGERNAME>Imported Customer</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-472.00</AMOUNT></ALLLEDGERENTRIES.LIST>
    <ALLLEDGERENTRIES.LIST><LEDGERNAME>GST Sales - Local</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>-400.00</AMOUNT></ALLLEDGERENTRIES.LIST>
    <ALLLEDGERENTRIES.LIST><LEDGERNAME>CGST</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>-36.00</AMOUNT></ALLLEDGERENTRIES.LIST>
    <ALLLEDGERENTRIES.LIST><LEDGERNAME>SGST/UTGST</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>-36.00</AMOUNT></ALLLEDGERENTRIES.LIST>
   </VOUCHER>
  </TALLYMESSAGE>
 </REQUESTDATA></IMPORTDATA></BODY>
</ENVELOPE>"""
    s, imp = req("POST", f"{C}/import/xml", xml, xml=True)
    check("xml import: 1 ledger, 1 item, 1 voucher", s == 200 and imp["ledgers"] == 1 and imp["items"] == 1 and imp["vouchers"] == 1, imp)
    s, day = req("GET", f"{C}/vouchers?from=2025-05-01&to=2025-05-31")
    check("imported voucher in day book", any(v["number"] == "IMP-01" for v in day), day)
    s, imp2 = req("POST", f"{C}/import/xml", xml, xml=True)
    check("re-import skips duplicates", imp2["vouchers"] == 0 and imp2["skipped"] >= 1, imp2)

    # ---------- static client ----------
    s, html = req("GET", "/", raw=True)
    check("client served", "<div id=\"root\">" in html, html[:80])

finally:
    server.terminate()
    try: server.wait(timeout=5)
    except Exception: server.kill()

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
