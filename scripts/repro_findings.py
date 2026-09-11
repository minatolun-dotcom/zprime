#!/usr/bin/env python3
"""Reproduce every open finding (F-GRP-01, F-TDS-01, A-02, A-03, A-04, A-05, A-06, A-07)
on a FRESH schema + its own server instance, BEFORE any fix is applied.
Usage: python3 scripts/repro_findings.py
"""
import json, os, subprocess, sys, time, urllib.request, urllib.error, http.cookiejar

BASE = "http://localhost:3105"
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

print("== repro_findings: fresh schema + server on 3105 ==")
subprocess.run(["docker", "exec", "zprime-test-pg", "psql", "-U", "zprime", "-c",
                "DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;"],
               capture_output=True, check=True)
env = dict(os.environ, DATABASE_URL="postgres://zprime:zprime@localhost:55432/zprime", PORT="3105")
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

    req("POST", "/api/auth/login", {"username": "admin", "password": "admin123"})
    s, co = req("POST", "/api/companies", {
        "name": "Repro Co", "state": "Maharashtra", "stateCode": "27",
        "gstin": "27REPRO12CO9", "financialYearStart": "2026-04-01", "booksBeginFrom": "2026-04-01"})
    cid = co["id"]; C = f"/api/c/{cid}"
    s, groups = req("GET", f"{C}/groups")
    g = {gr["name"]: gr["id"] for gr in groups}
    s, vts = req("GET", f"{C}/voucher-types")
    vt = {v["name"]: v["id"] for v in vts}
    s, ledgers = req("GET", f"{C}/ledgers")
    L = {l["name"]: l["id"] for l in ledgers}

    ok = lambda name, cond, d="": print(("  ok   " if cond else "  FAIL ") + name + (f" :: {d}" if d else ""))
    repro = {}

    # ---- F-GRP-01: group create ----
    s, b = req("POST", f"{C}/groups", {"name": "Marketing Expenses"})
    repro["F-GRP-01-create-500"] = (s == 500)
    ok("F-GRP-01 group create", s in (200, 201), f"status={s} body={b}")
    if s in (200, 201):
        repro["F-GRP-01-nature"] = (b.get("nature") in (None, ""))
        ok("  nature set?", bool(b.get("nature")), f"nature={b.get('nature')!r}")

    # ---- F-TDS-01: tds-sections list + create (need >=2 rows for sort comparator) ----
    s, b = req("POST", f"{C}/tds-sections", {"section": "194H", "rate": "2", "threshold": "15000"})
    ok("F-TDS-01 tds-section create", s in (200, 201), f"status={s} body={b}")
    tds_id = b["id"] if isinstance(b, dict) and b.get("id") else None
    s, b = req("POST", f"{C}/tds-sections", {"section": "194I", "rate": "10", "threshold": "240000"})
    ok("F-TDS-01 tds-section create 2nd", s in (200, 201), f"status={s} body={b}")
    s, b = req("GET", f"{C}/tds-sections")
    repro["F-TDS-01-list-500"] = (s == 500)
    ok("F-TDS-01 tds-section list", s == 200, f"status={s} body={str(b)[:100]}")

    # ---- A-03: negative deduction amount on a pay head ----
    s, sal = req("POST", f"{C}/ledgers", {"name": "Salaries X", "groupId": g["Indirect Expenses"]})
    s, spp = req("POST", f"{C}/ledgers", {"name": "Salary Payable X", "groupId": g["Current Liabilities"]})
    s, pt = req("POST", f"{C}/ledgers", {"name": "PT Payable X", "groupId": g["Duties & Taxes"]})
    s, ph = req("POST", f"{C}/pay-heads", {"name": "Basic X", "type": "earning", "ledgerId": sal["id"]})
    s, phd = req("POST", f"{C}/pay-heads", {"name": "Prof Tax X", "type": "deduction", "ledgerId": pt["id"]})
    s, emp_r = req("POST", f"{C}/employees", {"name": "Emp Neg", "payStructure": [
        {"headId": ph["id"], "monthlyAmount": 20000},
        {"headId": phd["id"], "monthlyAmount": -200}]})
    ok("A-03 negative deduction accepted?", s == 200, f"status={s} body={str(emp_r)[:200]}")
    repro["A-03"] = (s == 200)
    if s == 200 and isinstance(emp_r, dict):
        net = float(emp_r.get("net", 0)) if emp_r.get("net") is not None else None
        ok("  net inflated?", net is not None and net > 20000, f"net={net}")
        emp_neg_id = emp_r.get("id")
    else:
        emp_neg_id = None

    # ---- A-04: TDS report counts remittances ----
    s, rent = req("POST", f"{C}/ledgers", {"name": "Office Rent X", "groupId": g["Indirect Expenses"],
                                           "tdsSectionId": tds_id, "gstin": "27RENT9999R1Z5", "gstRegistrationType": "regular"})
    s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Payment"], "date": "2026-04-10", "narration": "rent after TDS",
        "entries": [{"ledgerId": rent["id"], "amount": 10000},
                    {"ledgerId": L["TDS Payable"], "amount": -200, "tdsSectionId": tds_id},
                    {"ledgerId": L["Cash"], "amount": -9800}]})
    ok("TDS deduction voucher", s == 200, v)
    s, v2 = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Payment"], "date": "2026-05-10", "narration": "TDS remitted",
        "entries": [{"ledgerId": L["TDS Payable"], "amount": 200}, {"ledgerId": L["Cash"], "amount": -200}]})
    ok("TDS remittance voucher", s == 200, v2)
    s, tds_r = req("GET", f"{C}/reports/tds?from=2026-04-01&to=2026-05-31")
    if s == 200 and isinstance(tds_r, dict):
        secs = {x["section"]: x["amount"] for x in tds_r.get("sections", [])}
        total = sum(secs.values())
        # deduction was 200 (194H); remittance 200 must NOT appear as a deduction
        repro["A-04"] = abs(total - 200) > 0.01
        ok("A-04 TDS report", not repro["A-04"], f"sections={secs} total={total} (real deductions=200)")
    else:
        ok("A-04 TDS report fetch", False, f"status={s}")

    # ---- A-05: on-account advance invisible in receivables ----
    s, cust = req("POST", f"{C}/ledgers", {"name": "Adv Cust X", "groupId": g["Sundry Debtors"], "billWise": True})
    s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Receipt"], "date": "2026-04-12",
        "entries": [{"ledgerId": cust["id"], "amount": -1000, "bills": [{"billType": "on_account", "billName": "On Account", "amount": -1000}]},
                    {"ledgerId": L["Cash"], "amount": 1000}]})
    ok("on-account receipt", s == 200, v)
    s, rec_r = req("GET", f"{C}/reports/receivables")
    party = None
    if isinstance(rec_r, list):
        party = next((p for p in rec_r if isinstance(p, dict) and p.get("ledgerName") == "Adv Cust X"), None)
    repro["A-05"] = party is None
    ok("A-05 on-account in receivables", party is not None,
       f"status={s} resp={str(rec_r)[:150]}")

    # ---- A-06: sub-period P&L cumulative ----
    s, sales = req("POST", f"{C}/ledgers", {"name": "Sales X", "groupId": g["Sales Accounts"]})
    s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Sales"], "date": "2026-04-20",
        "entries": [{"ledgerId": cust["id"], "amount": 5000}, {"ledgerId": sales["id"], "amount": -5000}]})
    ok("April sale", s == 200, v)
    s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Sales"], "date": "2026-05-20",
        "entries": [{"ledgerId": cust["id"], "amount": 3000}, {"ledgerId": sales["id"], "amount": -3000}]})
    ok("May sale", s == 200, v)
    s, pl_r = req("GET", f"{C}/reports/profit-loss?from=2026-05-01&to=2026-05-31")
    if s == 200 and isinstance(pl_r, dict):
        repro["A-06"] = abs(float(pl_r.get("sales", 0)) - 3000) > 0.01
        ok("A-06 sub-period P&L", not repro["A-06"], f"sales={pl_r.get('sales')} want 3000 (May-only)")
    else:
        ok("A-06 P&L fetch", False, f"status={s} body={str(pl_r)[:100]}")

    # ---- A-07: contradictory supply type zeroes IGST in GSTR-3B ----
    s, pi = req("POST", f"{C}/ledgers", {"name": "Purchase Inter X", "groupId": g["Purchase Accounts"], "taxability": "taxable", "gstRate": 18})
    s, sup = req("POST", f"{C}/ledgers", {"name": "Intra Supplier X", "groupId": g["Sundry Creditors"],
                                          "gstin": "27AAAAA0000A1Z0", "gstRegistrationType": "regular", "billWise": True})
    s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Purchase"], "date": "2026-05-18", "partyLedgerId": sup["id"],
        "entries": [{"ledgerId": pi["id"], "amount": 6000}, {"ledgerId": L["IGST"], "amount": 1080}, {"ledgerId": sup["id"], "amount": -7080}]})
    ok("contradictory IGST purchase", s == 200, v)
    s, b3 = req("GET", f"{C}/reports/gstr3b?from=2026-05-01&to=2026-05-31")
    if s == 200 and isinstance(b3, dict):
        itc_igst = float(b3.get("itc", {}).get("igst", 0))
        repro["A-07"] = abs(itc_igst) < 0.005
        ok("A-07 IGST zeroed in 3B?", repro["A-07"], f"itc.igst={itc_igst} (ledger has 1080)")
    else:
        ok("A-07 3B fetch", False, f"status={s} body={str(b3)[:100]}")

    # ---- A-02: bill name collision across voucher types ----
    s, sh = req("POST", f"{C}/ledgers", {"name": "Collide Cust X", "groupId": g["Sundry Debtors"], "billWise": True})
    s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Sales"], "date": "2026-05-01", "partyLedgerId": sh["id"],
        "entries": [{"ledgerId": sh["id"], "amount": 6160, "bills": [{"billType": "new_ref", "billName": "1", "amount": 6160}]},
                    {"ledgerId": sales["id"], "amount": -6160}]})
    s, v = req("POST", f"{C}/vouchers", {"voucherTypeId": vt["Credit Note"], "date": "2026-05-21", "partyLedgerId": sh["id"],
        "entries": [{"ledgerId": sh["id"], "amount": -2360, "bills": [{"billType": "new_ref", "billName": "1", "amount": -2360}]},
                    {"ledgerId": sales["id"], "amount": 2360}]})
    ok("CN with bill named '1'", s == 200, v)
    s, rec_r = req("GET", f"{C}/reports/receivables")
    party = None
    if isinstance(rec_r, list):
        party = next((p for p in rec_r if isinstance(p, dict) and p.get("ledgerName") == "Collide Cust X"), None)
    if party:
        bills = party.get("bills", [])
        one = next((x for x in bills if x.get("billName") == "1"), None)
        repro["A-02"] = one is not None and abs(abs(float(one["amount"])) - 6160) > 0.01
        ok("A-02 collision", repro["A-02"], f"bills={[(x['billName'], x['amount']) for x in bills]}")
    else:
        ok("A-02 collision", False, f"status={s} resp={str(rec_r)[:150]}")

    print("\n== REPRODUCED:", {k: v for k, v in repro.items() if v}, "==")
finally:
    server.terminate()
