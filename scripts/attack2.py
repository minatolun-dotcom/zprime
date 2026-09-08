#!/usr/bin/env python3
"""Phase 8 second adversarial pass: attacks the FIXES themselves.
Requires zprime-test-pg. Starts its own server on 3103 with a fresh schema."""
import json, os, subprocess, sys, time, urllib.request, urllib.error, http.cookiejar, threading

BASE = "http://localhost:3103"
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

def req(method, path, body=None, raw=False, headers=None, use_opener=True):
    data = None
    h = dict(headers or {})
    if body is not None:
        data = json.dumps(body).encode() if not isinstance(body, (str, bytes)) else (body.encode() if isinstance(body, str) else body)
        h.setdefault("Content-Type", "application/json")
    r = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    o = opener if use_opener else urllib.request.build_opener()
    try:
        with o.open(r) as resp:
            text = resp.read().decode()
            return resp.status, (text if raw else (json.loads(text) if text else None))
    except urllib.error.HTTPError as e:
        try:
            text = e.read().decode()
        except Exception:
            text = ""
        return e.code, (text if raw else (json.loads(text) if text else {"error": text}))
    except Exception as e:
        return -1, {"error": str(e)}

PASS = 0; FAIL = 0
def check(name, cond, detail=""):
    global PASS, FAIL
    if cond: PASS += 1; print(f"  ok  {name}")
    else:
        FAIL += 1; print(f" FAIL {name} :: {detail}")

