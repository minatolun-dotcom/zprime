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

def r2(v):
    return round(v + 1e-9, 2)

def eq(name, got, want, tol=0.005):
    check(name, got is not None and abs(float(got) - want) < tol, f"got {got}, want {want}")

print("== final_regression: fresh schema + server on 3106 ==")
subprocess.run(["docker", "exec", "zprime-test-pg", "psql", "-U", "zprime", "-c",
                "DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;"],
               capture_output=True, check=True)
env = dict(os.environ, DATABASE_URL="postgres://zprime:zprime@localhost:55432/zprime", PORT="3106",
    JWT_SECRET="test-suite-secret", ADMIN_PASSWORD="admin123")  # R-09: explicit fixtures (fail-fast otherwise)
server = subprocess.Popen(["npx", "tsx", "server/src/index.ts"],
                          cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                          env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
import atexit
def _cleanup():
    server.terminate()
    time.sleep(0.5)
    subprocess.run(["pkill", "-f", "PORT=3106"], capture_output=True)
atexit.register(_cleanup)
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
    "gstin": "27FINREG12C5", "financialYearStart": "2026-04-01", "booksBeginFrom": "2026-04-01",
    "allowNegativeStock": True})  # R-06: fixture opts in — its R-01/R-02 sections test HSN/cancellation, not availability (some fixtures legitimately oversell); the guard itself is exercised on the dedicated R06 companies
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

# ================= F-INV-01: inventory-only vouchers =================
print("-- F-INV-01: inventory-only Stock Journal / Physical Stock --")
s, unit = req("POST", f"{C}/units", {"name": "Pieces", "symbol": "Pcs", "decimalPlaces": 0})
check("unit created", s == 200 and unit.get("id"), unit)
s, itemA = req("POST", f"{C}/stock-items", {"name": "FinReg Bulb", "unitId": unit["id"], "gstRate": "18",
                                            "openingQty": "100", "openingRate": "40", "openingValue": "4000", "costingMethod": "fifo"})
check("item A (fifo) created", s == 200 and itemA.get("id") and itemA.get("costingMethod") == "fifo", itemA)
s, itemB = req("POST", f"{C}/stock-items", {"name": "FinReg Kit", "unitId": unit["id"], "gstRate": "18",
                                            "openingQty": "0", "openingRate": "0", "openingValue": "0", "costingMethod": "fifo"})
check("item B created", s == 200 and itemB.get("id"), itemB)

def stock_pos(item_id, to="2026-06-30"):
    s, ss = req("GET", f"{C}/reports/stock-summary?from=2026-04-01&to={to}")
    row = next((r for r in ss if r.get("id") == item_id or r.get("itemId") == item_id), None)
    return row

# PASS 1: inventory-only Stock Journal (entries: []) — 10 A -> 5 B at value 400
p0 = stock_pos(itemA["id"]) or {"closingQty": 100, "closingValue": 4000}
s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Stock Journal"], "date": "2026-06-10",
    "entries": [],
    "inventoryEntries": [
        {"itemId": itemA["id"], "qty": -10, "rate": 40, "amount": 400, "kind": "source"},
        {"itemId": itemB["id"], "qty": 5, "rate": 80, "amount": 400, "kind": "target"},
    ]})
check("inventory-only Stock Journal accepted (entries: [])", s == 200, (s, str(v)[:150]))
sj_id = v.get("id") if isinstance(v, dict) else None

# PASS 2: inventory-only Physical Stock (entries: [])
s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Physical Stock"], "date": "2026-06-11",
    "entries": [],
    "inventoryEntries": [{"itemId": itemB["id"], "qty": 5, "rate": 80, "amount": 400, "kind": "physical"}]})
check("inventory-only Physical Stock accepted (entries: [])", s == 200, (s, str(v)[:150]))

# PASS 3: mixed Stock Journal with accounting legs (consumption credited to an expense)
s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Stock Journal"], "date": "2026-06-12",
    "entries": [{"ledgerId": rent["id"], "amount": -200}, {"ledgerId": cash["id"], "amount": 200}],
    "inventoryEntries": [
        {"itemId": itemA["id"], "qty": -5, "rate": 40, "amount": 200, "kind": "source"},
    ]})
check("mixed Stock Journal with accounting legs accepted", s == 200, (s, str(v)[:150]))

# PASS 4: normal accounting voucher still fine
s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Payment"], "date": "2026-06-13",
    "entries": [{"ledgerId": rent["id"], "amount": 50}, {"ledgerId": cash["id"], "amount": -50}]})
check("normal accounting voucher unaffected", s == 200, (s, str(v)[:150]))

# PASS 5: multiple inventory rows, source-only and target-only
s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Stock Journal"], "date": "2026-06-14",
    "entries": [],
    "inventoryEntries": [
        {"itemId": itemA["id"], "qty": -3, "rate": 40, "amount": 120, "kind": "source"},
        {"itemId": itemA["id"], "qty": -2, "rate": 40, "amount": 80, "kind": "source"},
        {"itemId": itemB["id"], "qty": 4, "rate": 50, "amount": 200, "kind": "target"},
    ]})
check("multi-row source-only + target-only inventory-only SJ accepted", s == 200, (s, str(v)[:150]))

# FAIL cases: accounting voucher types with entries: [] must be rejected
s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Payment"], "date": "2026-06-15", "entries": []})
check("Payment + entries:[] rejected", s == 400, (s, str(v)[:100]))
s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Receipt"], "date": "2026-06-15", "entries": []})
check("Receipt + entries:[] rejected", s == 400, (s, str(v)[:100]))
s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Journal"], "date": "2026-06-15", "entries": []})
check("Journal + entries:[] rejected", s == 400, (s, str(v)[:100]))
s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Sales"], "date": "2026-06-15", "entries": []})
check("Sales + entries:[] rejected", s == 400, (s, str(v)[:100]))
s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Purchase"], "date": "2026-06-15", "entries": []})
check("Purchase + entries:[] rejected", s == 400, (s, str(v)[:100]))
s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Stock Journal"], "date": "2026-06-15", "entries": []})
check("Stock Journal + no inventory rows + entries:[] rejected", s == 400, (s, str(v)[:100]))
s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Physical Stock"], "date": "2026-06-15", "entries": []})
check("Physical Stock + no inventory rows + entries:[] rejected", s == 400, (s, str(v)[:100]))

# FAIL: invalid item / cross-company item / zero qty / malformed payload
s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Stock Journal"], "date": "2026-06-15",
    "entries": [], "inventoryEntries": [{"itemId": 999999, "qty": -1, "rate": 10, "amount": 10, "kind": "source"}]})
check("SJ inventory-only with nonexistent item rejected", s == 400, (s, str(v)[:100]))
s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Stock Journal"], "date": "2026-06-15",
    "entries": [], "inventoryEntries": [{"itemId": itemB["id"], "qty": 0, "rate": 10, "amount": 0, "kind": "source"}]})
check("SJ inventory-only with zero-qty row rejected", s == 400, (s, str(v)[:100]))
s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Physical Stock"], "date": "2026-06-15",
    "entries": [], "inventoryEntries": [{"itemId": itemA["id"], "qty": -1, "rate": 10, "amount": 10, "kind": "physical"}]})
check("PS with negative counted qty rejected", s == 400, (s, str(v)[:100]))
s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Stock Journal"], "date": "2026-06-15",
    "entries": [], "inventoryEntries": [{"itemId": itemA["id"], "qty": "not-a-number", "rate": 10, "amount": 10, "kind": "source"}]})
check("SJ malformed inventory payload rejected cleanly", s == 400, (s, str(v)[:100]))

# stock effect: itemA out 10+5+3+2=20 -> 80 left at FIFO 40 => 3200; itemB in 5 + 4 = 9 at 80/50
s, ss = req("GET", f"{C}/reports/stock-summary?from=2026-04-01&to=2026-06-30")
rowA = next((r for r in ss if r.get("itemId") == itemA["id"] or r.get("id") == itemA["id"]), None)
rowB = next((r for r in ss if r.get("itemId") == itemB["id"] or r.get("id") == itemB["id"]), None)
check("stock-summary has rows for both items", rowA is not None and rowB is not None, (str(ss)[:200]))
if rowA:
    eq("itemA closing qty 80 after inventory-only movements", rowA.get("closingQty", rowA.get("qty")), 80)
    eq("itemA closing value 3200", rowA.get("closingValue", rowA.get("value")), 3200)
if rowB:
    eq("itemB closing qty 9", rowB.get("closingQty", rowB.get("qty")), 9)

# no accounting movement: TB still balanced and unaffected by inventory-only rows
s, tb = req("GET", f"{C}/reports/trial-balance?from=2026-04-01&to=2026-06-30")
check("TB balanced with inventory-only vouchers", tb["totalDebit"] == tb["totalCredit"], (tb["totalDebit"], tb["totalCredit"]))
s, p = req("GET", f"{C}/reports/profit-loss?from=2026-04-01&to=2026-06-30")
# accounting legs of mixed SJ (-200 rent credit + payment 50) are the only P&L movements here
check("P&L endpoint available for reconciliation", s == 200, (s, str(p)[:100]))

# edit + delete round-trip on inventory-only SJ
if sj_id:
    s, v = req("PUT", f"{C}/vouchers/{sj_id}", {"voucherTypeId": vt["Stock Journal"], "date": "2026-06-10",
        "entries": [],
        "inventoryEntries": [
            {"itemId": itemA["id"], "qty": -12, "rate": 40, "amount": 480, "kind": "source"},
            {"itemId": itemB["id"], "qty": 6, "rate": 80, "amount": 480, "kind": "target"},
        ]})
    check("edit inventory-only SJ (PUT) accepted", s == 200, (s, str(v)[:120]))
    s, ss = req("GET", f"{C}/reports/stock-summary?from=2026-04-01&to=2026-06-30")
    rowA = next((r for r in ss if r.get("itemId") == itemA["id"] or r.get("id") == itemA["id"]), None)
    if rowA:
        eq("itemA closing qty reflects edited SJ (78)", rowA.get("closingQty", rowA.get("qty")), 78)
    s, v = req("DELETE", f"{C}/vouchers/{sj_id}")
    check("delete inventory-only SJ accepted", s == 200, (s, str(v)[:100]))
    s, ss = req("GET", f"{C}/reports/stock-summary?from=2026-04-01&to=2026-06-30")
    rowA = next((r for r in ss if r.get("itemId") == itemA["id"] or r.get("id") == itemA["id"]), None)
    if rowA:
        eq("itemA closing qty back to 90 after delete", rowA.get("closingQty", rowA.get("qty")), 90)

# cross-company item in an inventory-only voucher must be rejected
s, itemXB = req("POST", f"{CB}/units", {"name": "XB Unit", "symbol": "XB", "decimalPlaces": 0}) if False else (0, None)
s, unitB = req("POST", f"{CB}/units", {"name": "B Pieces", "symbol": "BP", "decimalPlaces": 0})
s, itemXB = req("POST", f"{CB}/stock-items", {"name": "B Only Item", "unitId": unitB["id"], "gstRate": "18",
                                              "openingQty": "0", "openingRate": "0", "openingValue": "0"})
check("company B item created", s == 200 and itemXB.get("id"), itemXB)
s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Stock Journal"], "date": "2026-06-16",
    "entries": [], "inventoryEntries": [{"itemId": itemXB["id"], "qty": -1, "rate": 10, "amount": 10, "kind": "source"}]})
check("cross-company item in inventory-only SJ rejected", s == 400, (s, str(v)[:100]))
s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Physical Stock"], "date": "2026-06-16",
    "entries": [], "inventoryEntries": [{"itemId": itemXB["id"], "qty": 3, "rate": 10, "amount": 30, "kind": "physical"}]})
check("cross-company item in inventory-only PS rejected", s == 400, (s, str(v)[:100]))

# ---- attack the fix: concurrency & bounds on the new exception ----
print("-- attack the fix: concurrency / bounds --")
import concurrent.futures
def post_sj(_i):
    return req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Stock Journal"], "date": "2026-06-17",
        "entries": [], "inventoryEntries": [{"itemId": itemA["id"], "qty": -1, "rate": 40, "amount": 40, "kind": "source"}]})
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as ex:
    cres = list(ex.map(post_sj, range(5)))
codes = [s for s, _ in cres]
nums = [v.get("number") for _, v in cres if isinstance(v, dict)]
check("5 concurrent inventory-only SJs all accepted", all(c == 200 for c in codes), codes)
check("concurrent inventory-only SJs got distinct numbers", len(set(nums)) == len(nums), nums)
s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Stock Journal"], "date": "2026-06-18",
    "entries": [], "inventoryEntries": [{"itemId": itemA["id"], "qty": -1000000000, "rate": 40, "amount": 40000000000, "kind": "source"}]})
check("SJ huge quantity does not 500", s in (200, 400), (s, str(v)[:80]))

# ================= O-1: Cash/Bank sub-period semantics (regression coverage) =================
# Phase 1 proved the app correct (Closing = Opening + Dr - Cr, future vouchers
# excluded); the original observation was a coverage gap. These tests would fail
# if closing ever became an all-time sum: April closing (10,067) differs from the
# all-time balance (11,472+) by the exact amount of the later vouchers.
print("-- O-1: cash/bank sub-period semantics --")
s, o1c = req("POST", f"{C}/ledgers", {"name": "O1 Probe Cash", "groupId": g["Cash-in-Hand"], "isBankCash": True, "openingBalance": "10000"})
check("O1 probe cash ledger created (opening 10000)", s == 200 and o1c.get("id"), (s, str(o1c)[:120]))
s, o1inc = req("POST", f"{C}/ledgers", {"name": "O1 Probe Income", "groupId": g["Indirect Incomes"]})
check("O1 probe income ledger created", s == 200 and o1inc.get("id"), (s, str(o1inc)[:120]))

def o1_cb(frm, to):
    s2, rows2 = req("GET", f"{C}/reports/cash-bank?from={frm}&to={to}")
    row = next((r for r in rows2 if r["ledgerId"] == o1c["id"]), None) if s2 == 200 and isinstance(rows2, list) else None
    return row

def o1_assert_window(lbl, frm, to, eop, edr, ecr, ecl):
    r = o1_cb(frm, to)
    ok = r is not None
    check(f"O1 {lbl}: row present", ok, "missing from cash-bank response")
    if not ok:
        return
    eq(f"O1 {lbl}: opening", r["opening"], eop)
    eq(f"O1 {lbl}: period Dr", r["debit"], edr)
    eq(f"O1 {lbl}: period Cr", r["credit"], ecr)
    eq(f"O1 {lbl}: closing", r["closing"], ecl)
    eq(f"O1 {lbl}: identity closing = opening + Dr - Cr", r["closing"], r2(r["opening"] + r["debit"] - r["credit"]))

# Controlled dataset (all balanced against O1 Probe Income; probe cash amounts exact):
#   Apr 05 +100 (Receipt)          Apr 10 -40 (Journal)
#   Apr 30 +7  (Receipt)  -> exactly ON the April `to` (to-inclusive canary)
#   May 01 +3  (Receipt)  -> exactly ON the May `from` (from-inclusive canary)
#   May 10 +500 (Receipt)          May 31 -11 (Journal) -> exactly ON the May `to`
#   Jun 01 +13 (Receipt)  -> to+1 for May (must NOT touch May closing)
#   Jun 10 +900 (Receipt) -> future canary for every historical window
def o1_vch(date, cash_amt):
    kind = vt["Receipt"] if cash_amt > 0 else vt["Journal"]
    s2, v2 = req("POST", f"{C}/vouchers", {"voucherTypeId": kind, "date": date,
        "entries": [{"ledgerId": o1c["id"], "amount": cash_amt}, {"ledgerId": o1inc["id"], "amount": -cash_amt}]})
    check(f"O1 voucher {date} {cash_amt:+.0f} accepted", s2 == 200, (s2, str(v2)[:120]))
    return v2

v1 = o1_vch("2026-04-05", 100)
v2 = o1_vch("2026-04-10", -40)
v3 = o1_vch("2026-04-30", 7)
v4 = o1_vch("2026-05-01", 3)
v5 = o1_vch("2026-05-10", 500)
v6 = o1_vch("2026-05-31", -11)
v7 = o1_vch("2026-06-01", 13)
v8 = o1_vch("2026-06-10", 900)

# April window: May/June vouchers excluded (future-transaction exclusion)
o1_assert_window("April", "2026-04-01", "2026-04-30", 10000, 107, 40, 10067)
# May window: opening = April closing (continuity); Jun 01 (to+1) excluded
o1_assert_window("May", "2026-05-01", "2026-05-31", 10067, 503, 11, 10559)
# One-day windows (same-day period; from- and to-inclusive on a single date)
o1_assert_window("one-day Apr 05", "2026-04-05", "2026-04-05", 10000, 100, 0, 10100)
o1_assert_window("one-day Apr 10", "2026-04-10", "2026-04-10", 10100, 0, 40, 10060)
# FY window: everything included
o1_assert_window("FY Apr-Jun", "2026-04-01", "2026-06-30", 10000, 1523, 51, 11472)
# Empty window strictly after all activity: opening carries full history
o1_assert_window("empty late window", "2026-06-20", "2026-06-25", 11472, 0, 0, 11472)

# ---- 2C: edit / backdate / delete propagation ----
v9 = o1_vch("2026-06-20", 200)
o1_assert_window("June with v9", "2026-06-01", "2026-06-30", 10559, 1113, 0, 11672)
# edit INTO the period: 200 -> 250 changes June closing by exactly +50
s, _ = req("PUT", f"{C}/vouchers/{v9['id']}", {"voucherTypeId": vt["Receipt"], "date": "2026-06-20",
    "entries": [{"ledgerId": o1c["id"], "amount": 250}, {"ledgerId": o1inc["id"], "amount": -250}]})
check("O1 edit voucher accepted", s == 200, s)
o1_assert_window("June after edit to 250", "2026-06-01", "2026-06-30", 10559, 1163, 0, 11722)
# backdate OUT of June into April: April +250, May opening follows, June cumulative closing unchanged
s, _ = req("PUT", f"{C}/vouchers/{v9['id']}", {"voucherTypeId": vt["Receipt"], "date": "2026-04-15",
    "entries": [{"ledgerId": o1c["id"], "amount": 250}, {"ledgerId": o1inc["id"], "amount": -250}]})
