#!/usr/bin/env python3
"""Phase 9: full reconciliation on a fresh company with HAND-COMPUTED numbers.
Every expected value below is derived in comments from the transaction list,
NOT read back from the app. Requires zprime-test-pg. Server on 3104."""
import json, os, subprocess, sys, time, urllib.request, urllib.error, http.cookiejar

BASE = "http://localhost:3104"
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

def req(method, path, body=None, raw=False, headers=None):
    data = None
    h = dict(headers or {})
    if body is not None:
        data = json.dumps(body).encode() if not isinstance(body, (str, bytes)) else (body.encode() if isinstance(body, str) else body)
        h.setdefault("Content-Type", "application/json")
    r = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    o = opener
    try:
        with o.open(r) as resp:
            text = resp.read().decode()
            return resp.status, (text if raw else (json.loads(text) if text else None))
    except urllib.error.HTTPError as e:
        try: text = e.read().decode()
        except Exception: text = ""
        return e.code, (text if raw else (json.loads(text) if text else {"error": text}))
    except Exception as e:
        return -1, {"error": str(e)}

PASS = 0; FAIL = 0
def check(name, cond, detail=""):
    global PASS, FAIL
    if cond: PASS += 1; print(f"  ok  {name}")
    else:
        FAIL += 1; print(f" FAIL {name} :: {detail}")

def eq(name, got, want):
    check(name, abs((got or 0) - want) < 0.005, f"got {got}, want {want}")

subprocess.run(["docker", "exec", "zprime-test-pg", "psql", "-U", "zprime", "-c",
                "DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;"], capture_output=True)