SERVER_PROC = [None]
def start_server():
    env = dict(os.environ, DATABASE_URL="postgres://zprime:zprime@localhost:55432/zprime", PORT="3103")
    SERVER_PROC[0] = subprocess.Popen(["npx", "tsx", "server/src/index.ts"],
        cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    for _ in range(60):
        try:
            s, b = req("GET", "/api/health")
            if b and b.get("ok"): return True
        except Exception: pass
        time.sleep(1)
    return False

subprocess.run(["docker", "exec", "zprime-test-pg", "psql", "-U", "zprime", "-c",
                "DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;"], capture_output=True)
if not start_server():
    print("server did not start"); sys.exit(1)
try:
    req("POST", "/api/auth/login", {"username": "admin", "password": "admin123"})
    s, A = req("POST", "/api/companies", {"name": "AtkA", "state": "Maharashtra", "stateCode": "27",
        "financialYearStart": "2025-04-01", "booksBeginFrom": "2025-04-01"})
    s, B = req("POST", "/api/companies", {"name": "AtkB", "state": "Karnataka", "stateCode": "29",
        "financialYearStart": "2025-04-01", "booksBeginFrom": "2025-04-01"})
    CA, CB = f"/api/c/{A['id']}", f"/api/c/{B['id']}"
    s, g = req("GET", f"{CA}/groups"); g = {x["name"]: x["id"] for x in g}
    s, seeded = req("GET", f"{CA}/ledgers")
    cash = next(x for x in seeded if x["name"] == "Cash")  # seeded by company creation
    s, debtor = req("POST", f"{CA}/ledgers", {"name": "Debtor", "groupId": g["Sundry Debtors"], "billWise": True})
    s, debtor2 = req("POST", f"{CA}/ledgers", {"name": "Debtor2", "groupId": g["Sundry Debtors"], "billWise": True})
    s, sales = req("POST", f"{CA}/ledgers", {"name": "Sales", "groupId": g["Sales Accounts"]})
    s, cap = req("POST", f"{CA}/ledgers", {"name": "Capital", "groupId": g["Capital Account"]})
    s, vt = req("GET", f"{CA}/voucher-types"); T = {x["name"]: x["id"] for x in vt}

    def voucher(cid_path, vtype, date, entries, **kw):
        return req("POST", f"{cid_path}/vouchers", {"voucherTypeId": T[vtype], "date": date, "entries": entries, **kw})

    # ============ FIX-ATTACK 1: 50-way concurrent auto numbering ============
    print("== FIX-1: 50 concurrent auto-numbered vouchers ==")
    results = []
    def worker(i):
        s2, v2 = voucher(CA, "Journal", "2025-06-01", [
            {"ledgerId": cash["id"], "amount": 1}, {"ledgerId": cap["id"], "amount": -1}])
        results.append((s2, v2.get("number") if isinstance(v2, dict) else v2))
    threads = [threading.Thread(target=worker, args=(i,)) for i in range(50)]
    [t.start() for t in threads]; [t.join() for t in threads]
    oks = [r for r in results if r[0] == 200]
    nums = [r[1] for r in oks]
    check("50 concurrent saves all succeed", len(oks) == 50, results[:5])
    check("50 concurrent numbers all unique", len(set(nums)) == 50, sorted(nums)[:10])
    check("numbers are sequential from 1", sorted(int(n) for n in nums) == list(range(1, 51)), sorted(nums)[:10])

    # ============ FIX-ATTACK 2: concurrent settlement race ============
    print("== FIX-2: concurrent settlement race ==")
    s, inv = voucher(CA, "Sales", "2025-06-02", [
        {"ledgerId": debtor["id"], "amount": 1000, "bills": [{"billType": "new_ref", "billName": "RACE-1", "amount": 1000}]},
        {"ledgerId": sales["id"], "amount": -1000}])
    check("race invoice created", s == 200, (s, inv))
    results = []
    def settler(i):
        s2, v2 = voucher(CA, "Receipt", "2025-06-03", [
            {"ledgerId": cash["id"], "amount": 600},
            {"ledgerId": debtor["id"], "amount": -600, "bills": [{"billType": "against_ref", "billName": "RACE-1", "amount": -600}]}])
        results.append((s2, v2 if isinstance(v2, dict) else {"raw": v2}))
    threads = [threading.Thread(target=settler, args=(i,)) for i in range(2)]
    [t.start() for t in threads]; [t.join() for t in threads]
    codes = sorted(r[0] for r in results)
    check("double-settle race: exactly one wins", codes[0] == 200 and codes[1] in (400, 409), results)
    s, br = req("GET", f"{CA}/reports/receivables?to=2025-06-04")
    drow = next((p for p in br.get("parties", []) if p["ledgerId"] == debtor["id"]), None)
    open_amt = sum(b["amount"] for b in (drow or {}).get("bills", []) if b["billName"] == "RACE-1")
    check("RACE-1 open amount = 400 (not over-settled)", open_amt == 400, (open_amt, drow))

    # ============ FIX-ATTACK 3: edit voucher to re-shape bills ============
    print("== FIX-3: edited bills ==")
    s, inv2 = voucher(CA, "Sales", "2025-06-05", [
        {"ledgerId": debtor["id"], "amount": 500, "bills": [{"billType": "new_ref", "billName": "EDIT-1", "amount": 500}]},
        {"ledgerId": sales["id"], "amount": -500}])
    s, detail = req("GET", f"{CA}/vouchers/{inv2['id']}")
    # edit: reduce invoice to 300 with the same bill name
    body = {"voucherTypeId": T["Sales"], "date": "2025-06-05", "entries": [
        {"ledgerId": debtor["id"], "amount": 300, "bills": [{"billType": "new_ref", "billName": "EDIT-1", "amount": 300}]},
        {"ledgerId": sales["id"], "amount": -300}]}
    s, up = req("PUT", f"{CA}/vouchers/{inv2['id']}", body)
    check("edit invoice 500->300 ok", s == 200, (s, up))
    # settling 500 must now fail (open is 300); settling 300 must succeed
    s, v = voucher(CA, "Receipt", "2025-06-06", [
        {"ledgerId": cash["id"], "amount": 500},
        {"ledgerId": debtor["id"], "amount": -500, "bills": [{"billType": "against_ref", "billName": "EDIT-1", "amount": -500}]}])
    check("settle full 500 after edit rejected (open 300)", s == 400, (s, v))
    s, v = voucher(CA, "Receipt", "2025-06-06", [
        {"ledgerId": cash["id"], "amount": 300},
        {"ledgerId": debtor["id"], "amount": -300, "bills": [{"billType": "against_ref", "billName": "EDIT-1", "amount": -300}]}])
    check("settle 300 after edit accepted", s == 200, (s, v))

    # ============ FIX-ATTACK 4: delete bill creator then recreate name ============
    print("== FIX-4: delete bill creator, recreate bill name ==")
    s, inv3 = voucher(CA, "Sales", "2025-06-07", [
        {"ledgerId": debtor["id"], "amount": 80, "bills": [{"billType": "new_ref", "billName": "DEL-1", "amount": 80}]},
        {"ledgerId": sales["id"], "amount": -80}])
    s, dele = req("DELETE", f"{CA}/vouchers/{inv3['id']}")
    check("unsettled bill creator deletable", s == 200, (s, dele))
    s, inv4 = voucher(CA, "Sales", "2025-06-07", [
        {"ledgerId": debtor["id"], "amount": 80, "bills": [{"billType": "new_ref", "billName": "DEL-1", "amount": 80}]},
        {"ledgerId": sales["id"], "amount": -80}])
    check("same bill name reusable after creator deleted", s == 200, (s, inv4))
    s, v = voucher(CA, "Receipt", "2025-06-08", [
        {"ledgerId": cash["id"], "amount": 80},
        {"ledgerId": debtor["id"], "amount": -80, "bills": [{"billType": "against_ref", "billName": "DEL-1", "amount": -80}]}])
    check("new DEL-1 settles against fresh 80 (no ghost open)", s == 200, (s, v))

    # ============ FIX-ATTACK 5: restart resilience ============
    print("== FIX-5: server restart keeps numbering ==")
    s, nxt = req("GET", f"{CA}/vouchers/next-number?voucherTypeId={T['Journal']}")
    before = nxt["number"]
    SERVER_PROC[0].terminate()
    try: SERVER_PROC[0].wait(timeout=10)
    except Exception: SERVER_PROC[0].kill()
    if not start_server():
        print("server did not restart"); sys.exit(1)
    req("POST", "/api/auth/login", {"username": "admin", "password": "admin123"})
    s, nxt2 = req("GET", f"{CA}/vouchers/next-number?voucherTypeId={T['Journal']}")
    check("next number unchanged after restart", nxt2["number"] == before, (before, nxt2.get("number")))
    s, v = voucher(CA, "Journal", "2025-06-09", [{"ledgerId": cash["id"], "amount": 2}, {"ledgerId": cap["id"], "amount": -2}])
    check("post-restart voucher gets the sequential number", s == 200 and v.get("number") == before, (before, v.get("number")))

    # ============ FIX-ATTACK 6: FY-boundary numbering ============
    print("== FIX-6: FY boundary numbering ==")
    nums_fy = []
    for d2 in ["2026-03-30", "2026-03-31", "2026-04-01", "2026-04-02"]:
        s2, v2 = voucher(CA, "Payment", d2, [{"ledgerId": cash["id"], "amount": -1}, {"ledgerId": cap["id"], "amount": 1}])
        nums_fy.append((s2, v2.get("number") if isinstance(v2, dict) else v2))
    check("FY-crossing vouchers all created", all(s2 == 200 for s2, _ in nums_fy), nums_fy)
    pay_nums = [n2 for s2, n2 in nums_fy]
    check("FY-crossing numbers unique & sequential", len(set(pay_nums)) == 4 and pay_nums == sorted(pay_nums), pay_nums)

    # ============ FIX-ATTACK 7: multi-company concurrent numbering ============
    print("== FIX-7: concurrent numbering across two companies ==")
    s, gb = req("GET", f"{CB}/groups"); gb = {x["name"]: x["id"] for x in gb}
    s, seededB = req("GET", f"{CB}/ledgers")
    cashB = next(x for x in seededB if x["name"] == "Cash")  # seeded
    s, capB = req("POST", f"{CB}/ledgers", {"name": "CapitalB", "groupId": gb["Capital Account"]})
    s, vtb = req("GET", f"{CB}/voucher-types"); TB = {x["name"]: x["id"] for x in vtb}
    res_ab = []
    def ab_worker(i):
        if i % 2 == 0:
            s2, v2 = voucher(CA, "Receipt", "2025-06-10", [{"ledgerId": cash["id"], "amount": 1}, {"ledgerId": debtor["id"], "amount": -1}])
            res_ab.append(("A", s2, (v2 or {}).get("number")))
        else:
            s2, v2 = req("POST", f"{CB}/vouchers", {"voucherTypeId": TB["Receipt"], "date": "2025-06-10", "entries": [
                {"ledgerId": cashB["id"], "amount": 1}, {"ledgerId": capB["id"], "amount": -1}]})
            res_ab.append(("B", s2, (v2 or {}).get("number")))
    threads = [threading.Thread(target=ab_worker, args=(i,)) for i in range(16)]
    [t.start() for t in threads]; [t.join() for t in threads]
    check("16 cross-company concurrent saves all succeed", sum(1 for _, s2, _ in res_ab if s2 == 200) == 16, res_ab)
    b_nums = [n2 for co, s2, n2 in res_ab if co == "B" and s2 == 200]
    check("company B numbering independent, unique & sequential", sorted(int(x) for x in b_nums) == list(range(1, 9)), sorted(b_nums))

    # ============ FIX-ATTACK 8: payroll double-run race ============
    print("== FIX-8: payroll concurrent double-run ==")
    s, emp = req("POST", f"{CA}/employees", {"name": "Emp Race", "isActive": True})
    s, sal_l = req("POST", f"{CA}/ledgers", {"name": "Salaries Race", "groupId": g["Indirect Expenses"]})
    s, salp = req("GET", f"{CA}/ledgers"); salp_id = next(x["id"] for x in salp if x["name"] == "Salary Payable")
    s, ph = req("POST", f"{CA}/pay-heads", {"name": "Basic Race", "type": "earning", "ledgerId": sal_l["id"]})
    s, _ = req("PUT", f"{CA}/salary-structure/{emp['id']}", {"lines": [{"headId": ph["id"], "monthlyAmount": 10000}]})
    pr = []
    def payroll_worker(i):
        pr.append(req("POST", f"{CA}/payroll/process", {"month": "2025-06"}))
    threads = [threading.Thread(target=payroll_worker, args=(i,)) for i in range(2)]
    [t.start() for t in threads]; [t.join() for t in threads]
    codes = sorted(r[0] for r in pr)
    check("payroll race: one 200, one 4xx (no double salary)", codes[0] == 200 and codes[1] in (400, 409), pr)
    s, sl = req("GET", f"{CA}/reports/salary-register")
    n_rows = sum(len(r.get("rows", r) if isinstance(r, dict) else [r]) for r in (sl if isinstance(sl, list) else [])) if isinstance(sl, list) else -1
    s, tb2 = req("GET", f"{CA}/reports/trial-balance?from=2025-04-01&to=2025-06-30")
    check("TB still balanced after payroll race", tb2["totalDebit"] == tb2["totalCredit"], (tb2["totalDebit"], tb2["totalCredit"]))

    # ============ FIX-ATTACK 9: XML import numbering sync ============
    print("== FIX-9: XML import numbering sync ==")
    xml = """<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>
<TALLYMESSAGE><VOUCHER VCHTYPE="Receipt" ACTION="Create"><DATE>20250701</DATE><VOUCHERNUMBER>X-1</VOUCHERNUMBER>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><AMOUNT>50.00</AMOUNT><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE></ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>Capital</LEDGERNAME><AMOUNT>-50.00</AMOUNT><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE></ALLLEDGERENTRIES.LIST></VOUCHER></TALLYMESSAGE>
<TALLYMESSAGE><VOUCHER VCHTYPE="Receipt" ACTION="Create"><DATE>20250702</DATE><VOUCHERNUMBER>X-1</VOUCHERNUMBER>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><AMOUNT>25.00</AMOUNT><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE></ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>Capital</LEDGERNAME><AMOUNT>-25.00</AMOUNT><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE></ALLLEDGERENTRIES.LIST></VOUCHER></TALLYMESSAGE>
</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>"""
    s, imp = req("POST", f"{CA}/import/xml", xml, headers={"Content-Type": "application/xml"})  # exercises the XML content-type parser
    check("import processed", s == 200 and imp.get("vouchers") == 1, (s, imp))
    check("duplicate number within file skipped", imp.get("skipped", 0) >= 1, imp)
    s, v = voucher(CA, "Receipt", "2025-07-03", [{"ledgerId": cash["id"], "amount": 5}, {"ledgerId": debtor["id"], "amount": -5}])
    check("auto number after import skips imported numbers", s == 200 and v.get("number") != "X-1", (s, v.get("number")))

    # ============ FIX-ATTACK 10: date fields on nested objects ============
    print("== FIX-10: nested date fields ==")
    s, v = req("POST", f"{CA}/vouchers", {"voucherTypeId": T["Receipt"], "date": "2025-06-11", "entries": [
        {"ledgerId": cash["id"], "amount": 10},
        {"ledgerId": debtor["id"], "amount": -10, "bills": [{"billType": "new_ref", "billName": "D-1", "amount": -10, "dueDate": "2025-02-30"}]}]})
    check("invalid bill dueDate rejected", s == 400, (s, v))
    s, v = req("POST", f"{CA}/vouchers", {"voucherTypeId": T["Payment"], "date": "2025-06-11", "chequeDate": "2025-13-01",
        "entries": [{"ledgerId": cash["id"], "amount": -10}, {"ledgerId": cap["id"], "amount": 10}]})
    check("invalid chequeDate rejected", s == 400, (s, v))
    s, v = req("POST", f"{CA}/vouchers", {"voucherTypeId": T["Payment"], "date": "2025-06-11", "refDate": "not-a-date",
        "entries": [{"ledgerId": cash["id"], "amount": -10}, {"ledgerId": cap["id"], "amount": 10}]})
    check("invalid refDate rejected", s == 400, (s, v))

    # ============ FIX-ATTACK 11: bulk voucher (200 entries) ============
    print("== FIX-11: bulk voucher ==")
    entries = [{"ledgerId": cash["id"], "amount": 1.01} for _ in range(100)]
    entries += [{"ledgerId": cap["id"], "amount": -1.01} for _ in range(99)]
    entries.append({"ledgerId": cap["id"], "amount": -1.01})  # 100 x 1.01 = 99 x 1.01 + 1.01 -> balanced
    s, v = req("POST", f"{CA}/vouchers", {"voucherTypeId": T["Journal"], "date": "2025-06-12", "entries": entries})
    check("200-entry voucher accepted & balanced", s == 200, (s, v if s != 200 else "ok"))

    # ============ FINAL: TB integrity after everything ============
    s, tb3 = req("GET", f"{CA}/reports/trial-balance?from=2025-04-01&to=2026-04-30")
    check("FINAL TB balanced after all fix-attacks", tb3["totalDebit"] == tb3["totalCredit"], (tb3["totalDebit"], tb3["totalCredit"]))
    s, bs3 = req("GET", f"{CA}/reports/balance-sheet?to=2026-04-30")
    check("FINAL BS balanced after all fix-attacks", abs(bs3.get("difference", 0)) < 0.005, bs3.get("difference"))

    print(f"\n== FIX-ATTACK RESULTS: {PASS} passed, {FAIL} failed ==")
    sys.exit(1 if FAIL else 0)
finally:
    if SERVER_PROC[0]:
        SERVER_PROC[0].terminate()
        try: SERVER_PROC[0].wait(timeout=5)
        except Exception: SERVER_PROC[0].kill()