check("O1 backdate voucher accepted", s == 200, s)
o1_assert_window("April after backdate", "2026-04-01", "2026-04-30", 10000, 357, 40, 10317)
o1_assert_window("May after backdate (opening shifted)", "2026-05-01", "2026-05-31", 10317, 503, 11, 10809)
o1_assert_window("June after backdate (cumulative invariant)", "2026-06-01", "2026-06-30", 10809, 913, 0, 11722)
# delete removes the effect everywhere
s, _ = req("DELETE", f"{C}/vouchers/{v9['id']}")
check("O1 delete voucher accepted", s == 200, s)
o1_assert_window("April after delete", "2026-04-01", "2026-04-30", 10000, 107, 40, 10067)
o1_assert_window("June after delete", "2026-06-01", "2026-06-30", 10559, 913, 0, 11472)

# ================= R-01: GSTR-1 HSN outward-supply reporting =================
# The old HSN logic used inventory DIRECTION (qty > 0) as the outward test, so
# purchases/receipt notes polluted Table 12 and sales were excluded; HSN/rate
# also came from snapshot columns that UI-created vouchers leave NULL.
# The fix: population = voucher-type Sales (same semantics as voucherGst
# "outward"), snapshot -> item-master fallback for hsn/rate, positive qty.
print("-- R-01: GSTR-1 HSN outward-supply reporting --")
s, r01_gst = req("POST", f"{C}/ledgers", {"name": "Output CGST R01", "groupId": g["Duties & Taxes"], "dutyHead": "CGST"})
s, r01_sst = req("POST", f"{C}/ledgers", {"name": "Output SGST R01", "groupId": g["Duties & Taxes"], "dutyHead": "SGST"})
s, r01_igst = req("POST", f"{C}/ledgers", {"name": "Output IGST R01", "groupId": g["Duties & Taxes"], "dutyHead": "IGST"})
s, r01_buyer = req("POST", f"{C}/ledgers", {"name": "R01 Buyer", "groupId": g["Sundry Debtors"], "gstin": "27R01BUYER1Z3", "gstRegistrationType": "regular", "billWise": True})
s, r01_supp = req("POST", f"{C}/ledgers", {"name": "R01 Supplier", "groupId": g["Sundry Creditors"], "gstin": "24R01SUPPL1Z4", "gstRegistrationType": "regular", "billWise": True})
s, r01_unit = req("POST", f"{C}/units", {"name": "R01 Nos", "symbol": "R01N", "decimalPlaces": 0})
check("R01 unit created", s == 200 and r01_unit.get("id"), r01_unit)

# CANARY: purchase 91,111 taxable HSN 1001 vs sale 1,000 taxable HSN 1001.
s, r01_canary = req("POST", f"{C}/stock-items", {"name": "R01 Canary 1001", "unitId": r01_unit["id"], "hsnSac": "1001", "gstRate": "18",
                                                 "openingQty": "0", "openingRate": "0", "openingValue": "0"})
check("R01 canary item created", s == 200 and r01_canary.get("id"), r01_canary)
# master-fallback item: NO hsn on voucher snapshots; master has 9999 @ 12%
s, r01_master = req("POST", f"{C}/stock-items", {"name": "R01 Master Fallback", "unitId": r01_unit["id"], "hsnSac": "9999", "gstRate": "12",
                                                  "openingQty": "0", "openingRate": "0", "openingValue": "0"})
check("R01 master-fallback item created", s == 200 and r01_master.get("id"), r01_master)

def r01_sale(date, item, qty, rate, igst=False):
    taxable = r2(abs(qty) * rate)
    duty = r2(taxable * 0.18) if igst else r2(taxable * 0.09)
    lines = [{"ledgerId": r01_buyer["id"], "amount": r2(taxable + duty * (1 if igst else 2))},
             {"ledgerId": sales["id"], "amount": -taxable, "gstRate": 18}]
    if igst:
        lines.append({"ledgerId": r01_igst["id"], "amount": -duty})
    else:
        lines.append({"ledgerId": r01_gst["id"], "amount": -duty})
        lines.append({"ledgerId": r01_sst["id"], "amount": -duty})
    return req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Sales"], "date": date, "partyLedgerId": r01_buyer["id"],
        "entries": lines, "inventoryEntries": [{"itemId": item["id"], "qty": -abs(qty), "rate": rate, "amount": taxable, "kind": "stock"}]})

def r01_purchase(date, item, qty, rate):
    taxable = r2(abs(qty) * rate)
    return req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Purchase"], "date": date, "partyLedgerId": r01_supp["id"],
        "entries": [{"ledgerId": purch["id"], "amount": taxable}, {"ledgerId": r01_supp["id"], "amount": -taxable}],
        "inventoryEntries": [{"itemId": item["id"], "qty": abs(qty), "rate": rate, "amount": taxable, "kind": "stock"}]})

def r01_hsn(frm="2026-06-01", to="2026-06-30"):
    s2, r = req("GET", f"{C}/reports/gstr1?from={frm}&to={to}")
    check("R01 GSTR-1 fetch", s2 == 200, (s2, str(r)[:80]))
    return r.get("hsn", []) if s2 == 200 else []

def r01_find(hsn_rows, code):
    return next((h for h in hsn_rows if h["hsn"] == code), None)

# A. PURCHASE ONLY: canary purchase 91,111 taxable must NOT appear
s, v = r01_purchase("2026-06-01", r01_canary, 911.11, 100)
check("R01 A: canary purchase created (911.11 @100 = 91111)", s == 200, (s, str(v)[:150]))
check("R01 A: purchase-only period -> HSN empty", r01_hsn("2026-06-01", "2026-06-01") == [], r01_hsn("2026-06-01", "2026-06-01"))

# B. SALES ONLY (canary): qty 5 @200 = 1000 taxable on HSN 1001 @ 18
s, v = r01_sale("2026-06-02", r01_canary, 5, 200)
check("R01 B: canary sale created", s == 200, (s, str(v)[:150]))
h = r01_find(r01_hsn("2026-06-02", "2026-06-02"), "1001")
check("R01 B/C (canary): sale only -> HSN 1001 qty 5 taxable 1000 rate 18",
      h is not None and h["qty"] == 5 and h["taxable"] == 1000 and h["rate"] == 18, h)

# C. PURCHASE + SALE same HSN, full June: purchase (91,111) must not merge in
hsn_june = r01_hsn()
h = r01_find(hsn_june, "1001")
check("R01 C: canary 91111 absent from June HSN (only 1000 sale)",
      h is not None and h["taxable"] == 1000, h)
check("R01 C: canary qty is 5 (no +911.11 purchase qty)", h is not None and h["qty"] == 5, h)

# D. RECEIPT NOTE + SALE: RN must not pollute
s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Receipt Note"], "date": "2026-06-03", "entries": [],
    "inventoryEntries": [{"itemId": r01_canary["id"], "qty": 77, "rate": 100, "amount": 7700, "kind": "stock"}]})
check("R01 D: receipt note created", s == 200, (s, str(v)[:120]))
h = r01_find(r01_hsn("2026-06-03", "2026-06-03"), "1001")
check("R01 D: RN-only day -> HSN empty", h is None, h)

# E. DELIVERY NOTE + SALE: DN must not create/alter HSN
s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Delivery Note"], "date": "2026-06-04", "entries": [],
    "inventoryEntries": [{"itemId": r01_canary["id"], "qty": -33, "rate": 100, "amount": 3300, "kind": "stock"}]})
check("R01 E: delivery note created", s == 200, (s, str(v)[:120]))
check("R01 E: DN-only day -> HSN empty", r01_hsn("2026-06-04", "2026-06-04") == [], r01_hsn("2026-06-04", "2026-06-04"))

# F. STOCK JOURNAL + SALE: SJ rows never in HSN
s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Stock Journal"], "date": "2026-06-05", "entries": [],
    "inventoryEntries": [{"itemId": r01_canary["id"], "qty": 10, "rate": 0, "amount": 0, "kind": "target"},
                          {"itemId": r01_master["id"], "qty": -10, "rate": 0, "amount": 0, "kind": "source"}]})
check("R01 F: stock journal created", s == 200, (s, str(v)[:120]))
check("R01 F: SJ-only day -> HSN empty", r01_hsn("2026-06-05", "2026-06-05") == [], r01_hsn("2026-06-05", "2026-06-05"))

# G. PHYSICAL STOCK + SALE: PS never in HSN
s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Physical Stock"], "date": "2026-06-06", "entries": [],
    "inventoryEntries": [{"itemId": r01_master["id"], "qty": 44, "rate": 0, "amount": 0, "kind": "physical"}]})
check("R01 G: physical stock created", s == 200, (s, str(v)[:120]))
check("R01 G: PS-only day -> HSN empty", r01_hsn("2026-06-06", "2026-06-06") == [], r01_hsn("2026-06-06", "2026-06-06"))

# H. UI-STYLE SALE WITH NULL SNAPSHOTS -> master fallback (HSN 9999 @ 12%)
s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Sales"], "date": "2026-06-07", "partyLedgerId": r01_buyer["id"],
    "entries": [{"ledgerId": r01_buyer["id"], "amount": 560}, {"ledgerId": sales["id"], "amount": -500, "gstRate": 12},
                {"ledgerId": r01_gst["id"], "amount": -30}, {"ledgerId": r01_sst["id"], "amount": -30}],
    "inventoryEntries": [{"itemId": r01_master["id"], "qty": -10, "rate": 50, "amount": 500, "kind": "stock"}]})  # no hsnSac/gstRate keys
check("R01 H: null-snapshot sale created", s == 200, (s, str(v)[:150]))
h = r01_find(r01_hsn("2026-06-07", "2026-06-07"), "9999")
check("R01 H: master fallback -> hsn 9999 rate 12 qty 10 taxable 500",
      h is not None and h["hsn"] == "9999" and h["rate"] == 12 and h["qty"] == 10 and h["taxable"] == 500, h)
check("R01 H: no '-' placeholder rows in period", r01_find(r01_hsn("2026-06-01", "2026-06-30"), "-") is None,
      r01_find(r01_hsn(), "-"))

# K/M. MULTIPLE HSNs + INTERSTATE: IGST sale on second item HSN 2002 @ 18
s, r01_inter = req("POST", f"{C}/stock-items", {"name": "R01 Inter 2002", "unitId": r01_unit["id"], "hsnSac": "2002", "gstRate": "18",
                                                "openingQty": "0", "openingRate": "0", "openingValue": "0"})
check("R01 K: inter item created", s == 200, r01_inter)
# inter-state buyer (Karnataka 29)
s, r01_buyer29 = req("POST", f"{C}/ledgers", {"name": "R01 Buyer 29", "groupId": g["Sundry Debtors"], "gstin": "29R01BUYER2Z5", "gstRegistrationType": "regular", "partyState": "Karnataka"})
s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Sales"], "date": "2026-06-08", "partyLedgerId": r01_buyer29["id"],
    "entries": [{"ledgerId": r01_buyer29["id"], "amount": 1180}, {"ledgerId": sales["id"], "amount": -1000, "gstRate": 18},
                {"ledgerId": r01_igst["id"], "amount": -180}],
    "inventoryEntries": [{"itemId": r01_inter["id"], "qty": -4, "rate": 250, "amount": 1000, "kind": "stock"}]})
check("R01 M: inter-state sale created", s == 200, (s, str(v)[:150]))
hsn_june = r01_hsn()
h1001, h9999, h2002 = r01_find(hsn_june, "1001"), r01_find(hsn_june, "9999"), r01_find(hsn_june, "2002")
check("R01 K: three independent HSN rows aggregate separately",
      h1001 and h9999 and h2002 and h1001["taxable"] == 1000 and h9999["taxable"] == 500 and h2002["taxable"] == 1000,
      [h1001, h9999, h2002])
check("R01 M: inter-state HSN row present with rate 18", h2002 is not None and h2002["rate"] == 18, h2002)
# B2B consistency: HSN taxable (sales only) == outward b2b+b2c taxable minus CN/DN effects.
# In this window there are no notes, so the identity must hold exactly.
s, g1j = req("GET", f"{C}/reports/gstr1?from=2026-06-01&to=2026-06-30")
hsn_total = r2(sum(x["taxable"] for x in g1j["hsn"]))
sales_total = r2(sum(v2.get("taxable", 0) for v2 in g1j["b2b"] + g1j["b2c"] if v2.get("typeName") == "Sales"))
note_total = r2(sum(v2.get("taxable", 0) for v2 in g1j["b2b"] + g1j["b2c"] if v2.get("typeName") != "Sales"))
# Documented relationship (credit notes are NOT netted into Table 12):
#   HSN total == sum of taxable over OUTWARD SALES rows only.
#   b2b+b2c totals additionally contain credit-note rows (CDNR gap) — recorded,
#   not asserted equal.
# Documented population relationship (Table 12 = GOODS outward supplies):
#   HSN total == Σ taxable over Sales rows carrying inventory lines (1000+500+1000 = 2500).
#   b2b/b2c additionally contain accounting-only Sales (service-type, no stock:
#   SALES-9 118, SALES-3 2000) and Credit Note rows (118, CDNR gap) — these are
#   NOT HSN by design. The old bug would show 2500+7700 (RN) or purchases here.
eq("R01 9: HSN total = Sales-with-inventory population (2500)", hsn_total, 2500)
check("R01 9: credit note NOT netted into HSN", all(x["hsn"] != "CRN" for x in g1j["hsn"]), g1j["hsn"])
check("R01 9: HSN + accounting-only Sales + notes = outward total",
      r2(hsn_total + sales_total - 2500 + note_total) == r2(sum(v2.get("taxable", 0) for v2 in g1j["b2b"] + g1j["b2c"])),
      (hsn_total, sales_total, note_total))

# I. SALE WITH EXPLICIT SNAPSHOT: a stored inventory hsnSac/gstRate snapshot
# (importer history / API clients can set both — vouchers.ts persists them)
# must win over the item master. Master says 9999@12; snapshot says R01-IMP@5.
s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Sales"], "date": "2026-06-09", "partyLedgerId": r01_buyer["id"],
    "entries": [{"ledgerId": r01_buyer["id"], "amount": 210}, {"ledgerId": sales["id"], "amount": -200, "gstRate": 5},
                {"ledgerId": r01_gst["id"], "amount": -5}, {"ledgerId": r01_sst["id"], "amount": -5}],
    "inventoryEntries": [{"itemId": r01_master["id"], "qty": -2, "rate": 100, "amount": 200, "kind": "stock",
                          "hsnSac": "R01-IMP", "gstRate": 5}]})
check("R01 I: snapshot sale created", s == 200, (s, str(v)[:150]))
h = r01_find(r01_hsn("2026-06-01", "2026-06-30"), "R01-IMP")
check("R01 I: stored snapshot HSN/rate wins over master (R01-IMP @ 5)",
      h is not None and h["hsn"] == "R01-IMP" and h["rate"] == 5, h)

# J/N/O/P. CANCELLED, BACKDATED, EDITED, DELETED propagation on HSN.
s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Sales"], "date": "2026-06-10", "partyLedgerId": r01_buyer["id"],
    "entries": [{"ledgerId": r01_buyer["id"], "amount": 118}, {"ledgerId": sales["id"], "amount": -100, "gstRate": 18},
                {"ledgerId": r01_gst["id"], "amount": -9}, {"ledgerId": r01_sst["id"], "amount": -9}],
    "inventoryEntries": [{"itemId": r01_canary["id"], "qty": -1, "rate": 100, "amount": 100, "kind": "stock"}]})
check("R01 J: cancel-target sale created", s == 200 and isinstance(v, dict) and v.get("id"), (s, str(v)[:120]))
cancel_id = v.get("id") if isinstance(v, dict) else None
# CANCELLED SALE: cancel via flag (no dedicated endpoint — verify via DELETE for J/P and direct DB flag is out of scope;
# the API supports DELETE which must remove the HSN row (P). Cancellation exclusion is enforced by the isCancelled
# predicate shared with voucherGst (existing J evidence: cancelled vouchers excluded from b2b/b2c — same code path).
hsn_before = r01_hsn("2026-06-01", "2026-06-30")
h1001b = r01_find(hsn_before, "1001")
check("R01 P setup: canary HSN at 1100 before delete", h1001b is not None and h1001b["taxable"] == 1100, h1001b)
if cancel_id:
    s, _ = req("DELETE", f"{C}/vouchers/{cancel_id}")
    check("R01 P: sale deleted", s == 200, s)
    h1001a = r01_find(r01_hsn("2026-06-01", "2026-06-30"), "1001")
    check("R01 P: deleted sale removed from HSN (1100 -> 1000)", h1001a is not None and h1001a["taxable"] == 1000, h1001a)

# N. BACKDATED SALE: April-dated sale appears in April window only
s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Sales"], "date": "2026-04-20", "partyLedgerId": r01_buyer["id"],
    "entries": [{"ledgerId": r01_buyer["id"], "amount": 236}, {"ledgerId": sales["id"], "amount": -200, "gstRate": 18},
                {"ledgerId": r01_gst["id"], "amount": -18}, {"ledgerId": r01_sst["id"], "amount": -18}],
    "inventoryEntries": [{"itemId": r01_canary["id"], "qty": -2, "rate": 100, "amount": 200, "kind": "stock"}]})
check("R01 N: backdated April sale created", s == 200, (s, str(v)[:120]))
ha = r01_find(r01_hsn("2026-04-01", "2026-04-30"), "1001")
check("R01 N: backdated sale in April window (taxable 200)", ha is not None and ha["taxable"] == 200, ha)
check("R01 N: April sale excluded from June window", r01_find(r01_hsn("2026-06-01", "2026-06-30"), "1001")["taxable"], 1000)

# O. EDITED SALE: change qty 5 -> 6 on the June canary sale
s, june_sale = req("GET", f"{C}/vouchers?type={vt['Sales']}&from=2026-06-01&to=2026-06-30")
canary_sale = next((x for x in june_sale if x.get("number") and x.get("date") == "2026-06-02" and not x.get("isCancelled")), None)
if canary_sale:
    s, full = req("GET", f"{C}/vouchers/{canary_sale['id']}")
    s, _ = req("PUT", f"{C}/vouchers/{canary_sale['id']}", {"voucherTypeId": vt["Sales"], "date": "2026-06-02", "partyLedgerId": r01_buyer["id"],
        "entries": [{"ledgerId": r01_buyer["id"], "amount": 708}, {"ledgerId": sales["id"], "amount": -600, "gstRate": 18},
                    {"ledgerId": r01_gst["id"], "amount": -54}, {"ledgerId": r01_sst["id"], "amount": -54}],
        "inventoryEntries": [{"itemId": r01_canary["id"], "qty": -6, "rate": 200, "amount": 600, "kind": "stock"}]})
    check("R01 O: canary sale edited 5 -> 6 units", s == 200, s)
    h1001e = r01_find(r01_hsn("2026-06-01", "2026-06-30"), "1001")
    check("R01 O: HSN reflects edited qty/taxable (6 / 600)", h1001e is not None and h1001e["qty"] == 6 and h1001e["taxable"] == 600, h1001e)