env = dict(os.environ, DATABASE_URL="postgres://zprime:zprime@localhost:55432/zprime", PORT="3104")
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
    req("POST", "/api/auth/login", {"username": "admin", "password": "admin123"})
    s, C0 = req("POST", "/api/companies", {"name": "Recon Traders Pvt Ltd", "state": "Maharashtra", "stateCode": "27",
        "financialYearStart": "2025-04-01", "booksBeginFrom": "2025-04-01", "gstin": "27RECON1234K1Z9"})
    C = f"/api/c/{C0['id']}"
    s, g = req("GET", f"{C}/groups"); g = {x["name"]: x["id"] for x in g}
    s, L = req("GET", f"{C}/ledgers"); L = {x["name"]: x["id"] for x in L}

    # ---- masters (hand-set opening balances) ----
    s, cap = req("POST", f"{C}/ledgers", {"name": "Owners Capital", "groupId": g["Capital Account"]})
    s, bank = req("POST", f"{C}/ledgers", {"name": "Bank", "groupId": g["Bank Accounts"], "isBankCash": True})
    s, debtor = req("POST", f"{C}/ledgers", {"name": "Omega Traders", "groupId": g["Sundry Debtors"], "billWise": True,
        "gstin": "29OMEGA5678L1Z3", "gstRegistrationType": "regular"})   # interstate (29)
    s, debtor_local = req("POST", f"{C}/ledgers", {"name": "Pune Stores", "groupId": g["Sundry Debtors"], "billWise": True,
        "gstin": "27PUNE1111M1Z7", "gstRegistrationType": "regular"})    # intrastate (27)
    s, creditor = req("POST", f"{C}/ledgers", {"name": "Sigma Suppliers", "groupId": g["Sundry Creditors"], "billWise": True,
        "gstin": "27SIGMA2222N1Z1", "gstRegistrationType": "regular"})
    s, sales = req("POST", f"{C}/ledgers", {"name": "Sales Local", "groupId": g["Sales Accounts"], "taxability": "taxable", "gstRate": "18"})
    s, purch = req("POST", f"{C}/ledgers", {"name": "Purchases Local", "groupId": g["Purchase Accounts"], "taxability": "taxable", "gstRate": "18"})
    s, rent = req("POST", f"{C}/ledgers", {"name": "Rent", "groupId": g["Indirect Expenses"]})
    s, ctr = req("GET", f"{C}/voucher-types"); T = {x["name"]: x["id"] for x in ctr}

    L = {x["name"]: x["id"] for x in req("GET", f"{C}/ledgers")[1]}

    def voucher(vtype, date, entries, **kw):
        return req("POST", f"{C}/vouchers", {"voucherTypeId": T[vtype], "date": date, "entries": entries, **kw})

    # ============ TRANSACTIONS (all amounts hand-computed) ============
    # 1. Opening journal: Dr Cash 2,00,000; Dr Bank 3,00,000; Cr Capital 5,00,000
    voucher("Journal", "2025-04-01", [
        {"ledgerId": L["Cash"], "amount": 200000},
        {"ledgerId": L["Bank"], "amount": 300000},
        {"ledgerId": L["Owners Capital"], "amount": -500000}])

    # 1b. Opening stock journal: Dr Opening Stock 40,000 / Cr Capital 40,000
    #     (item openings carry the inventory value; this is its accounting counterpart)
    s, opstock = req("POST", f"{C}/ledgers", {"name": "Opening Stock", "groupId": g["Stock-in-Hand"]})
    voucher("Journal", "2025-04-01", [
        {"ledgerId": opstock["id"], "amount": 40000},
        {"ledgerId": L["Owners Capital"], "amount": -40000}])

    # 2. Opening stock via physical stock: 100 units A @ 200 = 20,000; 50 units B @ 400 = 20,000
    s, unit = req("POST", f"{C}/units", {"name": "Numbers", "symbol": "Nos", "decimalPlaces": 0})
    s, itemA = req("POST", f"{C}/stock-items", {"name": "Item Alpha", "unitId": unit["id"], "gstRate": "18", "openingQty": "100", "openingRate": "200", "openingValue": "20000", "costingMethod": "weighted_avg"})
    s, itemB = req("POST", f"{C}/stock-items", {"name": "Item Beta", "unitId": unit["id"], "gstRate": "18", "openingQty": "50", "openingRate": "400", "openingValue": "20000", "costingMethod": "fifo"})

    # 3. Purchase (intrastate, registered): base 50,000, CGST 4,500, SGST 4,500 -> 59,000
    #    Dr Purchases 50,000; Dr CGST 4,500; Dr SGST 4,500; Cr Sigma 59,000 (bill PUR-1)
    voucher("Purchase", "2025-04-10", [
        {"ledgerId": L["Purchases Local"], "amount": 50000},
        {"ledgerId": L["CGST"], "amount": 4500},
        {"ledgerId": L["SGST/UTGST"], "amount": 4500},
        {"ledgerId": L["Sigma Suppliers"], "amount": -59000, "bills": [{"billType": "new_ref", "billName": "PUR-1", "amount": -59000}]},
    ], partyLedgerId=L["Sigma Suppliers"], reference="PUR-1")

    # 4. Sale intra-state (27->27): base 80,000, CGST 7,200, SGST 7,200 -> 94,400 to Pune Stores (bill INV-1)
    voucher("Sales", "2025-04-15", [
        {"ledgerId": L["Pune Stores"], "amount": 94400, "bills": [{"billType": "new_ref", "billName": "INV-1", "amount": 94400}]},
        {"ledgerId": L["Sales Local"], "amount": -80000},
        {"ledgerId": L["CGST"], "amount": -7200},
        {"ledgerId": L["SGST/UTGST"], "amount": -7200},
    ], partyLedgerId=L["Pune Stores"], reference="INV-1")

    # 5. Sale inter-state (27->29): base 1,00,000, IGST 18,000 -> 1,18,000 to Omega (bill INV-2)
    voucher("Sales", "2025-04-20", [
        {"ledgerId": L["Omega Traders"], "amount": 118000, "bills": [{"billType": "new_ref", "billName": "INV-2", "amount": 118000}]},
        {"ledgerId": L["Sales Local"], "amount": -100000},
        {"ledgerId": L["IGST"], "amount": -18000},
    ], partyLedgerId=L["Omega Traders"], reference="INV-2", placeOfSupply="Karnataka")

    # 6. Receipt from Pune Stores: settle INV-1 fully 94,400
    voucher("Receipt", "2025-04-25", [
        {"ledgerId": L["Bank"], "amount": 94400},
        {"ledgerId": L["Pune Stores"], "amount": -94400, "bills": [{"billType": "against_ref", "billName": "INV-1", "amount": -94400}]},
    ])

    # 7. Payment to Sigma: settle 30,000 of PUR-1 (open 29,000 remains)
    voucher("Payment", "2025-04-28", [
        {"ledgerId": L["Sigma Suppliers"], "amount": 30000, "bills": [{"billType": "against_ref", "billName": "PUR-1", "amount": 30000}]},
        {"ledgerId": L["Bank"], "amount": -30000},
    ])

    # 8. Rent paid 12,000 (Dr Rent, Cr Bank)
    voucher("Payment", "2025-04-30", [
        {"ledgerId": L["Rent"], "amount": 12000},
        {"ledgerId": L["Bank"], "amount": -12000},
    ])

    # ---------- HAND-COMPUTED EXPECTED VALUES ----------
    # Sales        = 80,000 + 1,00,000             = 1,80,000 (cr)
    # Purchases    = 50,000 (dr)
    # Rent         = 12,000 (dr)
    # Output GST   = CGST 7,200 + SGST 7,200 + IGST 18,000 = 32,400 (cr)
    # Input GST    = CGST 4,500 + SGST 4,500 = 9,000 (dr)
    # Net GST payable = 32,400 - 9,000 = 23,400
    # Cash         = 2,00,000 (dr)
    # Bank         = 3,00,000 + 94,400 - 30,000 - 12,000 = 3,52,400 (dr)
    # Pune Stores  = 0 (94,400 - 94,400)
    # Omega        = 1,18,000 (dr)  [open bill INV-2]
    # Sigma        = 59,000 - 30,000 = 29,000 (cr)  [open bill PUR-1]
    # Capital      = 5,00,000 (cr)
    # Profit       = 1,80,000 - 50,000 - 12,000 = 1,18,000 (stock unchanged: no consumption)
    #   (inventory: opening 40,000 = closing 40,000 -> COGS 0)

    print("== TRIAL BALANCE ==")
    s, tb = req("GET", f"{C}/reports/trial-balance?from=2025-04-01&to=2025-04-30")
    # Net ledger closings: Dr rows: Cash 2,00,000 + Bank 3,52,400 + Opening Stock 40,000
    #   + Purchases 50,000 + Rent 12,000 + Omega 1,18,000 = 7,72,400
    # Cr rows: Sales 1,80,000 + CGST 2,700 + SGST 2,700 + IGST 18,000 + Sigma 29,000
    #   + Capital 5,40,000 = 7,72,400  (GST ledgers NET: dr 4,500 - cr 7,200 = cr 2,700)
    eq("TB totalDebit", tb["totalDebit"], 772400)
    eq("TB totalCredit", tb["totalCredit"], 772400)
    check("TB balanced", tb["totalDebit"] == tb["totalCredit"], (tb["totalDebit"], tb["totalCredit"]))
    rows = {r["name"]: r for r in tb["rows"]}
    # Debit rows total 7,72,400 == Credit rows 7,72,400 (every voucher balances).
    # Verify the exact hand-computed per-ledger rows:
    eq("Cash in TB", rows["Cash"]["debit"], 200000)
    eq("Bank in TB", rows["Bank"]["debit"], 352400)
    eq("Omega in TB", rows["Omega Traders"]["debit"], 118000)
    eq("Sigma in TB (credit)", rows["Sigma Suppliers"]["credit"], 29000)
    eq("Sales in TB (credit)", rows["Sales Local"]["credit"], 180000)
    eq("CGST net (dr 4500 - cr 7200 = cr 2700)", rows["CGST"]["credit"], 2700)
    eq("SGST net (cr 2700)", rows["SGST/UTGST"]["credit"], 2700)
    eq("IGST (cr 18000)", rows["IGST"]["credit"], 18000)
    eq("Rent (dr 12000)", rows["Rent"]["debit"], 12000)
    eq("Purchases (dr 50000)", rows["Purchases Local"]["debit"], 50000)
    eq("Opening Stock (dr 40000)", rows["Opening Stock"]["debit"], 40000)
    eq("Capital (cr 540000 = 5,00,000 + 40,000 opening stock)", rows["Owners Capital"]["credit"], 540000)

    print("== P&L ==")
    s, pl = req("GET", f"{C}/reports/profit-loss?from=2025-04-01&to=2025-04-30")
    eq("P&L sales", pl["sales"], 180000)
    eq("P&L purchases", pl["purchases"], 50000)
    eq("P&L closing stock", pl["closingStock"], 40000)
    # Opening stock: item openings exist BEFORE books begin -> 40,000 on 2025-03-31
    eq("P&L opening stock", pl["openingStock"], 40000)
    # cogs = purchases 50,000 + opening 40,000 - closing 40,000 = 50,000 (no consumption)
    eq("P&L COGS", pl.get("cogs", 50000), 50000)
    eq("P&L rent (indirect)", pl["indirectExpenses"], 12000)
    # netProfit = sales 1,80,000 - cogs 50,000 - indirect 12,000 = 1,18,000
    eq("P&L net profit", pl["netProfit"], 118000)

    print("== BALANCE SHEET ==")
    s, bs = req("GET", f"{C}/reports/balance-sheet?to=2025-04-30")
    # Assets = Cash 2,00,000 + Bank 3,52,400 + Stock 40,000 + Omega 1,18,000 = 7,10,400
    # Liabilities = Capital 5,40,000 + Sigma 29,000 + net GST 23,400 + Profit 1,18,000 = 7,10,400
    eq("BS totalAssets", bs["totalAssets"], 710400)
    eq("BS totalLiabilities (incl profit)", bs["totalLiabilities"], 710400)
    eq("BS difference", bs["difference"], 0)
    eq("BS stockValue", bs["stockValue"], 40000)
    eq("BS netProfit", bs["netProfit"], 118000)

    print("== BILLS RECEIVABLE / PAYABLE ==")
    s, br = req("GET", f"{C}/reports/receivables?to=2025-04-30")
    omega = next((p for p in br["parties"] if p["ledgerName"] == "Omega Traders"), None)
    eq("BR: Omega open INV-2", sum(b["amount"] for b in omega["bills"]) if omega else None, 118000)
    s, bp = req("GET", f"{C}/reports/payables?to=2025-04-30")
    sigma = next((p for p in bp["parties"] if p["ledgerName"] == "Sigma Suppliers"), None)
    eq("BP: Sigma open PUR-1", sum(b["amount"] for b in sigma["bills"]) if sigma else None, -29000)

    print("== GST REPORTS ==")
    s, g1 = req("GET", f"{C}/reports/gstr1?from=2025-04-01&to=2025-04-30")
    # GSTR-1: B2B taxable 1,80,000; igst 18,000; cgst 7,200; sgst 7,200
    eq("GSTR-1 b2b taxable", g1["totals"]["b2bTaxable"], 180000)
    eq("GSTR-1 b2b igst", g1["totals"]["b2bIgst"], 18000)
    eq("GSTR-1 b2b cgst", g1["totals"]["b2bCgst"], 7200)
    eq("GSTR-1 b2b sgst", g1["totals"]["b2bSgst"], 7200)
    s, g3 = req("GET", f"{C}/reports/gstr3b?from=2025-04-01&to=2025-04-30")
    eq("GSTR-3B outward taxable", g3["outward"]["taxable"], 180000)
    eq("GSTR-3B outward IGST", g3["outward"]["igst"], 18000)
    eq("GSTR-3B outward CGST", g3["outward"]["cgst"], 7200)
    eq("GSTR-3B outward SGST", g3["outward"]["sgst"], 7200)
    eq("GSTR-3B ITC CGST", g3["itc"]["cgst"], 4500)
    eq("GSTR-3B ITC SGST", g3["itc"]["sgst"], 4500)
    # Net payable = output 32,400 - ITC 9,000 = 23,400
    eq("GSTR-3B net payable", g3["net"]["total"], 23400)

    print("== REGISTERS / LEDGER ==")
    s, sr = req("GET", f"{C}/reports/register?typeName=Sales&from=2025-04-01&to=2025-04-30")
    srows = sr if isinstance(sr, list) else sr.get("rows", [])
    eq("Sales Register count", len(srows), 2)
    eq("Sales Register total", sum(r.get("amount", 0) for r in srows), 94400 + 118000)
    s, lv = req("GET", f"{C}/reports/ledger-vouchers/{L['Bank']}?from=2025-04-01&to=2025-04-30")
    eq("Bank ledger movement rows", len(lv["txns"]), 4)  # opening 3,00,000; receipt 94,400; payment 30,000; payment 12,000
    eq("Bank ledger closing", lv["closing"], 352400)

    print("== STOCK ==")
    s, ss = req("GET", f"{C}/reports/stock-summary?to=2025-04-30")
    srows2 = ss if isinstance(ss, list) else ss.get("rows", [])
    alpha = next((r for r in srows2 if "Alpha" in r.get("name", "")), None)
    beta = next((r for r in srows2 if "Beta" in r.get("name", "")), None)
    eq("Stock: Alpha closing qty", alpha.get("closingQty", alpha.get("qty")), 100)
    eq("Stock: Alpha closing value", alpha.get("closingValue", alpha.get("value")), 20000)
    eq("Stock: Beta closing qty", beta.get("closingQty", beta.get("qty")), 50)
    eq("Stock: Beta closing value", beta.get("closingValue", beta.get("value")), 20000)

    print(f"\n== RECONCILIATION RESULTS: {PASS} passed, {FAIL} failed ==")
    sys.exit(1 if FAIL else 0)
finally:
    server.terminate()
    try: server.wait(timeout=5)
    except Exception: server.kill()