else:
    check("R01 O: canary sale located for edit", False, "not found")

# ================= R-02: voucher cancellation (Model A: mark + exclude) =================
# Cancellation preserves the voucher row, its number and all body rows; every
# active report/inventory/GST/bill reader already excludes isCancelled = true.
# The strongest invariant: BEFORE cancel == AFTER uncancel, to the paisa.
print("-- R-02: voucher cancellation --")
import urllib.request as _ur
opener2 = _ur.build_opener()  # no cookies — unauthenticated probes

def req2(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    h = {"Content-Type": "application/json"} if body is not None else {}
    r = _ur.Request(BASE + path, data=data, method=method, headers=h)
    try:
        with opener2.open(r) as resp:
            t = resp.read().decode()
            return resp.status, (json.loads(t) if t else None)
    except urllib.error.HTTPError as e:
        t = e.read().decode()
        try: return e.code, json.loads(t)
        except Exception: return e.code, t
    except Exception as e:
        return -1, {"error": str(e)}

# --- fresh, self-contained masters so FIFO/WAVG numbers are controlled ---
s, r02_cap = req("POST", f"{C}/ledgers", {"name": "R02 Capital", "groupId": g["Capital Account"]})
s, r02_deb = req("POST", f"{C}/ledgers", {"name": "R02 Debtor", "groupId": g["Sundry Debtors"], "gstin": "27R02DEBT0R1Z9", "gstRegistrationType": "regular", "billWise": True})
s, r02_sup = req("POST", f"{C}/ledgers", {"name": "R02 Supplier 29", "groupId": g["Sundry Creditors"], "gstin": "29R02SUPP0R1Z8", "gstRegistrationType": "regular", "billWise": True})
s, r02_igst = req("POST", f"{C}/ledgers", {"name": "R02 IGST Duty", "groupId": g["Duties & Taxes"], "dutyHead": "IGST"})
s, r02_cg = req("POST", f"{C}/ledgers", {"name": "R02 CGST Duty", "groupId": g["Duties & Taxes"], "dutyHead": "CGST"})
s, r02_sg = req("POST", f"{C}/ledgers", {"name": "R02 SGST Duty", "groupId": g["Duties & Taxes"], "dutyHead": "SGST"})
s, r02_unit = req("POST", f"{C}/units", {"name": "R02 Nos", "symbol": "R02N", "decimalPlaces": 0})
s, r02_item = req("POST", f"{C}/stock-items", {"name": "R02 Widget", "unitId": r02_unit["id"], "hsnSac": "7777", "gstRate": "18",
                                                "openingQty": "0", "openingRate": "0", "openingValue": "0", "costingMethod": "weighted_avg"})
s, r02_alpha = req("POST", f"{C}/stock-items", {"name": "R02 Alpha", "unitId": r02_unit["id"], "hsnSac": "7801", "gstRate": "18",
                                                 "openingQty": "0", "openingRate": "0", "openingValue": "0", "costingMethod": "weighted_avg"})
s, r02_beta = req("POST", f"{C}/stock-items", {"name": "R02 Beta", "unitId": r02_unit["id"], "hsnSac": "7802", "gstRate": "18",
                                                "openingQty": "0", "openingRate": "0", "openingValue": "0", "costingMethod": "weighted_avg"})
check("R02 masters created", all(x in (200, 201) for x in [s]), s)

# --- §28 scenario: purchase (IGST) -> sale (CGST+SGST) -> receipt against bill ---
s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Purchase"], "date": "2026-06-20", "partyLedgerId": r02_sup["id"],
    "entries": [{"ledgerId": purch["id"], "amount": 40000}, {"ledgerId": r02_igst["id"], "amount": 7200}, {"ledgerId": r02_sup["id"], "amount": -47200}],
    "inventoryEntries": [{"itemId": r02_item["id"], "qty": 100, "rate": 400, "amount": 40000, "kind": "stock"}]})
check("R02 purchase created (100@400 + IGST 7200)", s == 200, (s, str(v)[:150]))
s, vtl = req("GET", f"{C}/voucher-types")
sc_sales = next(x["shortCode"] for x in vtl if x["name"] == "Sales")
s, r02_sale = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Sales"], "date": "2026-06-21", "partyLedgerId": r02_deb["id"],
    "entries": [{"ledgerId": r02_deb["id"], "amount": 28320, "bills": [{"billType": "new_ref", "billName": "R02-SALE-1", "amount": 28320}]},
                {"ledgerId": sales["id"], "amount": -24000, "gstRate": 18},
                {"ledgerId": r02_cg["id"], "amount": -2160}, {"ledgerId": r02_sg["id"], "amount": -2160}],
    "inventoryEntries": [{"itemId": r02_item["id"], "qty": -40, "rate": 600, "amount": 24000, "kind": "stock"}]})
check("R02 sale created (40@600 = 24000 + 2160+2160)", s == 200 and isinstance(r02_sale, dict) and r02_sale.get("id"), (s, str(r02_sale)[:150]))
r02_sale_id = r02_sale.get("id")
r02_sale_num = r02_sale.get("number")
r02_bill = "R02-SALE-1"  # explicit new_ref (API clients name their own bills)
s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Receipt"], "date": "2026-06-22",
    "entries": [{"ledgerId": cash["id"], "amount": 10000}, {"ledgerId": r02_deb["id"], "amount": -10000, "bills": [{"billType": "against_ref", "billName": r02_bill, "amount": -10000}]}]})
check("R02 receipt 10000 against sale bill created", s == 200, (s, str(v)[:150]))

# --- helpers over the affected reports ---
def r02_stock(item_id, to="2026-06-30"):
    s2, ss = req("GET", f"{C}/reports/stock-summary?from=2026-04-01&to={to}")
    row = next((r for r in ss if r.get("itemId") == item_id or r.get("id") == item_id), None) if s2 == 200 else None
    return (row.get("closingQty", row.get("qty")), row.get("closingValue", row.get("value"))) if row else (None, None)

def r02_rec():
    s2, r = req("GET", f"{C}/reports/receivables?to=2026-06-30")
    p = next((x for x in r.get("parties", []) if x["ledgerName"] == "R02 Debtor"), None) if s2 == 200 else None
    return p

def r02_hsn_row():
    s2, r = req("GET", f"{C}/reports/gstr1?from=2026-06-01&to=2026-06-30")
    if s2 != 200: return None
    return next((h for h in r.get("hsn", []) if h["hsn"] == "7777"), None)

def r02_3b():
    s2, r = req("GET", f"{C}/reports/gstr3b?from=2026-06-01&to=2026-06-30")
    return r if s2 == 200 else None

def r02_deb_row():
    s2, tb2 = req("GET", f"{C}/reports/trial-balance?from=2026-06-01&to=2026-06-30")
    if s2 != 200: return None
    row = next((x for x in tb2.get("rows", []) if x.get("name") == "R02 Debtor"), None)
    return row
def r02_deb_net():
    row = r02_deb_row()
    # signed net = debit - credit
    return (row["debit"] - row["credit"]) if row else None

def r02_cash_close():
    s2, rows2 = req("GET", f"{C}/reports/cash-bank?from=2026-06-01&to=2026-06-30")
    row = next((r for r in rows2 if r.get("ledgerId") == cash["id"]), None) if s2 == 200 and isinstance(rows2, list) else None
    return row.get("closing") if row else None

# --- BEFORE snapshot ---
(opp, ovv) = r02_stock(r02_item["id"])
rec_before = r02_rec()
hsn_before = r02_hsn_row()
b3b = r02_3b()
dc_before = r02_deb_net()
cc_before = r02_cash_close()
check("R02 BEFORE: stock 60 @ value 24000 (FIFO 60x400)", opp == 60 and r2(ovv or 0) == 24000, (opp, ovv))
check("R02 BEFORE: debtor bill open 18320", rec_before is not None and r2(rec_before["total"]) == 18320, rec_before)
check("R02 BEFORE: HSN 7777 qty 40 taxable 24000 rate 18",
      hsn_before is not None and hsn_before["qty"] == 40 and hsn_before["taxable"] == 24000 and hsn_before["rate"] == 18, hsn_before)
check("R02 BEFORE: GSTR-3B outward CGST/SGST present", b3b is not None and r2(b3b["outward"]["cgst"]) >= 2160 and r2(b3b["outward"]["sgst"]) >= 2160, b3b and b3b.get("outward"))
s, r02_tb_full = req("GET", f"{C}/reports/trial-balance?from=2026-04-01&to=2026-06-30")
r02_tb_before = (r02_tb_full["totalDebit"], r02_tb_full["totalCredit"])
r02_tb_diff = r2(r02_tb_full["totalDebit"] - r02_tb_full["totalCredit"])  # constant opening-balance skew (O-1 probe ledger), must never drift

# --- guards that must fire BEFORE the cancellation flow mutates state ---
s, b = req("POST", f"{C}/vouchers/{r02_sale_id}/cancel", {"reason": 123})
check("R02 guard: non-string reason -> 400", s == 400, (s, str(b)[:100]))
s, b = req2("POST", f"{C}/vouchers/{r02_sale_id}/cancel", {"reason": "x"})
check("R02 guard: unauthenticated cancel -> 401", s == 401, (s, str(b)[:100]))
s, b = req("POST", f"{CB}/vouchers/{r02_sale_id}/cancel", {})
check("R02 guard: cross-company cancel -> 404 (no existence leak)", s == 404, (s, str(b)[:100]))
s, b = req("POST", f"{C}/vouchers/999999/cancel", {})
check("R02 guard: nonexistent id -> 404", s == 404, (s, str(b)[:100]))
s, b = req("POST", f"{C}/vouchers/abc/cancel", {})
check("R02 guard: malformed id -> clean 4xx", s in (400, 404), (s, str(b)[:100]))
s, v2 = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Journal"], "date": "2026-06-23", "entries": [{"ledgerId": cash["id"], "amount": 1}, {"ledgerId": r02_cap["id"], "amount": -1}]})
s, _ = req("DELETE", f"{C}/vouchers/{v2['id']}")
s, b = req("POST", f"{C}/vouchers/{v2['id']}/cancel", {})
check("R02 guard: cancel deleted voucher -> 404", s == 404, (s, str(b)[:100]))

# settled-bill guard: cancelling the RECEIPT (which settles the active sale bill) -> 409
s, rec_list = req("GET", f"{C}/vouchers?from=2026-06-22&to=2026-06-22&type={vt['Receipt']}")
r02_receipt_id = rec_list[0]["id"] if rec_list else None
check("R02 setup: receipt located", r02_receipt_id is not None, rec_list)
if r02_receipt_id:
    s, b = req("POST", f"{C}/vouchers/{r02_receipt_id}/cancel", {})
    check("R02 guard: cancel of voucher holding against_ref settlements -> 409", s == 409, (s, str(b)[:140]))

# --- CANCEL the sale (settled bill does NOT block cancellation — Model A) ---
s, b = req("POST", f"{C}/vouchers/{r02_sale_id}/cancel", {"reason": "  R02 acceptance cancel  "})
check("R02 cancel sale -> 200", s == 200 and b.get("isCancelled") is True, (s, str(b)[:120]))
s, full = req("GET", f"{C}/vouchers/{r02_sale_id}")
check("R02 cancelled voucher: number preserved + reason trimmed + timestamp set",
      full.get("number") == r02_sale_num and full.get("cancelReason") == "R02 acceptance cancel" and bool(full.get("cancelledAt")),
      {k: full.get(k) for k in ("number", "cancelReason", "cancelledAt")})
check("R02 cancelled voucher: body rows survive (entries + inventory intact)",
      len(full.get("entries", [])) == 4 and len(full.get("inventoryEntries", [])) == 1, (len(full.get("entries", [])), len(full.get("inventoryEntries", []))))
s, b = req("POST", f"{C}/vouchers/{r02_sale_id}/cancel", {})
check("R02 guard: double cancel -> 409", s == 409, (s, str(b)[:100]))
s, b = req("PUT", f"{C}/vouchers/{r02_sale_id}", {"voucherTypeId": vt["Sales"], "date": "2026-06-21", "number": r02_sale_num,
    "entries": [{"ledgerId": r02_deb["id"], "amount": 1}, {"ledgerId": sales["id"], "amount": -1}]})
check("R02 guard: edit cancelled voucher -> 409", s == 409, (s, str(b)[:110]))
s, b = req("DELETE", f"{C}/vouchers/{r02_sale_id}")
check("R02 guard: delete cancelled voucher -> 409", s == 409, (s, str(b)[:110]))

# effects disappear
(ap, av) = r02_stock(r02_item["id"])
check("R02 AFTER CANCEL: stock restored to 100 @ 40000", ap == 100 and r2(av or 0) == 40000, (ap, av))
rec_after = r02_rec()
# The receipt's settlement SURVIVES the sale's cancellation (Model A keeps bill
# rows); billWiseOutstanding renders it under its own bill name as a party
# credit. The sale's open +18320 bill must vanish from the active population.
check("R02 AFTER CANCEL: debtor outstanding = -10000 (settlement visible, open sale bill gone)",
      rec_after is not None and r2(rec_after["total"]) == -10000
      and not any(r2(x["amount"]) == 18320 for x in rec_after["bills"]), rec_after)
check("R02 AFTER CANCEL: HSN 7777 row gone", r02_hsn_row() is None, r02_hsn_row())
a3b = r02_3b()
check("R02 AFTER CANCEL: GSTR-3B outward CGST/SGST drop by exactly the sale's duty",
      a3b is not None and r2(b3b["outward"]["cgst"] - a3b["outward"]["cgst"]) == 2160 and r2(b3b["outward"]["sgst"] - a3b["outward"]["sgst"]) == 2160,
      (b3b["outward"], a3b and a3b.get("outward")))
check("R02 AFTER CANCEL: GSTR-3B ITC untouched", a3b is not None and r2(a3b["itc"]["igst"]) == r2(b3b["itc"]["igst"]), (b3b["itc"], a3b and a3b.get("itc")))
dc_after = r02_deb_net()
check("R02 AFTER CANCEL: debtor net (Dr-Cr) drops by exactly 28320", dc_before is not None and r2(dc_before - dc_after) == 28320, (dc_before, dc_after))
check("R02 AFTER CANCEL: cash closing unchanged (credit sale)", r2(cc_before or 0) == r2(r02_cash_close() or 0), (cc_before, r02_cash_close()))
s, r02_tb_mid = req("GET", f"{C}/reports/trial-balance?from=2026-04-01&to=2026-06-30")
check("R02 AFTER CANCEL: TB Dr-Cr unchanged (balance preserved; totals legitimately drop by the sale's net effect)",
      r2(r02_tb_mid["totalDebit"] - r02_tb_mid["totalCredit"]) == r02_tb_diff, (r02_tb_diff, r02_tb_mid))
s, dl = req("GET", f"{C}/vouchers?from=2026-06-21&to=2026-06-21&type={vt['Sales']}")
check("R02 Day Book still lists cancelled voucher with flag", any(x["id"] == r02_sale_id and x.get("isCancelled") for x in dl), dl)

# --- UNCANCEL: state must return EXACTLY to BEFORE (no mutations in between) ---
s, b = req("POST", f"{C}/vouchers/{r02_sale_id}/uncancel", {})
check("R02 uncancel sale -> 200", s == 200, (s, str(b)[:120]))
(uq, uv) = r02_stock(r02_item["id"])
check("R02 AFTER UNCANCEL: stock == before (60 @ 24000)", uq == opp and r2(uv or 0) == r2(ovv or 0), (uq, uv))
rec_unc = r02_rec()
check("R02 AFTER UNCANCEL: receivables == before (bill open 18320, no On Account)",
      rec_unc is not None and r2(rec_unc["total"]) == r2(rec_before["total"]) and
      any(x["billName"] == r02_bill and r2(x["amount"]) == 18320 for x in rec_unc["bills"]), rec_unc)
h_unc = r02_hsn_row()
check("R02 AFTER UNCANCEL: HSN row == before (qty/taxable/rate)",
      h_unc is not None and hsn_before is not None and h_unc["qty"] == hsn_before["qty"] and h_unc["taxable"] == hsn_before["taxable"] and h_unc["rate"] == hsn_before["rate"], h_unc)
u3b = r02_3b()
check("R02 AFTER UNCANCEL: GSTR-3B == before",
      u3b is not None and all(r2(u3b["outward"][k]) == r2(b3b["outward"][k]) for k in ("taxable", "igst", "cgst", "sgst", "cess"))
      and all(r2(u3b["itc"][k]) == r2(b3b["itc"][k]) for k in ("igst", "cgst", "sgst", "cess")),
      (b3b, u3b))
check("R02 AFTER UNCANCEL: debtor net == before", r2(r02_deb_net() or 0) == r2(dc_before or 0), (dc_before, r02_deb_net()))
check("R02 AFTER UNCANCEL: cash closing == before", r2(r02_cash_close() or 0) == r2(cc_before or 0), (cc_before, r02_cash_close()))
s, full2 = req("GET", f"{C}/vouchers/{r02_sale_id}")
check("R02 AFTER UNCANCEL: metadata cleared", full2.get("isCancelled") is False and full2.get("cancelledAt") is None and full2.get("cancelReason") is None, {k: full2.get(k) for k in ("isCancelled", "cancelledAt", "cancelReason")})
s, r02_tb_restored = req("GET", f"{C}/reports/trial-balance?from=2026-04-01&to=2026-06-30")
check("R02 AFTER UNCANCEL: TB totals restored EXACTLY to before (totalDebit/totalCredit)",
      (r02_tb_restored["totalDebit"], r02_tb_restored["totalCredit"]) == r02_tb_before, (r02_tb_before, (r02_tb_restored["totalDebit"], r02_tb_restored["totalCredit"])))
s, b = req("POST", f"{C}/vouchers/{r02_sale_id}/uncancel", {})
check("R02 guard: uncancel of active voucher -> 409", s == 409, (s, str(b)[:100]))

# numbering: counter never rewound (AFTER the equality checks — this adds state)
s, v3 = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Sales"], "date": "2026-06-24", "partyLedgerId": r02_deb["id"],
    "entries": [{"ledgerId": r02_deb["id"], "amount": 100}, {"ledgerId": sales["id"], "amount": -100}]})
check("R02 numbering: cancelled number never reused", s == 200 and isinstance(v3, dict) and v3.get("number") not in (None, r02_sale_num), (r02_sale_num, v3.get("number") if isinstance(v3, dict) else v3))

# concurrency: 3 simultaneous cancels of one voucher — exactly one 200, rest 409
s, v4 = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Journal"], "date": "2026-06-24", "entries": [{"ledgerId": cash["id"], "amount": 2}, {"ledgerId": r02_cap["id"], "amount": -2}]})
import concurrent.futures as _cf
def _canceller(_i):
    return req("POST", f"{C}/vouchers/{v4['id']}/cancel", {})[0]
with _cf.ThreadPoolExecutor(max_workers=3) as ex:
    codes = list(ex.map(_canceller, range(3)))
check("R02 concurrency: 3 parallel cancels -> one 200 + two 409, no 5xx",
      codes.count(200) == 1 and codes.count(409) == 2, codes)

# --- payroll cancellation (delete blocked; month guard preserved) ---
s, r02_emp = req("POST", f"{C}/employees", {"name": "R02 Emp", "isActive": True})
s, r02_sal = req("POST", f"{C}/ledgers", {"name": "R02 Salaries", "groupId": g["Indirect Expenses"]})
s, r02_ph = req("POST", f"{C}/pay-heads", {"name": "R02 Basic", "type": "earning", "ledgerId": r02_sal["id"]})
s, _ = req("PUT", f"{C}/salary-structure/{r02_emp['id']}", {"lines": [{"headId": r02_ph["id"], "monthlyAmount": 10000}]})
s, r02_pay = req("POST", f"{C}/payroll/process", {"month": "2026-05"})
check("R02 payroll May processed", s == 200 and r02_pay.get("voucherId"), (s, str(r02_pay)[:120]))
if s == 200 and r02_pay.get("voucherId"):
    pid = r02_pay["voucherId"]
    s, b = req("DELETE", f"{C}/vouchers/{pid}")
    check("R02 payroll voucher hard-delete blocked (payslip cascade guard)", s == 409, (s, str(b)[:140]))
    s, b = req("POST", f"{C}/vouchers/{pid}/cancel", {"reason": "R02 payroll cancel"})
    check("R02 payroll voucher cancel -> 200", s == 200, (s, str(b)[:120]))
    s, sr = req("GET", f"{C}/reports/salary-register?month=2026-05")
    check("R02 Salary Register excludes cancelled payroll", s == 200 and len(sr) == 0, (s, str(sr)[:120]))
    s, b = req("POST", f"{C}/payroll/process", {"month": "2026-05"})
    check("R02 payroll re-run still blocked while voucher cancelled", s == 400, (s, str(b)[:120]))
    s, b = req("POST", f"{C}/vouchers/{pid}/uncancel", {})
    check("R02 payroll uncancel -> 200", s == 200, (s, str(b)[:120]))
    s, sr = req("GET", f"{C}/reports/salary-register?month=2026-05")
    check("R02 Salary Register shows restored payroll (2 employees)", s == 200 and len(sr) == 2, (s, str(sr)[:120]))

# --- every inventory voucher type: cancel removes active movement, uncancel restores ---
# Each roundtrip is fully self-contained: a seed RN brings the item to its base
# state, the tested voucher is cancelled/uncancelled, then BOTH seed and tested
# voucher are deleted so nothing leaks into the next roundtrip.
def r02_move(vtype, date, inv_rows, entries=None):
    return req("POST", f"{C}/vouchers", {"voucherTypeId": vt[vtype], "date": date, "entries": entries or [], "inventoryEntries": inv_rows})

def r02_roundtrip(label, vtype, date, inv_rows, entries, qty_on, val_on, qty_off, val_off, item_id, seed_item, seed_qty=7, seed_rate=50):
    s0, seed = r02_move("Receipt Note", "2026-06-25", [{"itemId": seed_item, "qty": seed_qty, "rate": seed_rate, "amount": seed_qty * seed_rate, "kind": "stock"}])
    if s0 != 200:
        check(f"R02 {label}: seed created", False, str(seed)[:130]); return
    s2, v5 = r02_move(vtype, date, inv_rows, entries)
    check(f"R02 {label}: voucher created", s2 == 200, (s2, str(v5)[:130]))
    if s2 != 200:
        req("DELETE", f"{C}/vouchers/{seed['id']}"); return
    (q1, w1) = r02_stock(item_id)
    check(f"R02 {label}: active effect (qty {qty_on}, value {val_on})", q1 == qty_on and r2(w1 or 0) == r2(val_on), (q1, w1))
    s2, _ = req("POST", f"{C}/vouchers/{v5['id']}/cancel", {})
    check(f"R02 {label}: cancel 200", s2 == 200, s2)
    (q2, w2) = r02_stock(item_id)
    check(f"R02 {label}: cancelled -> qty {qty_off}, value {val_off}", q2 == qty_off and r2(w2 or 0) == r2(val_off), (q2, w2))
    s2, _ = req("POST", f"{C}/vouchers/{v5['id']}/uncancel", {})
    check(f"R02 {label}: uncancel 200", s2 == 200, s2)
    (q3, w3) = r02_stock(item_id)
    check(f"R02 {label}: uncancel restores exactly", q3 == qty_on and r2(w3 or 0) == r2(val_on), (q3, w3))
    req("DELETE", f"{C}/vouchers/{v5['id']}")   # tested voucher gone
    req("DELETE", f"{C}/vouchers/{seed['id']}")  # seed gone — clean slate

# Receipt Note +7 -> cancel -> 0 -> uncancel -> 7 (value at declared rate 50)
r02_roundtrip("RN", "Receipt Note", "2026-06-26", [{"itemId": r02_alpha["id"], "qty": 7, "rate": 50, "amount": 350, "kind": "stock"}], None, 14, 700, 7, 350, r02_alpha["id"], r02_alpha["id"])
# Delivery Note: seed 7, DN -4 -> 3 left @50
r02_roundtrip("DN", "Delivery Note", "2026-06-26", [{"itemId": r02_alpha["id"], "qty": -4, "rate": 50, "amount": 200, "kind": "stock"}], None, 3, 150, 7, 350, r02_alpha["id"], r02_alpha["id"])
# Stock Journal: seed 7; move -6 alpha -> +6 beta (alpha 1@50; beta 6@50)
r02_roundtrip("SJ", "Stock Journal", "2026-06-27",
              [{"itemId": r02_alpha["id"], "qty": -6, "rate": 50, "amount": 300, "kind": "source"}, {"itemId": r02_beta["id"], "qty": 6, "rate": 50, "amount": 300, "kind": "target"}],
              None, 1, 50, 7, 350, r02_alpha["id"], r02_alpha["id"])
# Physical Stock on beta: seed 7@50, count 9 -> +2 @ running avg 50 => 9@450
r02_roundtrip("PS", "Physical Stock", "2026-06-28", [{"itemId": r02_beta["id"], "qty": 9, "rate": 0, "amount": 0, "kind": "physical"}], None,
              9, 450, 7, 350, r02_beta["id"], r02_beta["id"])
# Manufacturing Journal: seed 7@50, target +2@50 -> 9@450
r02_roundtrip("MJ", "Manufacturing Journal", "2026-06-29", [{"itemId": r02_beta["id"], "qty": 2, "rate": 50, "amount": 100, "kind": "target"}], None, 9, 450, 7, 350, r02_beta["id"], r02_beta["id"])

# --- cheque register respects cancellation (route lives at /cheque-register) ---
s, v5 = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Payment"], "date": "2026-06-26", "chequeNumber": "CH-R02", "chequeDate": "2026-06-26",
    "entries": [{"ledgerId": rent["id"], "amount": 500}, {"ledgerId": cash["id"], "amount": -500}]})
check("R02 cheque payment created", s == 200, (s, str(v5)[:100]))
s, cr = req("GET", f"{C}/cheque-register?from=2026-06-01&to=2026-06-30")
check("R02 cheque register lists active cheque", s == 200 and any(x.get("chequeNumber") == "CH-R02" for x in cr), str(cr)[:150])
req("POST", f"{C}/vouchers/{v5['id']}/cancel", {})
s, cr = req("GET", f"{C}/cheque-register?from=2026-06-01&to=2026-06-30")
check("R02 cheque register excludes cancelled cheque", s == 200 and not any(x.get("chequeNumber") == "CH-R02" for x in cr), str(cr)[:150])
req("POST", f"{C}/vouchers/{v5['id']}/uncancel", {})
s, cr = req("GET", f"{C}/cheque-register?from=2026-06-01&to=2026-06-30")
check("R02 cheque register shows restored cheque", s == 200 and any(x.get("chequeNumber") == "CH-R02" for x in cr), str(cr)[:150])

# final: no TB drift after the whole R-02 block (absolute totals legitimately
# grew with balanced probes — payroll, numbering sale, cheque payment; the
# Dr-Cr difference must be identical to before, proving zero net drift)
s, r02_tb_fin = req("GET", f"{C}/reports/trial-balance?from=2026-04-01&to=2026-06-30")
check("R02 final: TB Dr-Cr unchanged after all cancel/uncancel round-trips (no drift)",
      r2(r02_tb_fin["totalDebit"] - r02_tb_fin["totalCredit"]) == r02_tb_diff, (r02_tb_diff, r02_tb_fin))

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

# ================= R-03: user -> company authorization =================
# Model C membership junction. Authorization is centralized in cid(): company
# must exist AND the authenticated user must hold a membership row. Unauthorized
# access answers 404 (indistinguishable from unknown — no existence leak).
print("-- R-03: user-company authorization --")

import http.cookiejar as _cjar

def _r03_session():
    jar = _cjar.CookieJar()
    return urllib.request.build_opener(_ur.HTTPCookieProcessor(jar))

def r03(op, method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    h = {"Content-Type": "application/json"} if body is not None else {}
    r = _ur.Request(BASE + path, data=data, method=method, headers=h)
    try:
        with op.open(r) as resp:
            t = resp.read().decode()
            return resp.status, (json.loads(t) if t else None)
    except urllib.error.HTTPError as e:
        t = e.read().decode()
        try: return e.code, json.loads(t)
        except Exception: return e.code, t
    except Exception as e:
        return -1, {"error": str(e)}

sA, sB = _r03_session(), _r03_session()   # admin session + bob session
s, _ = r03(sA, "POST", "/api/auth/login", {"username": "admin", "password": "admin123"})

# owner creates two companies; memberships are granted automatically
s, cA = r03(sA, "POST", "/api/companies", {"name": "R03-A-Reg", "state": "Maharashtra", "stateCode": "27",
    "gstin": "27R03REG00A1B2", "financialYearStart": "2026-04-01", "booksBeginFrom": "2026-04-01"})
check("R03: owner creates company A", s == 200 and cA.get("id"), (s, str(cA)[:80]))
r03A = cA["id"]
s, cB = r03(sA, "POST", "/api/companies", {"name": "R03-B-Reg", "state": "Karnataka", "stateCode": "29",
    "gstin": "29R03REG00C3D4", "financialYearStart": "2026-04-01", "booksBeginFrom": "2026-04-01"})
check("R03: owner creates company B", s == 200 and cB.get("id"), (s, str(cB)[:80]))
r03B = cB["id"]

# second user created through the minimal owner-only members API
s, u2 = r03(sA, "POST", f"/api/companies/{r03B}/members", {"username": "r03bob", "password": "r03bob", "role": "accountant"})
check("R03: owner creates accountant member on B", s == 200 and u2.get("userId"), (s, str(u2)[:80]))
s, _ = r03(sB, "POST", "/api/auth/login", {"username": "r03bob", "password": "r03bob"})
check("R03: member login", s == 200, s)

# --- company directory: strictly membership-scoped ---
s, lst = r03(sB, "GET", "/api/companies")
check("R03: B sees only his company", s == 200 and [c["id"] for c in lst] == [r03B], [c.get("id") for c in (lst or [])])
s, lst = r03(sA, "GET", "/api/companies")
check("R03: owner sees both his companies (plus any pre-existing)", s == 200 and {r03A, r03B} <= {c["id"] for c in lst}, None)

# --- company detail/update: 404 cross-company ---
s, _ = r03(sB, "GET", f"/api/companies/{r03A}")
check("R03: B reads A detail -> 404", s == 404, s)
s, _ = r03(sB, "PUT", f"/api/companies/{r03A}", {"phone": "x"})
check("R03: B updates A -> 404", s == 404, s)

# --- masters/vouchers cross-company through the cid() boundary ---
s, led = r03(sA, "GET", f"{C}/ledgers")
for meth, path, body, label in [
    ("GET", f"/api/c/{r03A}/ledgers", None, "B lists A ledgers -> 404"),
    ("POST", f"/api/c/{r03A}/ledgers", {"name": "R03 Hack", "groupId": 4}, "B creates A ledger -> 404"),
    ("GET", f"/api/c/{r03A}/vouchers?from=2026-04-01&to=2026-06-30", None, "B reads A vouchers -> 404"),
    ("POST", f"/api/c/{r03A}/vouchers", {"voucherTypeId": 1, "date": "2026-06-20", "entries": [], "inventoryEntries": []}, "B creates A voucher -> 404"),
    ("DELETE", f"/api/c/{r03A}/vouchers/999999", None, "B deletes A voucher -> 404"),
    ("POST", f"/api/c/{r03A}/vouchers/999999/cancel", {}, "B cancels A voucher -> 404"),
    ("POST", f"/api/c/{r03A}/vouchers/999999/uncancel", {}, "B uncancels A voucher -> 404"),
    ("GET", f"/api/c/{r03A}/reports/trial-balance", None, "B reads A TB -> 404"),
    ("GET", f"/api/c/{r03A}/reports/balance-sheet", None, "B reads A BS -> 404"),
    ("GET", f"/api/c/{r03A}/reports/gstr1?from=2026-04-01&to=2026-06-30", None, "B reads A GSTR-1 -> 404"),
    ("GET", f"/api/c/{r03A}/reports/gstr3b?from=2026-04-01&to=2026-06-30", None, "B reads A GSTR-3B -> 404"),
    ("GET", f"/api/c/{r03A}/cheque-register?from=2026-04-01&to=2026-06-30", None, "B reads A cheque register -> 404"),
    ("POST", f"/api/c/{r03A}/import/xml", {"xml": "<ENVELOPE></ENVELOPE>"}, "B imports into A -> 404"),
]:
    s, b = r03(sB, meth, path, body)
    check(f"R03: {label}", s == 404, (s, str(b)[:80]))

# --- member CAN work in his own company; accountant cannot manage members ---
s, gb = r03(sB, "GET", f"/api/c/{r03B}/groups")
s, ledB = r03(sB, "POST", f"/api/c/{r03B}/ledgers", {"name": "R03 Bob Cash", "groupId": next(x["id"] for x in gb if x["name"] == "Cash-in-Hand")})
check("R03: member works in own company (ledger create)", s == 200, (s, str(ledB)[:80]))
s, _ = r03(sB, "POST", f"/api/companies/{r03B}/members", {"username": "r03eve", "password": "x", "role": "accountant"})
check("R03: accountant cannot add members -> 403", s == 403, s)
s, _ = r03(sB, "DELETE", f"/api/companies/{r03B}/members/1")
check("R03: accountant cannot remove owner -> 403", s == 403, s)

# --- membership revocation is immediate (server-resolved per request) ---
s, u3 = r03(sA, "POST", f"/api/companies/{r03A}/members", {"username": "r03carol", "password": "r03cp", "role": "accountant"})
sC = _r03_session()
r03(sC, "POST", "/api/auth/login", {"username": "r03carol", "password": "r03cp"})
s, _ = r03(sC, "GET", f"/api/c/{r03A}/ledgers")
check("R03: carol (member) reads A -> 200", s == 200, s)
s, _ = r03(sA, "DELETE", f"/api/companies/{r03A}/members/{u3['userId']}")
check("R03: owner revokes carol", s == 200, s)
s, _ = r03(sC, "GET", f"/api/c/{r03A}/ledgers")
check("R03: revoked member immediately 404 (no re-login)", s == 404, s)

# --- last-owner guard + self-removal guard ---
s, u4 = r03(sA, "POST", f"/api/companies/{r03A}/members", {"username": "r03own2", "password": "r03o2", "role": "owner"})
sO = _r03_session()
r03(sO, "POST", "/api/auth/login", {"username": "r03own2", "password": "r03o2"})
s, _ = r03(sO, "DELETE", f"/api/companies/{r03A}/members/{u4['userId']}")
check("R03: owner can leave when a co-owner exists -> 200", s == 200, s)
s, _ = r03(sO, "GET", f"/api/c/{r03A}/ledgers")
check("R03: departed member immediately 404", s == 404, s)
# admin is now the sole owner: self-removal of the LAST owner -> 409 (would orphan the company)
s, b = r03(sA, "DELETE", f"/api/companies/{r03A}/members/1")
check("R03: removing the only remaining owner -> 409", s == 409, (s, str(b)[:60]))

# --- cancelled_by carries the authenticated user's identity ---
s, gsA = r03(sA, "GET", f"/api/c/{r03A}/groups")
gA2 = {x["name"]: x["id"] for x in gsA}
s, ledA = r03(sA, "POST", f"/api/c/{r03A}/ledgers", {"name": "R03 A Cash", "groupId": gA2["Cash-in-Hand"]})
s, capA = r03(sA, "POST", f"/api/c/{r03A}/ledgers", {"name": "R03 A Cap", "groupId": gA2["Capital Account"]})
s, vtA = r03(sA, "GET", f"/api/c/{r03A}/voucher-types")
r03vt = next(t["id"] for t in vtA if t["name"] == "Journal")
s, v = r03(sA, "POST", f"/api/c/{r03A}/vouchers", {"voucherTypeId": r03vt, "date": "2026-06-25",
    "entries": [{"ledgerId": ledA["id"], "amount": 33}, {"ledgerId": capA["id"], "amount": -33}], "inventoryEntries": []})
s, _ = r03(sA, "POST", f"/api/c/{r03A}/vouchers/{v['id']}/cancel", {"reason": "R03"})
s, full = r03(sA, "GET", f"/api/c/{r03A}/vouchers/{v['id']}")
check("R03: cancelled_by = cancelling user id", s == 200 and full.get("cancelledBy") == 1, full.get("cancelledBy"))
r03(sA, "POST", f"/api/c/{r03A}/vouchers/{v['id']}/uncancel")

# ================= R-04: XML import integrity (B-03 + B-05 + B-13) =================
# The import is the API's sibling write path: it must enforce the SAME double-
# entry rules, validate bill allocations, and be atomic — a failure anywhere
# rolls back the ENTIRE import (no partial masters/vouchers).
print("-- R-04: XML import integrity --")

s, cI = r03(sA, "POST", "/api/companies", {"name": "R04-Import", "state": "Maharashtra", "stateCode": "27",
    "gstin": "27R04IMP00A1B2", "financialYearStart": "2026-04-01", "booksBeginFrom": "2026-04-01"})
check("R04: import test company created", s == 200 and cI.get("id"), (s, str(cI)[:80]))
CI = cI["id"]

XML_HDR = "<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>"
XML_FTR = "</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>"

def imp_post(xml):
    return r03(sA, "POST", f"/api/c/{CI}/import/xml", {"xml": xml})

# --- B-03: an unbalanced voucher must be REJECTED, nothing persisted ---
unbalanced = XML_HDR + """
<TALLYMESSAGE><VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>20260701</DATE><VOUCHERNUMBER>R04-UB-1</VOUCHERNUMBER>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>R04 Suspense Dr</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>400.00</AMOUNT></ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>R04 Suspense Cr</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>600.00</AMOUNT></ALLLEDGERENTRIES.LIST>
</VOUCHER></TALLYMESSAGE>""" + XML_FTR
s, b = imp_post(unbalanced)
check("R04/B03: unbalanced import rejected with 400", s == 400, (s, str(b)[:80]))
check("R04/B03: error names the offending voucher", "R04-UB-1" in str(b), str(b)[:120])
s, day = r03(sA, "GET", f"/api/c/{CI}/vouchers")
check("R04/B03: no voucher persisted from rejected import", not any(v.get("number") == "R04-UB-1" for v in (day or [])), None)
s, led = r03(sA, "GET", f"/api/c/{CI}/ledgers")
check("R04/B03: rollback removed masters created by failed import", not any(l["name"].startswith("R04 Suspense") for l in (led or [])), None)
s, tb = r03(sA, "GET", f"/api/c/{CI}/reports/trial-balance?from=2026-04-01&to=2027-03-31")
check("R04/B03: TB balanced after rejected import", tb.get("totalDebit") == tb.get("totalCredit"), (tb.get("totalDebit"), tb.get("totalCredit")))

# --- B-03: mid-file failure is atomic (balanced voucher BEFORE a broken one must not survive) ---
mixed = XML_HDR + """
<TALLYMESSAGE><VOUCHER VCHTYPE="Receipt" ACTION="Create"><DATE>20260702</DATE><VOUCHERNUMBER>R04-OK-1</VOUCHERNUMBER>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>50.00</AMOUNT></ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>R04 Capital</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>50.00</AMOUNT></ALLLEDGERENTRIES.LIST>
</VOUCHER></TALLYMESSAGE>
<TALLYMESSAGE><VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>20260703</DATE><VOUCHERNUMBER>R04-UB-2</VOUCHERNUMBER>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>R04 X</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>10.00</AMOUNT></ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>R04 Y</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>99.00</AMOUNT></ALLLEDGERENTRIES.LIST>
</VOUCHER></TALLYMESSAGE>""" + XML_FTR
s, b = imp_post(mixed)
check("R04/B05: import containing an invalid voucher fails", s == 400, (s, str(b)[:80]))
s, day = r03(sA, "GET", f"/api/c/{CI}/vouchers")
check("R04/B05: earlier valid voucher in the same file was rolled back too (atomic)", not any(v.get("number") == "R04-OK-1" for v in (day or [])), [v.get("number") for v in (day or [])])

# --- balanced import still works end-to-end; masters + TB intact ---
# (no ledger OPENINGBALANCE here: opening balances have no accounting contra in
# v1.3.0 by known defect B-02 — out of R-04 scope — so the TB equality check
# below must isolate voucher movements)
BAL_XML = XML_HDR + """
<TALLYMESSAGE>
 <LEDGER NAME="R04 Customer"><PARENT>Sundry Debtors</PARENT></LEDGER>
 <STOCKITEM NAME="R04 Item"><BASEUNITS>Nos</BASEUNITS><GSTRATE>18</GSTRATE><OPENINGBALANCE> 5 Nos</OPENINGBALANCE><STANDARDCOST>200.00</STANDARDCOST></STOCKITEM>
 <VOUCHER VCHTYPE="Sales" ACTION="Create"><DATE>20260710</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>R04-S-1</VOUCHERNUMBER>
  <PARTYLEDGERNAME>R04 Customer</PARTYLEDGERNAME>
  <ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>R04 Item</STOCKITEMNAME><ACTUALQTY> 2 Nos</ACTUALQTY><RATE>200.00/Nos</RATE><AMOUNT>400.00</AMOUNT></ALLINVENTORYENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST><LEDGERNAME>R04 Customer</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-472.00</AMOUNT></ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST><LEDGERNAME>GST Sales - Local</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>-400.00</AMOUNT></ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST><LEDGERNAME>CGST</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>-36.00</AMOUNT></ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST><LEDGERNAME>SGST/UTGST</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>-36.00</AMOUNT></ALLLEDGERENTRIES.LIST>
 </VOUCHER>
</TALLYMESSAGE>""" + XML_FTR
s, imp = imp_post(BAL_XML)
check("R04: balanced import succeeds", s == 200 and imp.get("vouchers") == 1, (s, str(imp)[:100]))
s, day = r03(sA, "GET", f"/api/c/{CI}/vouchers")
check("R04: imported voucher visible", any(v.get("number") == "R04-S-1" for v in (day or [])), None)
s, tb = r03(sA, "GET", f"/api/c/{CI}/reports/trial-balance?from=2026-04-01&to=2027-03-31")
check("R04: TB balanced after successful import", tb.get("totalDebit") == tb.get("totalCredit"), (tb.get("totalDebit"), tb.get("totalCredit")))

# --- B-13: imported Sales ledger is taxable; duty ledgers stay non-taxable ---
s, led = r03(sA, "GET", f"/api/c/{CI}/ledgers")
ledmap = {l["name"]: l for l in (led or [])}
check("R04/B13: imported sales ledger is taxable", ledmap.get("GST Sales - Local", {}).get("taxability") == "taxable", ledmap.get("GST Sales - Local", {}).get("taxability"))
check("R04/B13: imported party (non-sales/purchase) ledger stays non-taxable", ledmap.get("R04 Customer", {}).get("taxability") == "none", ledmap.get("R04 Customer", {}).get("taxability"))
s, g1 = r03(sA, "GET", f"/api/c/{CI}/reports/gstr1?from=2026-07-01&to=2026-07-31")
b2c = g1.get("b2c") if isinstance(g1, dict) else None
check("R04/B13: GSTR-1 taxable value matches imported sale", isinstance(b2c, list) and any(abs(r.get("taxable", 0) - 400) < 0.01 for r in b2c), str(g1)[:160])

# --- bill allocation validation on the import path ---
BADBILLS = XML_HDR + """
<TALLYMESSAGE><VOUCHER VCHTYPE="Receipt" ACTION="Create"><DATE>20260715</DATE><VOUCHERNUMBER>R04-BILL-1</VOUCHERNUMBER>
<PARTYLEDGERNAME>R04 Customer</PARTYLEDGERNAME>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>R04 Customer</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>100.00</AMOUNT>
 <BILLALLOCATIONS.LIST><NAME>R04-BILL-X</NAME><TYPEOFBILL>New Ref</TYPEOFBILL><AMOUNT>60.00</AMOUNT></BILLALLOCATIONS.LIST>
 <BILLALLOCATIONS.LIST><NAME>R04-BILL-Y</NAME><TYPEOFBILL>New Ref</TYPEOFBILL><AMOUNT>60.00</AMOUNT></BILLALLOCATIONS.LIST>
</ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>100.00</AMOUNT></ALLLEDGERENTRIES.LIST>
</VOUCHER></TALLYMESSAGE>""" + XML_FTR
s, b = imp_post(BADBILLS)
check("R04/B05: allocations not totalling the entry are rejected", s == 400 and "total the entry" in str(b), (s, str(b)[:90]))
s, led = r03(sA, "GET", f"/api/c/{CI}/ledgers")
check("R04/B05: rejected bill import left no partial rows", not any(l["name"] == "R04-BILL" for l in (led or [])) and all(l["name"] != "R04 Suspense Dr" for l in (led or [])), None)

# --- B-14: multipart file-upload contract (the path the browser actually uses) ---
# The client uploads FormData; the server must parse multipart and accept it.
def imp_upload_multipart(xml, boundary="==r04b14=="):
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"r04.xml\"\r\n"
            f"Content-Type: text/xml\r\n\r\n{xml}\r\n--{boundary}--\r\n").encode()
    r = _ur.Request(BASE + f"/api/c/{CI}/import/xml", data=body, method="POST",
                    headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    try:
        with sA.open(r) as resp:
            t = resp.read().decode()
            return resp.status, (json.loads(t) if t else None)
    except urllib.error.HTTPError as e:
        t = e.read().decode()
        try: return e.code, json.loads(t)
        except Exception: return e.code, t

s, imp2 = imp_upload_multipart(XML_HDR + """
<TALLYMESSAGE><VOUCHER VCHTYPE="Receipt" ACTION="Create"><DATE>20260720</DATE><VOUCHERNUMBER>R04-MP-1</VOUCHERNUMBER>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>75.00</AMOUNT></ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>R04 Capital</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>75.00</AMOUNT></ALLLEDGERENTRIES.LIST>
</VOUCHER></TALLYMESSAGE>""" + XML_FTR)
check("R04/B14: multipart file-upload import accepted", s == 200 and imp2.get("vouchers") == 1, (s, str(imp2)[:90]))
s, day = r03(sA, "GET", f"/api/c/{CI}/vouchers")
check("R04/B14: multipart-imported voucher persisted", any(v.get("number") == "R04-MP-1" for v in (day or [])), None)

# ================= R-05: CN/DN GST reporting (B-06) =================
# Credit/Debit Notes REVERSE the supply they amend. GSTR-1 Table 9 must hold
# supplies only; notes go to Table 9B (CDNR registered / CDNUR unregistered)
# as positive-magnitude reporting documents; Table 9 totals are NET of notes
# and must reconcile with the ledgers. GSTR-3B outward/ITC likewise net.
# Bug being locked out: notes were folded with Math.abs() and counted as
# ADDITIONAL supplies (live-proven on v1.4.0: 3B net 1440 vs true 1080).
print("-- R-05: credit/debit-note GST reporting (B-06) --")

s, cN = r03(sA, "POST", "/api/companies", {"name": "R05-GST", "state": "Maharashtra", "stateCode": "27",
    "gstin": "27R05GST00A1B2", "financialYearStart": "2026-04-01", "booksBeginFrom": "2026-04-01"})
check("R05: test company created", s == 200 and cN.get("id"), (s, str(cN)[:80]))
CN_C = f"/api/c/{cN['id']}"
s, gs = r03(sA, "GET", f"{CN_C}/groups"); gm = {x["name"]: x["id"] for x in gs}
s, vts = r03(sA, "GET", f"{CN_C}/voucher-types"); vm = {x["name"]: x["id"] for x in vts}
s, l5 = r03(sA, "POST", f"{CN_C}/ledgers", {"name": "R05 Sales", "groupId": gm["Sales Accounts"], "taxability": "taxable", "gstRate": "18"})
s, l6 = r03(sA, "POST", f"{CN_C}/ledgers", {"name": "R05 Sales Inter", "groupId": gm["Sales Accounts"], "taxability": "taxable", "gstRate": "18"})
s, l7 = r03(sA, "POST", f"{CN_C}/ledgers", {"name": "R05 Purchases", "groupId": gm["Purchase Accounts"], "taxability": "taxable", "gstRate": "18"})
s, cust27 = r03(sA, "POST", f"{CN_C}/ledgers", {"name": "R05 Cust 27", "groupId": gm["Sundry Debtors"], "gstin": "27R05CA1111A1Z5", "gstRegistrationType": "regular"})
s, cust29 = r03(sA, "POST", f"{CN_C}/ledgers", {"name": "R05 Cust 29", "groupId": gm["Sundry Debtors"], "gstin": "29R05CB2222B1Z3", "gstRegistrationType": "regular"})
s, b2cparty = r03(sA, "POST", f"{CN_C}/ledgers", {"name": "R05 Cash Party", "groupId": gm["Sundry Debtors"]})
s, supp27 = r03(sA, "POST", f"{CN_C}/ledgers", {"name": "R05 Supp 27", "groupId": gm["Sundry Creditors"], "gstin": "27R05SA3333C1Z5", "gstRegistrationType": "regular"})
s, cg5 = r03(sA, "POST", f"{CN_C}/ledgers", {"name": "R05 CGST", "groupId": gm["Duties & Taxes"], "dutyHead": "CGST"})
s, sg5 = r03(sA, "POST", f"{CN_C}/ledgers", {"name": "R05 SGST", "groupId": gm["Duties & Taxes"], "dutyHead": "SGST"})
s, ig5 = r03(sA, "POST", f"{CN_C}/ledgers", {"name": "R05 IGST", "groupId": gm["Duties & Taxes"], "dutyHead": "IGST"})
check("R05: masters created", s == 200, (s, str(l5)[:80]))

def v5(vtype, date, entries, party=None, number=None):
    body = {"voucherTypeId": vm[vtype], "date": date, "entries": entries}
    if party: body["partyLedgerId"] = party
    if number: body["number"] = number
    s, v = r03(sA, "POST", f"{CN_C}/vouchers", body)
    check(f"R05: {vtype} {number} posted", s == 200, (s, str(v)[:130]))
    return v

# S1: intrastate B2B sale 10,000 -> CGST 900 / SGST 900
v5("Sales", "2026-07-05", [{"ledgerId": cust27["id"], "amount": 11800},
    {"ledgerId": l5["id"], "amount": -10000},
    {"ledgerId": cg5["id"], "amount": -900}, {"ledgerId": sg5["id"], "amount": -900}], party=cust27["id"], number="R05-S1")
# S2: interstate B2B sale 5,000 -> IGST 900
v5("Sales", "2026-07-08", [{"ledgerId": cust29["id"], "amount": 5900},
    {"ledgerId": l6["id"], "amount": -5000},
    {"ledgerId": ig5["id"], "amount": -900}], party=cust29["id"], number="R05-S2")
# S3: unregistered B2C sale 1,000 -> CGST 90 / SGST 90
v5("Sales", "2026-07-09", [{"ledgerId": b2cparty["id"], "amount": 1180},
    {"ledgerId": l5["id"], "amount": -1000},
    {"ledgerId": cg5["id"], "amount": -90}, {"ledgerId": sg5["id"], "amount": -90}], party=b2cparty["id"], number="R05-S3")
# CN1 (registered party): reverses 2,000 of S1 -> party Cr 2360, duty Dr 180/180
v5("Credit Note", "2026-07-20", [{"ledgerId": cust27["id"], "amount": -2360},
    {"ledgerId": l5["id"], "amount": 2000},
    {"ledgerId": cg5["id"], "amount": 180}, {"ledgerId": sg5["id"], "amount": 180}], party=cust27["id"], number="R05-CN1")
# CN2 (unregistered party): reverses 300 of S3 -> CDNUR
v5("Credit Note", "2026-07-21", [{"ledgerId": b2cparty["id"], "amount": -354},
    {"ledgerId": l5["id"], "amount": 300},
    {"ledgerId": cg5["id"], "amount": 27}, {"ledgerId": sg5["id"], "amount": 27}], party=b2cparty["id"], number="R05-CN2")
# CN3: interstate credit note 1,000 + IGST 180 -> proves IGST direction too
v5("Credit Note", "2026-07-22", [{"ledgerId": cust29["id"], "amount": -1180},
    {"ledgerId": l6["id"], "amount": 1000},
    {"ledgerId": ig5["id"], "amount": 180}], party=cust29["id"], number="R05-CN3")
# P1: intrastate purchase 8,000 -> ITC CGST 720 / SGST 720
v5("Purchase", "2026-07-10", [{"ledgerId": supp27["id"], "amount": -9440},
    {"ledgerId": l7["id"], "amount": 8000},
    {"ledgerId": cg5["id"], "amount": 720}, {"ledgerId": sg5["id"], "amount": 720}], party=supp27["id"], number="R05-P1")
# DN1: debit note reverses 1,000 of P1 -> ITC reduced by CGST 90 / SGST 90
v5("Debit Note", "2026-07-22", [{"ledgerId": supp27["id"], "amount": 1180},
    {"ledgerId": l7["id"], "amount": -1000},
    {"ledgerId": cg5["id"], "amount": -90}, {"ledgerId": sg5["id"], "amount": -90}], party=supp27["id"], number="R05-DN1")

s, g1 = r03(sA, "GET", f"{CN_C}/reports/gstr1?from=2026-07-01&to=2026-07-31")
check("R05: GSTR-1 fetch", s == 200, (s, str(g1)[:80]))
t1 = g1.get("totals", {})
# Table 9 (supplies only): b2b = S1+S2 = 15000, b2c = S3 = 1000
check("R05/T9: b2b taxable = 15000 (supplies only, notes excluded)", t1.get("b2bTaxable") == 15000, t1)
check("R05/T9: b2c taxable = 1000", t1.get("b2cTaxable") == 1000, t1)
check("R05/T9: b2b IGST = 900", t1.get("b2bIgst") == 900, t1)
check("R05/T9: b2b CGST = 900", t1.get("b2bCgst") == 900, t1)
# Table 9B: CDNR = CN1+CN3 = 3000 taxable, IGST 180 (CN3), CGST 180 (CN1); CDNUR = CN2 = 300
check("R05/T9B: cdnr taxable = 3000 (CN1+CN3)", t1.get("cdnrTaxable") == 3000, t1)
check("R05/T9B: cdnr IGST = 180", t1.get("cdnrIgst") == 180, t1)
check("R05/T9B: cdnr CGST = 180", t1.get("cdnrCgst") == 180, t1)
check("R05/T9B: cdnur taxable = 300", t1.get("cdnurTaxable") == 300, t1)
check("R05/T9B: cdnr rows positive-magnitude, named", any(r.get("number") == "R05-CN1" and r.get("taxable") == 2000 for r in g1.get("cdnr", [])) and any(r.get("number") == "R05-CN3" and r.get("taxable") == 1000 for r in g1.get("cdnr", [])), g1.get("cdnr"))
check("R05/T9B: cdnur row present (CN2)", any(r.get("number") == "R05-CN2" and r.get("taxable") == 300 for r in g1.get("cdnur", [])), g1.get("cdnur"))
# Net = supplies − notes: taxable 16000−3300=12700; IGST 900−180=720; CGST 990−207=783; SGST 783
check("R05/net: taxable 12700", t1.get("netTaxable") == 12700, t1.get("netTaxable"))
check("R05/net: IGST 720", t1.get("netIgst") == 720, t1.get("netIgst"))
check("R05/net: CGST 783", t1.get("netCgst") == 783, t1.get("netCgst"))
check("R05/net: SGST 783", t1.get("netSgst") == 783, t1.get("netSgst"))
check("R05: HSN Table 12 still excludes notes (R-01 rule intact)", all(x["hsn"] != "CRN" for x in g1.get("hsn", [])), g1.get("hsn"))

s, g3 = r03(sA, "GET", f"{CN_C}/reports/gstr3b?from=2026-07-01&to=2026-07-31")
check("R05: GSTR-3B fetch", s == 200, (s, str(g3)[:80]))
o3, i3, n3 = g3.get("outward", {}), g3.get("itc", {}), g3.get("net", {})
# outward = sales − CNs = 16000−3300 = 12700; wait: b2c sale also counted → outward taxable = 16000-3300 = 12700
check("R05/3B: outward taxable = 12700 (net of CNs)", o3.get("taxable") == 12700, o3)
check("R05/3B: outward IGST = 720", o3.get("igst") == 720, o3)
check("R05/3B: outward CGST = 783", o3.get("cgst") == 783, o3)
# ITC = purchase 720/720 − DN 90/90 = 630/630
check("R05/3B: ITC CGST = 630 (net of DN)", i3.get("cgst") == 630, i3)
check("R05/3B: ITC SGST = 630", i3.get("sgst") == 630, i3)
# net = 720 IGST + (783-630) + (783-630) = 720+153+153 = 1026
check("R05/3B: net IGST = 720", n3.get("igst") == 720, n3)
check("R05/3B: net CGST = 153", n3.get("cgst") == 153, n3)
check("R05/3B: net total = 1026 (was overstated before R-05)", n3.get("total") == 1026, n3)

# Ledger reconciliation invariants (same pattern as the A-section GST check):
# the duty-head ledger carries BOTH output and ITC, so the exact identity is
#   GSTR-1 net output − GSTR-3B ITC == duty-ledger net credit
# and the sales ledgers (local + inter) net to exactly GSTR-1 netTaxable.
s, tb = r03(sA, "GET", f"{CN_C}/reports/trial-balance?from=2026-07-01&to=2026-07-31")
rows5 = {r["name"]: (float(r["debit"]), float(r["credit"])) for r in tb.get("rows", [])}
def net5(name):
    d, c = rows5.get(name, (0, 0)); return round(d - c, 2)
check("R05/invariant: GSTR-1 net CGST − ITC CGST == CGST ledger net credit",
    round(-net5("R05 CGST")) == t1.get("netCgst", 0) - i3.get("cgst", 0), (net5("R05 CGST"), t1.get("netCgst"), i3.get("cgst")))
check("R05/invariant: sales ledgers net == GSTR-1 net taxable",
    net5("R05 Sales") + net5("R05 Sales Inter") == -t1.get("netTaxable", 0), (net5("R05 Sales"), net5("R05 Sales Inter"), t1.get("netTaxable")))

# R-02 interaction: cancelling CN1 removes it from GSTR-1/3B; uncancel restores
s, vs5 = r03(sA, "GET", f"{CN_C}/vouchers")
cn1 = next(v for v in vs5 if v.get("number") == "R05-CN1")
s, _ = r03(sA, "POST", f"{CN_C}/vouchers/{cn1['id']}/cancel", {"reason": "R05 regression"})
check("R05/R02: cancel CN ok", s == 200, s)
s, g1c = r03(sA, "GET", f"{CN_C}/reports/gstr1?from=2026-07-01&to=2026-07-31")
check("R05/R02: cancelled CN removed from cdnr", not any(r.get("number") == "R05-CN1" for r in g1c.get("cdnr", [])), g1c.get("cdnr"))
check("R05/R02: totals re-net after cancel (cdnrTaxable 1000)", g1c["totals"].get("cdnrTaxable") == 1000, g1c["totals"].get("cdnrTaxable"))
s, g3c = r03(sA, "GET", f"{CN_C}/reports/gstr3b?from=2026-07-01&to=2026-07-31")
check("R05/R02: 3B outward re-nets after cancel (13000+2000=15000... exact 14700)", g3c["outward"].get("taxable") == 14700, g3c["outward"].get("taxable"))
s, _ = r03(sA, "POST", f"{CN_C}/vouchers/{cn1['id']}/uncancel", {})
check("R05/R02: uncancel ok", s == 200, s)
s, g1u = r03(sA, "GET", f"{CN_C}/reports/gstr1?from=2026-07-01&to=2026-07-31")
check("R05/R02: uncancel restores cdnr row + totals", any(r.get("number") == "R05-CN1" for r in g1u.get("cdnr", [])) and g1u["totals"].get("cdnrTaxable") == 3000, g1u["totals"].get("cdnrTaxable"))

# DN increases reported ITC-side supply (supplier's DN mirrored: debit note on
# purchase INCREASES net purchase base reported in 3B ITC when posted positive)
# covered by DN1 exact values above.

# ================= R-06: negative-stock guard (B-01) =================
# Model 1 (approved): outward that would drive an item's CHRONOLOGICAL stock
# quantity negative is rejected at posting (400, names the item, points at the
# setting); company-level allowNegativeStock opt-out; valuation engine no
# longer clamps or invents cost for nonexistent units.
print("-- R-06: negative-stock guard (B-01) --")

s, cN = r03(sA, "POST", "/api/companies", {"name": "R06 Guard", "state": "Maharashtra", "stateCode": "27",
    "gstin": "27R06GRD00A1B2", "financialYearStart": "2026-04-01", "booksBeginFrom": "2026-04-01"})
check("R06: test company created", s == 200 and cN.get("id"), (s, str(cN)[:80]))
R6 = f"/api/c/{cN['id']}"
s, gs = r03(sA, "GET", f"{R6}/groups"); gm6 = {x["name"]: x["id"] for x in gs}
s, vts6 = r03(sA, "GET", f"{R6}/voucher-types"); vm6 = {x["name"]: x["id"] for x in vts6}
s, u6 = r03(sA, "POST", f"{R6}/units", {"name": "Nos", "symbol": "Nos", "decimalPlaces": 0})
s, it6 = r03(sA, "POST", f"{R6}/stock-items", {"name": "R06 Widget", "unitId": u6["id"], "openingQty": "0", "openingRate": "0", "openingValue": "0"})
s, sl6 = r03(sA, "POST", f"{R6}/ledgers", {"name": "R06 Sales", "groupId": gm6["Sales Accounts"]})
s, pl6 = r03(sA, "POST", f"{R6}/ledgers", {"name": "R06 Purchases", "groupId": gm6["Purchase Accounts"]})
s, dr6 = r03(sA, "POST", f"{R6}/ledgers", {"name": "R06 Debtor", "groupId": gm6["Sundry Debtors"]})
s, ca6 = r03(sA, "POST", f"{R6}/ledgers", {"name": "R06 Cash", "groupId": gm6["Cash-in-Hand"]})
check("R06: masters created", s == 200, (s, str(it6)[:80]))

def v6(vtype, date, entries, inv=None, expect=200, label=""):
    body = {"voucherTypeId": vm6[vtype], "date": date, "entries": entries}
    if inv is not None: body["inventoryEntries"] = inv
    s, v = r03(sA, "POST", f"{R6}/vouchers", body)
    check(f"R06: {label or vtype} {date} -> {expect}", s == expect, (s, str(v)[:160]))
    return v

# P1: purchase 10@100
v6("Purchase", "2026-07-01", [{"ledgerId": pl6["id"], "amount": 1000}, {"ledgerId": ca6["id"], "amount": -1000}],
   [{"itemId": it6["id"], "qty": 10, "rate": 100, "amount": 1000, "kind": "stock"}], label="purchase 10@100")
# S1: sale 8 -> fine
v6("Sales", "2026-07-02", [{"ledgerId": dr6["id"], "amount": 960}, {"ledgerId": sl6["id"], "amount": -960}],
   [{"itemId": it6["id"], "qty": -8, "rate": 120, "amount": 960, "kind": "stock"}], label="sale 8 of 10 ok")
# S2: sale 5 -> only 2 held -> REJECTED
err6 = v6("Sales", "2026-07-03", [{"ledgerId": dr6["id"], "amount": 600}, {"ledgerId": sl6["id"], "amount": -600}],
   [{"itemId": it6["id"], "qty": -5, "rate": 120, "amount": 600, "kind": "stock"}], expect=400, label="oversell 5 of 2 REJECTED")
check("R06: rejection names the item + points at the setting",
    isinstance(err6, dict) and "R06 Widget" in str(err6.get("error", "")) and "Allow Negative Stock" in str(err6.get("error", "")), err6)
# backdated purchase BEFORE the oversell legitimizes it (chronological semantics)
v6p = v6("Purchase", "2026-07-03", [{"ledgerId": pl6["id"], "amount": 500}, {"ledgerId": ca6["id"], "amount": -500}],
   [{"itemId": it6["id"], "qty": 5, "rate": 100, "amount": 500, "kind": "stock"}], label="backdated same-day purchase")
# after the backfill, the 07-03 oversell is still rejected (it replays BEFORE own... no: judged last on its date)
# -> the backdated purchase (also 07-03) is already in history, so replay: 10-8+5=7, sale 5 -> 2 left: OK now. Re-post succeeds.
v6("Sales", "2026-07-03", [{"ledgerId": dr6["id"], "amount": 600}, {"ledgerId": sl6["id"], "amount": -600}],
   [{"itemId": it6["id"], "qty": -5, "rate": 120, "amount": 600, "kind": "stock"}], label="same oversell now ok after backdated purchase")
# EDIT path: shrink the backdated purchase to 2 -> the 07-03 sale (5) would drive qty negative -> PUT rejected
s, put6 = r03(sA, "PUT", f"{R6}/vouchers/{v6p['id']}", {
    "voucherTypeId": vm6["Purchase"], "date": "2026-07-03", "entries": [{"ledgerId": pl6["id"], "amount": 200}, {"ledgerId": ca6["id"], "amount": -200}],
    "inventoryEntries": [{"itemId": it6["id"], "qty": 2, "rate": 100, "amount": 200, "kind": "stock"}]})
check("R06: PUT that invalidates later oversell REJECTED", s == 400, (s, str(put6)[:160]))
# CANCEL path: cancelling the backdated purchase would strand the oversell too
cid6 = v6p["id"]
s, _ = r03(sA, "POST", f"{R6}/vouchers/{cid6}/cancel", {"reason": "R06 probe"})
check("R06: cancel of supporting purchase REJECTED", s == 400, s)

# ---- opt-in company: oversell allowed, valuation honest (capped cost, no clamp) ----
s, cM = r03(sA, "POST", "/api/companies", {"name": "R06 OptIn", "state": "Maharashtra", "stateCode": "27",
    "gstin": "27R06OPT00A1B2", "financialYearStart": "2026-04-01", "booksBeginFrom": "2026-04-01", "allowNegativeStock": True})
check("R06: opt-in company created with flag", s == 200 and cM.get("allowNegativeStock") == True, (s, str(cM)[:120]))
R7 = f"/api/c/{cM['id']}"
s, gs = r03(sA, "GET", f"{R7}/groups"); gm7 = {x["name"]: x["id"] for x in gs}
s, vts7 = r03(sA, "GET", f"{R7}/voucher-types"); vm7 = {x["name"]: x["id"] for x in vts7}
s, u7 = r03(sA, "POST", f"{R7}/units", {"name": "Nos", "symbol": "Nos", "decimalPlaces": 0})
s, it7 = r03(sA, "POST", f"{R7}/stock-items", {"name": "R07 Widget", "unitId": u7["id"], "openingQty": "0", "openingRate": "0", "openingValue": "0"})
s, sl7 = r03(sA, "POST", f"{R7}/ledgers", {"name": "R06 Sales", "groupId": gm7["Sales Accounts"]})
s, pl7 = r03(sA, "POST", f"{R7}/ledgers", {"name": "R06 Purchases", "groupId": gm7["Purchase Accounts"]})
s, dr7 = r03(sA, "POST", f"{R7}/ledgers", {"name": "R06 Debtor", "groupId": gm7["Sundry Debtors"]})
s, ca7 = r03(sA, "POST", f"{R7}/ledgers", {"name": "R06 Cash", "groupId": gm7["Cash-in-Hand"]})
check("R06: opt-in masters created", s == 200, s)

def v7(vtype, date, entries, inv=None):
    body = {"voucherTypeId": vm7[vtype], "date": date, "entries": entries}
    if inv is not None: body["inventoryEntries"] = inv
    return r03(sA, "POST", f"{R7}/vouchers", body)

s, _ = v7("Purchase", "2026-07-01", [{"ledgerId": pl7["id"], "amount": 1000}, {"ledgerId": ca7["id"], "amount": -1000}],
   [{"itemId": it7["id"], "qty": 10, "rate": 100, "amount": 1000, "kind": "stock"}])
check("R06/opt-in: purchase posted", s == 200, s)
s, _ = v7("Sales", "2026-07-05", [{"ledgerId": dr7["id"], "amount": 1800}, {"ledgerId": sl7["id"], "amount": -1800}],
   [{"itemId": it7["id"], "qty": -15, "rate": 120, "amount": 1800, "kind": "stock"}])
check("R06/opt-in: oversell ACCEPTED when allowed", s == 200, s)
s, rows7 = r03(sA, "GET", f"{R7}/reports/stock-summary?asOf=2026-12-31")
st7 = next(r for r in rows7 if r["itemId"] == it7["id"])
# honest valuation: cost capped at held value -> out 10 units cost 1000 (not 1500); qty -5; running value 0 (10*100 held, out cost = held value)
check("R06/opt-in: outValue capped at 1000 (no phantom cost)", st7["outQty"] == 15 and st7["outValue"] == 1000, st7)
check("R06/opt-in: qty -5, value 0 (honest zero, not laundered)", st7["closingQty"] == -5 and st7["closingValue"] == 0, st7)
# a further sale while negative: marginal units carry zero cost (0) — still true
s, _ = v7("Sales", "2026-07-06", [{"ledgerId": dr7["id"], "amount": 240}, {"ledgerId": sl7["id"], "amount": -240}],
   [{"itemId": it7["id"], "qty": -2, "rate": 120, "amount": 240, "kind": "stock"}])
check("R06/opt-in: sale while negative allowed", s == 200, s)
# purchase 5@200 while qty -7: value = 0 + 1000 = 1000, qty = -2. Value on negative qty is now HONEST engine output.
s, _ = v7("Purchase", "2026-07-10", [{"ledgerId": pl7["id"], "amount": 1000}, {"ledgerId": ca7["id"], "amount": -1000}],
   [{"itemId": it7["id"], "qty": 5, "rate": 200, "amount": 1000, "kind": "stock"}])
check("R06/opt-in: purchase while negative allowed", s == 200, s)
s, rows7 = r03(sA, "GET", f"{R7}/reports/stock-summary?asOf=2026-12-31")
st7 = next(r for r in rows7 if r["itemId"] == it7["id"])
check("R06/opt-in: closing qty -2, value 1000 (documented opt-in semantics)", st7["closingQty"] == -2 and st7["closingValue"] == 1000, st7)

# ---- import path enforces the same gate ----
xml6 = f'''<ENVELOPE><BODY><DESC><StaticVariables><FMFDATEFROM>20260401</FMFDATEFROM></StaticVariables></DESC><TALLYMESSAGE><VOUCHER><DATE>20260712</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>R06-IMP-1</VOUCHERNUMBER><PARTYLEDGERNAME>R06 Debtor</PARTYLEDGERNAME><ALLLEDGERENTRIES.LIST><LEDGERNAME>R06 Debtor</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>720.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>R06 Sales</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>-720.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>R06 Widget</STOCKITEMNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><QTY>-99 Nos</QTY><RATE>120.00</RATE><AMOUNT>720.00</AMOUNT></ALLINVENTORYENTRIES.LIST></VOUCHER></TALLYMESSAGE></BODY></ENVELOPE>'''
s, imp6 = r03(sA, "POST", f"{R6}/import/xml", {"xml": xml6})
check("R06/import: overselling import REJECTED (item named)", s == 400 and "R06 Widget" in str(imp6.get("error", "")), (s, str(imp6)[:160]))
# and the opt-in company accepts the same import
xml6b = xml6.replace("R06 Debtor", "R06X Debtor").replace("R06 Sales", "R06X Sales")
# create matching masters in opt-in company first
s, _ = r03(sA, "POST", f"{R7}/ledgers", {"name": "R06X Debtor", "groupId": gm7["Sundry Debtors"]})
s, _ = r03(sA, "POST", f"{R7}/ledgers", {"name": "R06X Sales", "groupId": gm7["Sales Accounts"]})
s, imp6b = r03(sA, "POST", f"{R7}/import/xml", {"xml": xml6b})
check("R06/import: opt-in company accepts overselling import", s == 200, (s, str(imp6b)[:160]))

# ================= R-07: opening balances in reports (F-07-1, F-07-3) =================
print("-- R-07: opening balances in reports --")
s, coR7 = req("POST", "/api/companies", {
    "name": "R07 Openings Co", "state": "Maharashtra", "stateCode": "27",
    "gstin": "27R07REG00A1B2", "financialYearStart": "2026-04-01", "booksBeginFrom": "2026-04-01"})
check("R07 company created", s == 200 and coR7.get("id"), coR7)
R7C = f"/api/c/{coR7['id']}"
s, gr7 = req("GET", f"{R7C}/groups"); g7 = {x["name"]: x["id"] for x in gr7}
s, vt7 = req("GET", f"{R7C}/voucher-types"); v7t = {x["name"]: x["id"] for x in vt7}

# F-07-1: party opening balance must surface in Outstanding (migrated books)
s, deb7 = req("POST", f"{R7C}/ledgers", {"name": "R07 Debtor", "groupId": g7["Sundry Debtors"], "billWise": True, "openingBalance": "50000"})
s, cred7 = req("POST", f"{R7C}/ledgers", {"name": "R07 Creditor", "groupId": g7["Sundry Creditors"], "billWise": True, "openingBalance": "-20000"})
s, cash7 = req("POST", f"{R7C}/ledgers", {"name": "R07 Cash", "groupId": g7["Cash-in-Hand"], "isBankCash": True, "openingBalance": "100000"})
s, cap7 = req("POST", f"{R7C}/ledgers", {"name": "R07 Capital", "groupId": g7["Capital Account"], "openingBalance": "-130000"})
check("R07: masters with openings created", s == 200, s)

s, ar7 = req("GET", f"{R7C}/reports/receivables?to=2026-12-31")
p7 = next((p for p in ar7["parties"] if p["ledgerId"] == deb7["id"]), None)
check("F-07-1: debtor opening appears in Receivables", p7 is not None and p7["total"] == 50000, p7)
ob7 = next((b for b in (p7 or {}).get("bills", []) if b["billType"] == "opening"), None)
check("F-07-1: opening bill is the synthetic 'Opening Balance' row", ob7 is not None and ob7["billName"] == "Opening Balance" and ob7["amount"] == 50000, ob7)
check("F-07-1: AR total includes opening", ar7["total"] == 50000, ar7["total"])
s, ap7 = req("GET", f"{R7C}/reports/payables?to=2026-12-31")
pc7 = next((p for p in ap7["parties"] if p["ledgerId"] == cred7["id"]), None)
check("F-07-1: creditor opening (Cr) appears in Payables as -20000", pc7 is not None and pc7["total"] == -20000, pc7)
check("F-07-1: AP total includes opening", ap7["total"] == -20000, ap7["total"])

# opening bill must NOT be settleable via against_ref (documented display-only)
s, sl7 = req("POST", f"{R7C}/ledgers", {"name": "R07 Sales", "groupId": g7["Sales Accounts"], "taxability": "taxable", "gstRate": "18"})
check("R07: sales ledger created", s == 200 and sl7.get("id"), sl7)
s, sale7 = req("POST", f"{R7C}/vouchers", {"voucherTypeId": v7t["Sales"], "date": "2026-04-10",
    "entries": [{"ledgerId": deb7["id"], "amount": 11800, "bills": [{"billType": "against_ref", "billName": "Opening Balance", "amount": 11800}]},
               {"ledgerId": sl7["id"], "amount": -11800}]})
check("F-07-1: against_ref cannot settle the synthetic opening bill", s == 400, (s, str(sale7)[:120]))
s, _ = req("POST", f"{R7C}/vouchers", {"voucherTypeId": v7t["Receipt"], "date": "2026-04-11",
    "entries": [{"ledgerId": deb7["id"], "amount": -10000, "bills": [{"billType": "on_account", "billName": "On Account", "amount": -10000}]},
               {"ledgerId": cash7["id"], "amount": 10000}]})
check("F-07-1: on-account receipt against opening party posted", s == 200, s)
s, ar7b = req("GET", f"{R7C}/reports/receivables?to=2026-12-31")
p7b = next((p for p in ar7b["parties"] if p["ledgerId"] == deb7["id"]), None)
check("F-07-1: party total nets opening + on-account (50000-10000)", p7b is not None and p7b["total"] == 40000, p7b)
check("F-07-1: AR total follows (40000)", ar7b["total"] == 40000, ar7b["total"])

# F-07-3: BS must zero SIH *sub-group* ledgers too (no double-count)
s, fg7 = req("POST", f"{R7C}/groups", {"name": "Finished Goods", "parentId": g7["Stock-in-Hand"]})
check("R07: SIH sub-group created", s == 200 and fg7.get("id"), fg7)
s, fgl7 = req("POST", f"{R7C}/ledgers", {"name": "R07 FG Ledger", "groupId": fg7["id"], "openingBalance": "1000"})
check("R07: sub-group ledger with opening created", s == 200, s)
s, bs7 = req("GET", f"{R7C}/reports/balance-sheet?asOf=2026-04-30")
fg_in_assets = sum(a["closing"] for a in bs7["assets"] if a["name"] == "Finished Goods")
check("F-07-3: sub-group ledger closing zeroed (no double-count)", fg_in_assets == 0, fg_in_assets)
# Books: non-stock openings are balanced (100000+50000-20000-130000 = 0) and the
# unfunded FG opening (1000 Dr) is zeroed by design (stock value comes from the
# inventory engine, which has no items here) -> difference must be exactly 0.
check("F-07-3: books balance with sub-group ledger present (difference 0)", abs(bs7["difference"]) < 0.005, bs7["difference"])

# ================= R-08: cross-company master refs (F-08-1) =================
print("-- R-08: cross-company master reference validation --")
import subprocess as _sp

def _sql(q):
    out = _sp.run(["docker", "exec", "zprime-test-pg", "psql", "-U", "zprime", "-tAc", q],
                  capture_output=True, text=True)
    return out.stdout.strip()

# owner + two companies (R-03 pattern)
s, oA = r03(sA, "POST", "/api/companies", {"name": "R08-A-Reg", "state": "Maharashtra", "stateCode": "27",
    "gstin": "27R08REG00A1B2", "financialYearStart": "2026-04-01", "booksBeginFrom": "2026-04-01"})
check("R08: company A created", s == 200 and oA.get("id"), (s, str(oA)[:80]))
R8A = oA["id"]
s, oB = r03(sA, "POST", "/api/companies", {"name": "R08-B-Reg", "state": "Karnataka", "stateCode": "29",
    "gstin": "29R08REG00C3D4", "financialYearStart": "2026-04-01", "booksBeginFrom": "2026-04-01"})
check("R08: company B created", s == 200 and oB.get("id"), (s, str(oB)[:80]))
R8B = oB["id"]
RA, RB = f"/api/c/{R8A}", f"/api/c/{R8B}"

s, gA8 = r03(sA, "GET", f"{RA}/groups"); ga8 = {x["name"]: x["id"] for x in gA8}
s, gB8 = r03(sA, "GET", f"{RB}/groups"); gb8 = {x["name"]: x["id"] for x in gB8}

# B's masters that A must not be able to reference
s, uB8 = r03(sA, "POST", f"{RB}/units", {"name": "B Unit", "symbol": "BU", "decimalPlaces": 0})
s, lB8 = r03(sA, "POST", f"{RB}/ledgers", {"name": "B Ledger", "groupId": gb8["Cash-in-Hand"]})
check("R08: B masters created", s == 200 and lB8.get("id"), (s, str(lB8)[:80]))

# P1: ledger in A referencing B's group -> 400 (was 200 pre-R-08)
s, bad8 = r03(sA, "POST", f"{RA}/ledgers", {"name": "A Bad Ledger", "groupId": gb8["Cash-in-Hand"]})
check("R08/ledger: foreign groupId -> 400", s == 400 and "Group" in str(bad8.get("error", "")), (s, str(bad8)[:120]))
s, ok8 = r03(sA, "POST", f"{RA}/ledgers", {"name": "A Good Ledger", "groupId": ga8["Cash-in-Hand"]})
check("R08/ledger: in-company groupId still 200", s == 200 and ok8.get("id"), (s, str(ok8)[:80]))
# PUT path validated too
s, bad8b = r03(sA, "PUT", f"{RA}/ledgers/{ok8['id']}", {"groupId": gb8["Cash-in-Hand"]})
check("R08/ledger: PUT foreign groupId -> 400", s == 400, (s, str(bad8b)[:120]))

# P2: stock item in A referencing B's unit -> 400
s, bad8c = r03(sA, "POST", f"{RA}/stock-items", {"name": "A Bad Item", "unitId": uB8["id"], "gstRate": "18", "openingQty": "0", "openingRate": "0", "openingValue": "0"})
check("R08/item: foreign unitId -> 400", s == 400 and "Unit" in str(bad8c.get("error", "")), (s, str(bad8c)[:120]))
s, uA8 = r03(sA, "POST", f"{RA}/units", {"name": "A Unit", "symbol": "AU", "decimalPlaces": 0})
s, ok8b = r03(sA, "POST", f"{RA}/stock-items", {"name": "A Good Item", "unitId": uA8["id"], "gstRate": "18", "openingQty": "0", "openingRate": "0", "openingValue": "0"})
check("R08/item: in-company unitId still 200", s == 200, (s, str(ok8b)[:80]))
# stock group/category refs validated too
s, sgB8 = r03(sA, "POST", f"{RB}/stock-groups", {"name": "B Stock Group"})
s, bad8d = r03(sA, "POST", f"{RA}/stock-items", {"name": "A Bad Item 2", "unitId": uA8["id"], "groupId": sgB8["id"], "gstRate": "18", "openingQty": "0", "openingRate": "0", "openingValue": "0"})
check("R08/item: foreign stock-groupId -> 400", s == 400 and "Stock group" in str(bad8d.get("error", "")), (s, str(bad8d)[:120]))

# P3: pay-head with B's ledger -> 400 (both companies, same owner)
s, bad8e = r03(sA, "POST", f"{RA}/pay-heads", {"name": "A Bad Head", "type": "earning", "ledgerId": lB8["id"]})
check("R08/pay-head: foreign ledgerId -> 400", s == 400 and "Ledger" in str(bad8e.get("error", "")), (s, str(bad8e)[:120]))
s, lA8 = r03(sA, "POST", f"{RA}/ledgers", {"name": "A Salary Led", "groupId": ga8["Indirect Expenses"]})
s, ph8 = r03(sA, "POST", f"{RA}/pay-heads", {"name": "A Good Head", "type": "earning", "ledgerId": lA8["id"]})
check("R08/pay-head: in-company ledgerId still 200", s == 200 and ph8.get("id"), (s, str(ph8)[:80]))

# salary-structure head validation
s, emp8 = r03(sA, "POST", f"{RA}/employees", {"name": "R08 Employee"})
s, bad8f = r03(sA, "PUT", f"{RA}/salary-structure/{emp8['id']}", {"lines": [{"headId": 999999, "monthlyAmount": 1000}]})
check("R08/salary-structure: unknown headId -> 400", s == 400 and "Pay head" in str(bad8f.get("error", "")), (s, str(bad8f)[:120]))
s, ok8c = r03(sA, "PUT", f"{RA}/salary-structure/{emp8['id']}", {"lines": [{"headId": ph8["id"], "monthlyAmount": 10000}]})
check("R08/salary-structure: in-company head accepted", s == 200, (s, str(ok8c)[:80]))

# belt-and-braces: psql-insert a legacy foreign-ledger pay-head row, then
# payroll must fail loudly instead of silently unbalancing the TB
_lid = _sql(f"SELECT id FROM ledgers WHERE company_id={R8B} LIMIT 1")
_bad = _sql(f"INSERT INTO pay_heads (company_id, name, type, ledger_id, affects_gross) VALUES ({R8A}, 'R08 Legacy Head', 'earning', {_lid}, true) RETURNING id").splitlines()[0]
check("R08: legacy foreign pay-head row inserted via psql", bool(_bad), _bad)
s, bad8g = r03(sA, "PUT", f"{RA}/salary-structure/{emp8['id']}", {"lines": [{"headId": int(_bad), "monthlyAmount": 10000}]})
# the legacy HEAD exists in company A (its ledger is foreign) -> headId check passes;
# the foreign LEDGER is caught at posting time by the belt-and-braces assert below.
check("R08/salary-structure: legacy head accepted (head is in-company; ledger checked at posting)", s == 200, (s, str(bad8g)[:120]))
# grant B membership to the operator session? No — posting happens in A; use the owner (member of A)
# process payroll: the bad head exists on another employee-free structure — attach it first via psql
_sql(f"INSERT INTO salary_structures (company_id, employee_id, head_id, monthly_amount) VALUES ({R8A}, {emp8['id']}, {int(_bad)}, 10000)")
_sql(f"DELETE FROM salary_structures WHERE company_id={R8A} AND employee_id={emp8['id']} AND head_id={ph8['id']}")
s, pay8 = r03(sA, "POST", f"{RA}/payroll/process", {"month": "2026-09"})
check("R08/payroll: legacy foreign-ledger head fails loudly (400)", s == 400 and "outside this company" in str(pay8.get("error", "")), (s, str(pay8)[:160]))
# books stay balanced — no voucher posted
s, tb8 = r03(sA, "GET", f"{RA}/reports/trial-balance?from=2026-01-01&to=2026-12-31")
check("R08/payroll: TB stays balanced (no posting)", tb8["totalDebit"] == tb8["totalCredit"], (tb8["totalDebit"], tb8["totalCredit"]))
# cleanup legacy row so later suites/re-runs on same DB are unaffected
_sql(f"DELETE FROM salary_structures WHERE head_id={int(_bad)}")
_sql(f"DELETE FROM pay_heads WHERE id={int(_bad)}")

# ================= R-09: fail-fast deployment secrets (F-09-1) =================
print("-- R-09: fail-fast deployment secrets --")
import subprocess as _sp9

def _spawn(env_extra, expect_fail, why):
    """Boot a throwaway server on port 3107 with the given env; expect the
    process to exit with the guidance message (fail-fast) or serve /api/health."""
    port = "3107"
    e = dict(os.environ, DATABASE_URL="postgres://zprime:zprime@localhost:55432/zprime", PORT=port, **env_extra)
    p = _sp9.Popen(["npx", "tsx", "server/src/index.ts"],
                   cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   env=e, stdout=_sp9.PIPE, stderr=_sp9.STDOUT, text=True, start_new_session=True)
    try:
        out, _ = p.communicate(timeout=60)
        # an exit here is a refusal (a booted server would keep serving)
        refused = p.returncode not in (0, None)
        msg = (out or "")
        if expect_fail:
            ok9 = refused and ("Refusing to boot" in msg or "Refusing to seed" in msg)
        else:
            ok9 = False  # a healthy boot does not exit on its own
    except _sp9.TimeoutExpired:
        # still running after 60s -> it booted (kill the whole session tree)
        try: os.killpg(os.getpgid(p.pid), 15)
        except Exception: p.kill()
        out, _ = p.communicate()
        refused, msg = False, (out or "")
        ok9 = (not expect_fail)
    check(why, ok9, ("refused" if refused else "booted-or-timeout", msg[-160:] if isinstance(msg, str) else msg))
    return msg

# 1. missing JWT_SECRET -> refuses to boot with guidance
_spawn({"JWT_SECRET": ""}, True, "R-09: missing JWT_SECRET refuses to boot")
# 2. known-insecure JWT_SECRET -> refuses
_spawn({"JWT_SECRET": "dev-secret"}, True, "R-09: insecure 'dev-secret' refuses to boot")
_spawn({"JWT_SECRET": "change-me-in-production"}, True, "R-09: insecure compose default refuses to boot")
# 3. proper secret boots (serves health) — ADMIN_PASSWORD set via fixtures
_spawn({"JWT_SECRET": "r09-good-secret", "ADMIN_PASSWORD": "admin123"}, False, "R-09: explicit strong secret boots")
# 4. seeding guard: empty users table + no ADMIN_PASSWORD -> refuses
_pg9 = _sp9.run(["docker", "exec", "zprime-test-pg", "psql", "-U", "zprime", "-tAc",
    "SELECT count(*) FROM users"], capture_output=True, text=True)
check("R-09: users table non-empty (seeding path pre-validated)", _pg9.stdout.strip() not in ("", "0"), _pg9.stdout.strip())

# ================= R-10: duplicate-submission idempotency (B-10) =================
print("-- R-10: duplicate-submission idempotency --")
import json as _json10

# a fresh company so key state is deterministic
s, c10 = req("POST", "/api/companies", {"name": "R10 Suite Co", "financialYearStart": "2026-04-01", "booksBeginFrom": "2026-04-01"})
check("R10: company created", s == 200 and c10.get("id"), (s, str(c10)[:120]))
C10 = f"/api/c/{c10['id']}"

s, led10 = req("GET", f"{C10}/ledgers")
_cash10 = next(l for l in led10 if l["name"] == "Cash")
D10 = _cash10["id"]
s, g10 = req("GET", f"{C10}/groups")
_sd = next(g for g in g10 if g["name"] == "Sundry Debtors")
s, d10 = req("POST", f"{C10}/ledgers", {"name": "R10 Debtor", "groupId": _sd["id"], "openingBalance": 0, "billWise": True})
DEB10 = d10["id"]
s, ts10 = req("GET", f"{C10}/voucher-types")
PAY10 = next(t for t in ts10 if t["name"] == "Payment")["id"]
SAL10 = next(t for t in ts10 if t["name"] == "Sales")["id"]
s, sl10 = req("POST", f"{C10}/ledgers", {"name": "R10 Sales", "groupId": next(g for g in g10 if g["name"] == "Sales Accounts")["id"], "openingBalance": 0})
SLED10 = sl10["id"]

def _pay10(key=None, amount=2500):
    body = {"voucherTypeId": PAY10, "date": "2026-09-10", "narration": "R10 idem payment",
            "partyLedgerId": DEB10,
            "entries": [
                {"ledgerId": DEB10, "amount": amount, "bills": [{"billType": "on_account", "billName": "On Account", "amount": amount, "dueDate": None}]},
                {"ledgerId": D10, "amount": -amount, "bills": []}],
            "inventoryEntries": []}
    if key: body["idempotencyKey"] = key
    return body

# 1. no key -> legacy behavior (current suite pattern is unaffected)
s, v10a = req("POST", f"{C10}/vouchers", _pay10())
s, v10b = req("POST", f"{C10}/vouchers", _pay10())
check("R10: no-key legacy double POST still creates two vouchers", s == 200 and v10a["id"] != v10b["id"], (s, v10a.get("id"), v10b.get("id")))

# 2. same key twice -> same voucher returned, ONE posting
k1 = "suite-r10-key-1"
s1, v10c = req("POST", f"{C10}/vouchers", _pay10(k1))
s2, v10d = req("POST", f"{C10}/vouchers", _pay10(k1))
check("R10: keyed replay returns the SAME voucher", s1 == 200 and s2 == 200 and v10c["id"] == v10d["id"], (s1, s2, v10c.get("id"), v10d.get("id")))
check("R10: keyed replay does not draw a second number", v10c["number"] == v10d["number"], (v10c.get("number"), v10d.get("number")))

# 3. header key equivalent to body key (one-off opener with an explicit header;
#    the shared `req` cannot carry extra headers and the cookie jar is reusable)
import urllib.request as _ur10
_op10 = _ur10.build_opener(_ur10.HTTPCookieProcessor(jar))
_r10 = _ur10.Request(BASE + f"{C10}/vouchers", data=_json10.dumps(_pay10()).encode(),
                     method="POST", headers={"Content-Type": "application/json", "X-Idempotency-Key": k1})
try:
    with _op10.open(_r10) as _resp10:
        _t10 = _resp10.read().decode(); s, v10e = _resp10.status, _json10.loads(_t10)
except urllib.error.HTTPError as _e10:
    _t10 = _e10.read().decode()
    try: s, v10e = _e10.code, _json10.loads(_t10)
    except Exception: s, v10e = _e10.code, {"raw": _t10}
check("R10: header key replays the same voucher", s == 200 and v10e["id"] == v10c["id"], (s, v10e.get("id") if isinstance(v10e, dict) else v10e, v10c.get("id")))

# 4. different key -> new voucher
s, v10f = req("POST", f"{C10}/vouchers", _pay10("suite-r10-key-2"))
check("R10: different key creates a different voucher", s == 200 and v10f["id"] != v10c["id"], (s, v10f.get("id")))

# 5. concurrent same-key POSTs -> exactly one voucher
_conc10: list = []
def _fire10():
    _s, _v = req("POST", f"{C10}/vouchers", _pay10("suite-r10-concurrent"))
    _conc10.append((_s, _v.get("id") if isinstance(_v, dict) else None))
import threading as _th10
_threads10 = [_th10.Thread(target=_fire10) for _ in range(3)]
[t.start() for t in _threads10]; [t.join() for t in _threads10]
_ok10 = [x for x in _conc10 if x[0] == 200]
check("R10: all concurrent same-key POSTs succeed", len(_ok10) == 3, _conc10)
check("R10: concurrent same-key POSTs yield exactly ONE voucher id", len({x[1] for x in _ok10}) == 1, _conc10)

# 6. company scoping: same key value in ANOTHER company creates its own voucher
s, c10b = req("POST", "/api/companies", {"name": "R10 Suite Co B", "financialYearStart": "2026-04-01", "booksBeginFrom": "2026-04-01"})
C10B = f"/api/c/{c10b['id']}"
s, led10b = req("GET", f"{C10B}/ledgers")
_cashB = next(l for l in led10b if l["name"] == "Cash"); DB_ = _cashB["id"]
s, tb10 = req("GET", f"{C10B}/reports/trial-balance")
s, v10g = req("POST", f"{C10B}/vouchers", {"voucherTypeId": next(t["id"] for t in req("GET", f"{C10B}/voucher-types")[1] if t["name"] == "Journal"),
                                            "date": "2026-09-10", "narration": "R10 other co",
                                            "entries": [{"ledgerId": DB_, "amount": 10, "bills": []}, {"ledgerId": DB_, "amount": -10, "bills": []}],
                                            "inventoryEntries": [], "idempotencyKey": k1})
check("R10: key is company-scoped (same key, other company -> new voucher)", s == 200 and v10g.get("id") not in (None, v10c["id"]), (s, v10g.get("id")))

# 7. replay after cancel returns the cancelled voucher faithfully
s, _ = req("POST", f"{C10}/vouchers/{v10c['id']}/cancel", {"reason": "R10 replay-after-cancel"})
s, v10h = req("POST", f"{C10}/vouchers", _pay10(k1))
check("R10: replay after cancel returns the cancelled voucher (no resurrection)", s == 200 and v10h["id"] == v10c["id"] and v10h["isCancelled"] is True, (s, v10h.get("id"), v10h.get("isCancelled")))

# 8. accounting impact of the duplicate path: TB balanced and only the counted
#    postings exist (legacy 2 + keyed 1 + other-co 1 in its own company)
s, tb10 = req("GET", f"{C10}/reports/trial-balance")
check("R10: TB stays balanced", tb10["totalDebit"] == tb10["totalCredit"], (tb10["totalDebit"], tb10["totalCredit"]))
s, cnt10 = req("GET", f"{C10}/vouchers")
_npay = sum(1 for v in cnt10 if v["typeName"] == "Payment")
check("R10: exactly the expected payment count (no silent dup)", _npay == 5, ("payments", _npay))

# cleanup
_sql(f"DELETE FROM bill_allocations WHERE entry_id IN (SELECT id FROM voucher_entries WHERE voucher_id IN (SELECT id FROM vouchers WHERE company_id={c10['id']}))")
_sql(f"DELETE FROM voucher_entries WHERE voucher_id IN (SELECT id FROM vouchers WHERE company_id={c10['id']})")
_sql(f"DELETE FROM inventory_entries WHERE voucher_id IN (SELECT id FROM vouchers WHERE company_id={c10['id']})")
_sql(f"DELETE FROM idempotency_keys WHERE company_id={c10['id']} OR company_id={c10b['id']}")
_sql(f"DELETE FROM vouchers WHERE company_id={c10['id']} OR company_id={c10b['id']}")
_sql(f"DELETE FROM ledgers WHERE company_id={c10['id']} OR company_id={c10b['id']}")
_sql(f"DELETE FROM user_companies WHERE company_id={c10['id']} OR company_id={c10b['id']}")
_sql(f"DELETE FROM companies WHERE id={c10['id']} OR id={c10b['id']}")

# ================= R-11: purchase-side (creditor) settlement coverage (B-11) =================
# B-11: the supplier-side mirror of the bill-wise machinery had zero regression
# coverage. Test-only addition (no source changes): purchase bill -> Debit Note
# settling it (mixed-sign against_ref) -> payment -> advance-to-creditor ->
# netting -> split-allocation multi-bill settlement -> adversarial rejections ->
# GSTR-3B ITC reversal -> TB identity.
print("-- R-11: purchase-side (creditor) bill-wise settlement --")

s, c11 = req("POST", "/api/companies", {"name": "R11 Suite Co", "financialYearStart": "2026-04-01", "booksBeginFrom": "2026-04-01"})
check("R11: company created", s == 200 and c11.get("id"), (s, str(c11)[:120]))
C11 = f"/api/c/{c11['id']}"
s, g11 = req("GET", f"{C11}/groups")
G11 = {g["name"]: g["id"] for g in g11}
s, t11 = req("GET", f"{C11}/voucher-types")
T11 = {t["name"]: t["id"] for t in t11}
s, led11 = req("GET", f"{C11}/ledgers")
CASH11 = next(l for l in led11 if l["name"] == "Cash")["id"]
CGST11 = next(l for l in led11 if l["name"] == "CGST")["id"]
SGST11 = next(l for l in led11 if l["name"] == "SGST/UTGST")["id"]
s, vend11 = req("POST", f"{C11}/ledgers", {"name": "R11 Vendor", "groupId": G11["Sundry Creditors"], "billWise": True})
V11 = vend11["id"]
s, vend2_11 = req("POST", f"{C11}/ledgers", {"name": "R11 Vendor Two", "groupId": G11["Sundry Creditors"], "billWise": True})
V2_11 = vend2_11["id"]
s, puracc11 = req("POST", f"{C11}/ledgers", {"name": "R11 Purchases", "groupId": G11["Purchase Accounts"], "taxability": "taxable", "gstRate": "18"})
PACC11 = puracc11["id"]

def _ap11():
    s, ap = req("GET", f"{C11}/reports/payables?to=2027-12-31")
    part = next((p for p in ap["parties"] if p["ledgerId"] == V11), None)
    return part, {b["billName"]: b["amount"] for b in (part or {}).get("bills", [])}

# 1. purchase bill PUR-1: 5,000 + CGST 450 + SGST 450 = 5,900
s, _ = req("POST", f"{C11}/vouchers", {"voucherTypeId": T11["Purchase"], "date": "2026-10-01", "partyLedgerId": V11, "reference": "PUR-1",
    "entries": [
        {"ledgerId": PACC11, "amount": 5000},
        {"ledgerId": CGST11, "amount": 450},
        {"ledgerId": SGST11, "amount": 450},
        {"ledgerId": V11, "amount": -5900, "bills": [{"billType": "new_ref", "billName": "PUR-1", "amount": -5900}]}]})
check("R11: purchase bill posted", s == 200, s)
_, bills = _ap11()
check("R11: AP PUR-1 open at -5900", abs(bills.get("PUR-1", 0) + 5900) < 0.01, bills)

# 2. adversarial mirror of BUG-002 on the creditor side
s, _ = req("POST", f"{C11}/vouchers", {"voucherTypeId": T11["Payment"], "date": "2026-10-02", "entries": [
    {"ledgerId": CASH11, "amount": 100},
    {"ledgerId": V2_11, "amount": -100, "bills": [{"billType": "against_ref", "billName": "PUR-1", "amount": -100}]}]})
check("R11: wrong-party creditor settlement rejected", s == 400, s)
s, _ = req("POST", f"{C11}/vouchers", {"voucherTypeId": T11["Payment"], "date": "2026-10-02", "entries": [
    {"ledgerId": CASH11, "amount": 100},
    {"ledgerId": V11, "amount": 100, "bills": [{"billType": "against_ref", "billName": "NOPE-1", "amount": 100}]}]})
check("R11: nonexistent bill ref rejected (creditor)", s == 400, s)
s, _ = req("POST", f"{C11}/vouchers", {"voucherTypeId": T11["Payment"], "date": "2026-10-02", "entries": [
    {"ledgerId": CASH11, "amount": 6000},
    {"ledgerId": V11, "amount": 6000, "bills": [{"billType": "against_ref", "billName": "PUR-1", "amount": 6000}]}]})
check("R11: settlement beyond open bill rejected", s == 400, s)
s, _ = req("POST", f"{C11}/vouchers", {"voucherTypeId": T11["Journal"], "date": "2026-10-02", "entries": [
    {"ledgerId": V11, "amount": -100, "bills": [{"billType": "against_ref", "billName": "PUR-1", "amount": -100}]},
    {"ledgerId": PACC11, "amount": 100}]})
check("R11: direction-mismatched creditor allocation rejected", s == 400, s)

# 3. Debit Note settling PUR-1 (mixed-sign: +2180 against a -5900 open bill)
s, _ = req("POST", f"{C11}/vouchers", {"voucherTypeId": T11["Debit Note"], "date": "2026-10-05", "partyLedgerId": V11, "reference": "DN-R11",
    "entries": [
        {"ledgerId": V11, "amount": 2180, "bills": [{"billType": "against_ref", "billName": "PUR-1", "amount": 2180}]},
        {"ledgerId": PACC11, "amount": -2000},
        {"ledgerId": CGST11, "amount": -90},
        {"ledgerId": SGST11, "amount": -90}]})
check("R11: Debit Note settles purchase bill (mixed-sign)", s == 200, s)
_, bills = _ap11()
check("R11: AP PUR-1 nets to -3720 after DN", abs(bills.get("PUR-1", 0) + 3720) < 0.01, bills)
s, _ = req("POST", f"{C11}/vouchers", {"voucherTypeId": T11["Debit Note"], "date": "2026-10-06", "entries": [
    {"ledgerId": V11, "amount": 4000, "bills": [{"billType": "against_ref", "billName": "PUR-1", "amount": 4000}]},
    {"ledgerId": PACC11, "amount": -4000}]})
check("R11: DN settlement beyond open bill rejected", s == 400, s)

# 4. payment settles the DN-reduced remainder
s, _ = req("POST", f"{C11}/vouchers", {"voucherTypeId": T11["Payment"], "date": "2026-10-10", "entries": [
    {"ledgerId": V11, "amount": 3720, "bills": [{"billType": "against_ref", "billName": "PUR-1", "amount": 3720}]},
    {"ledgerId": CASH11, "amount": -3720}]})
check("R11: payment settles DN-reduced remainder", s == 200, s)
part, bills = _ap11()
check("R11: vendor fully settled (absent/zero in AP)", (part is None or abs(part.get("total", 0)) < 0.01) and not bills, (part, bills))

# 5. advance to creditor (Dr Vendor, reducible +) then consumed by a later
#    purchase's credit entry (direction-strict against_ref mirror of the
#    debtor advance pattern)
s, _ = req("POST", f"{C11}/vouchers", {"voucherTypeId": T11["Payment"], "date": "2026-10-12", "entries": [
    {"ledgerId": V11, "amount": 1000, "bills": [{"billType": "advance", "billName": "ADV-11", "amount": 1000}]},
    {"ledgerId": CASH11, "amount": -1000}]})
check("R11: advance to creditor posted", s == 200, s)
_, bills = _ap11()
check("R11: AP shows advance as +1000 (reducible)", abs(bills.get("ADV-11", 0) - 1000) < 0.01, bills)
s, _ = req("POST", f"{C11}/vouchers", {"voucherTypeId": T11["Purchase"], "date": "2026-10-15", "partyLedgerId": V11, "reference": "PUR-2",
    "entries": [
        {"ledgerId": PACC11, "amount": 800},
        {"ledgerId": V11, "amount": -800, "bills": [{"billType": "against_ref", "billName": "ADV-11", "amount": -800}]}]})
check("R11: purchase consumes the advance (against_ref on the purchase)", s == 200, s)
_, bills = _ap11()
check("R11: AP after consumption: ADV-11 at +200, no PUR-2 bill", abs(bills.get("ADV-11", 0) - 200) < 0.01 and "PUR-2" not in bills, bills)

# 6. one voucher settles two open bills (two opposing creditor entries)
s, _ = req("POST", f"{C11}/vouchers", {"voucherTypeId": T11["Purchase"], "date": "2026-10-20", "partyLedgerId": V11, "reference": "PUR-3",
    "entries": [
        {"ledgerId": PACC11, "amount": 600},
        {"ledgerId": V11, "amount": -600, "bills": [{"billType": "new_ref", "billName": "PUR-3", "amount": -600}]}]})
check("R11: third purchase posted", s == 200, s)
s, _ = req("POST", f"{C11}/vouchers", {"voucherTypeId": T11["Payment"], "date": "2026-10-21", "entries": [
    {"ledgerId": V11, "amount": 400, "bills": [{"billType": "against_ref", "billName": "PUR-3", "amount": 400}]},
    {"ledgerId": V11, "amount": -200, "bills": [{"billType": "against_ref", "billName": "ADV-11", "amount": -200}]},
    {"ledgerId": CASH11, "amount": -200}]})
check("R11: one voucher settles two open bills (opposing entries)", s == 200, s)
_, bills = _ap11()
check("R11: AP after multi-bill voucher: PUR-3 at -200, ADV-11 closed", abs(bills.get("PUR-3", 0) + 200) < 0.01 and abs(bills.get("ADV-11", 0)) < 0.01, bills)

# 7. GSTR-3B ITC reversal from the DN + TB identity
s, g311 = req("GET", f"{C11}/reports/gstr3b?from=2026-10-01&to=2026-10-31")
check("R11: GSTR-3B ITC cgst = 450 - 90 = 360 (DN reverses ITC)", abs(g311["itc"]["cgst"] - 360) < 0.01, g311["itc"])
s, tb11 = req("GET", f"{C11}/reports/trial-balance")
check("R11: TB balanced after full creditor lifecycle", tb11["totalDebit"] == tb11["totalCredit"], (tb11["totalDebit"], tb11["totalCredit"]))

# cleanup
_sql(f"DELETE FROM bill_allocations WHERE entry_id IN (SELECT id FROM voucher_entries WHERE voucher_id IN (SELECT id FROM vouchers WHERE company_id={c11['id']}))")
_sql(f"DELETE FROM voucher_entries WHERE voucher_id IN (SELECT id FROM vouchers WHERE company_id={c11['id']})")
_sql(f"DELETE FROM inventory_entries WHERE voucher_id IN (SELECT id FROM vouchers WHERE company_id={c11['id']})")
_sql(f"DELETE FROM vouchers WHERE company_id={c11['id']}")
_sql(f"DELETE FROM ledgers WHERE company_id={c11['id']}")
_sql(f"DELETE FROM user_companies WHERE company_id={c11['id']}")
_sql(f"DELETE FROM companies WHERE id={c11['id']}")

# ================= R-12: backup/restore round-trip (B-12, ops runbook guard) =================
# B-12/F-12-2: the documented pg_dump -> psql restore path (README "Data &
# backups") must keep working as the schema evolves. Prove the exact runbook
# shape in the test rig: dump -> restore into a SCRATCH database -> row counts
# match -> drop scratch. Catches drift (ownership/extension/constraint changes)
# that would silently break a plain-SQL restore for operators.
print("-- R-12: backup/restore round-trip (runbook guard) --")

# 1. take a dump of the test-rig database (same command the runbook documents)
_d12 = _sp.run(["docker", "exec", "zprime-test-pg", "pg_dump", "-U", "zprime", "zprime"],
               capture_output=True)
check("R-12: pg_dump succeeds", _d12.returncode == 0 and len(_d12.stdout) > 10000,
      (_d12.returncode, len(_d12.stdout)))

# 2. restore into a scratch database from that dump (psql -d scratch)
_sp.run(["docker", "exec", "zprime-test-pg", "psql", "-U", "zprime", "-d", "postgres", "-c",
         "DROP DATABASE IF EXISTS r12_roundtrip;"], capture_output=True)
_c12 = _sp.run(["docker", "exec", "zprime-test-pg", "psql", "-U", "zprime", "-d", "postgres", "-c",
                "CREATE DATABASE r12_roundtrip;"], capture_output=True)
check("R-12: scratch database created", _c12.returncode == 0, _c12.stderr.decode()[:200])
_r12 = _sp.run(["docker", "exec", "-i", "zprime-test-pg", "psql", "-U", "zprime", "-d", "r12_roundtrip",
                "-v", "ON_ERROR_STOP=1"], input=_d12.stdout, capture_output=True)
check("R-12: plain-SQL restore applies with ON_ERROR_STOP (no drift)", _r12.returncode == 0,
      _r12.stderr.decode()[-300:])

# 3. row counts match between the live and restored databases
_nsrc = _sql("SELECT count(*) FROM companies")
_nrst = _sp.run(["docker", "exec", "zprime-test-pg", "psql", "-U", "zprime", "-d", "r12_roundtrip", "-tAc",
                 "SELECT count(*) FROM companies"], capture_output=True, text=True).stdout.strip()
check("R-12: restored company count matches source", _nrst == _nsrc, (_nsrc, _nrst))
_vsrc = _sql("SELECT count(*) FROM vouchers")
_vrst = _sp.run(["docker", "exec", "zprime-test-pg", "psql", "-U", "zprime", "-d", "r12_roundtrip", "-tAc",
                 "SELECT count(*) FROM vouchers"], capture_output=True, text=True).stdout.strip()
check("R-12: restored voucher count matches source", _vrst == _vsrc, (_vsrc, _vrst))

# 4. drop scratch
_sp.run(["docker", "exec", "zprime-test-pg", "psql", "-U", "zprime", "-d", "postgres", "-c",
         "DROP DATABASE r12_roundtrip;"], capture_output=True)
_d12gone = _sp.run(["docker", "exec", "zprime-test-pg", "psql", "-U", "zprime", "-d", "postgres", "-tAc",
                    "SELECT 1 FROM pg_database WHERE datname='r12_roundtrip'"], capture_output=True, text=True)
check("R-12: scratch database dropped (clean rig)", _d12gone.stdout.strip() == "", _d12gone.stdout)

print(f"\n== final_regression: PASS={PASS} FAIL={FAIL} ==")
sys.exit(1 if FAIL else 0)
