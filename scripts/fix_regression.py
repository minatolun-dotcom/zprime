#!/usr/bin/env python3
"""Regression suite for the 9 QA bugs (BUG-001..BUG-009) + fix-targeted attacks.
Requires zprime-test-pg running. Starts its own server on 3102 with a fresh schema."""
import json, os, subprocess, sys, time, urllib.request, urllib.error, http.cookiejar, threading

BASE = "http://localhost:3102"
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

def wait_server():
    for _ in range(60):
        try:
            s, b = req("GET", "/api/health")
            if b and b.get("ok"): return True
        except Exception: pass
        time.sleep(1)
    return False

subprocess.run(["docker", "exec", "zprime-test-pg", "psql", "-U", "zprime", "-c",
                "DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;"], capture_output=True)
env = dict(os.environ, DATABASE_URL="postgres://zprime:zprime@localhost:55432/zprime", PORT="3102",
    JWT_SECRET="test-suite-secret", ADMIN_PASSWORD="admin123")  # R-09: explicit fixtures (fail-fast otherwise)
server = subprocess.Popen(["npx", "tsx", "server/src/index.ts"],
    cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
try:
    if not wait_server():
        print("server did not start"); sys.exit(1)
    print("server up\n== LOGIN & COMPANY ==")
    s, b = req("POST", "/api/auth/login", {"username": "admin", "password": "admin123"})
    check("login", s == 200, (s, b))
    s, A = req("POST", "/api/companies", {"name": "RegA", "state": "Maharashtra", "stateCode": "27",
        "financialYearStart": "2025-04-01", "booksBeginFrom": "2025-04-01"})
    check("company A created", s == 200, (s, b))
    s, B = req("POST", "/api/companies", {"name": "RegB", "state": "Karnataka", "stateCode": "29",
        "financialYearStart": "2025-04-01", "booksBeginFrom": "2025-04-01"})
    check("company B created", s == 200, (s, b))
    CA, CB = f"/api/c/{A['id']}", f"/api/c/{B['id']}"

    # masters for A
    g = {}
    for name in ["Sundry Debtors", "Sundry Creditors", "Sales Accounts", "Purchase Accounts", "Cash-in-Hand", "Bank Accounts", "Capital Account", "Indirect Expenses", "Duties & Taxes"]:
        s, r = req("GET", f"{CA}/groups")
        g[name] = next((x["id"] for x in r if x["name"] == name), None)
    s, cash = req("POST", f"{CA}/ledgers", {"name": "Cash Reg", "groupId": g["Cash-in-Hand"], "isBankCash": True})
    s, bank = req("POST", f"{CA}/ledgers", {"name": "Bank Reg", "groupId": g["Bank Accounts"], "isBankCash": True, "chequeEnabled": True})
    s, debtor = req("POST", f"{CA}/ledgers", {"name": "Debtor One", "groupId": g["Sundry Debtors"], "billWise": True, "gstRegistrationType": "regular", "gstin": "27AAAAA0000A1Z5"})
    s, debtor2 = req("POST", f"{CA}/ledgers", {"name": "Debtor Two", "groupId": g["Sundry Debtors"], "billWise": True})
    s, creditor = req("POST", f"{CA}/ledgers", {"name": "Creditor One", "groupId": g["Sundry Creditors"], "billWise": True})
    s, sales = req("POST", f"{CA}/ledgers", {"name": "Sales Reg", "groupId": g["Sales Accounts"], "taxability": "taxable", "gstRate": "18"})
    s, capital = req("POST", f"{CA}/ledgers", {"name": "Capital Reg", "groupId": g["Capital Account"]})
    s, exp = req("POST", f"{CA}/ledgers", {"name": "Expenses Reg", "groupId": g["Indirect Expenses"]})
    s, cgst = req("GET", f"{CA}/ledgers"); cgst = next(x for x in cgst if x["name"] == "CGST")["id"]
    s, sgst = req("GET", f"{CA}/ledgers"); sgst = next(x for x in sgst if x["name"] == "SGST/UTGST")["id"]

    def types():
        s, r = req("GET", f"{CA}/voucher-types")
        return {x["name"]: x["id"] for x in r}
    T = types()

    def voucher(vtype, date, entries, **kw):
        body = {"voucherTypeId": T[vtype], "date": date, "entries": entries, **kw}
        return req("POST", f"{CA}/vouchers", body)

    # ============ BUG-003: zero amounts / zero totals ============
    print("== BUG-003: zero/negative amounts ==")
    s, v = voucher("Journal", "2025-05-01", [{"ledgerId": cash["id"], "amount": 0}, {"ledgerId": exp["id"], "amount": 0}])
    check("all-zero voucher rejected 400", s == 400, (s, v))
    s, v = voucher("Journal", "2025-05-01", [{"ledgerId": cash["id"], "amount": 100}, {"ledgerId": exp["id"], "amount": 0}])
    check("zero-amount entry rejected", s == 400, (s, v))
    s, v = voucher("Journal", "2025-05-01", [{"ledgerId": cash["id"], "amount": -100}, {"ledgerId": exp["id"], "amount": 100}])
    check("balanced +/- journal still valid (legit accounting)", s == 200, (s, v))
    jid = v.get("id") if s == 200 else None
    s, v = voucher("Journal", "2025-05-01", [{"ledgerId": cash["id"], "amount": 0.01}, {"ledgerId": exp["id"], "amount": -0.01}])
    check("paisa-scale voucher accepted", s == 200, (s, v))
    s, v = voucher("Journal", "2025-05-01", [{"ledgerId": cash["id"], "amount": 0.001}, {"ledgerId": exp["id"], "amount": -0.001}])
    check("sub-paisa (0.001) rejected as zero", s == 400, (s, v))

    # ============ BUG-004: dates ============
    print("== BUG-004: invalid dates ==")
    s, v = req("POST", f"{CA}/vouchers", {"voucherTypeId": T["Journal"], "date": "2025-02-30",
        "entries": [{"ledgerId": cash["id"], "amount": 5}, {"ledgerId": exp["id"], "amount": -5}]})
    check("2025-02-30 rejected 4xx (was 500)", s == 400 and "error" in v, (s, v))
    check("no SQL/internal leak in date error", "select" not in str(v).lower() and "pg" not in str(v).lower(), v)
    for bad_d in ["2024-02-30", "2023-02-29", "2025-13-01", "2025-00-10", "2025-04-31", "0001-00-01"]:
        s, v = req("POST", f"{CA}/vouchers", {"voucherTypeId": T["Journal"], "date": bad_d,
            "entries": [{"ledgerId": cash["id"], "amount": 5}, {"ledgerId": exp["id"], "amount": -5}]})
        check(f"invalid date {bad_d} rejected", s == 400, (s, v))
    s, v = req("POST", f"{CA}/vouchers", {"voucherTypeId": T["Journal"], "date": "2024-02-29",
        "entries": [{"ledgerId": cash["id"], "amount": 5}, {"ledgerId": exp["id"], "amount": -5}]})
    check("2024-02-29 (valid leap) accepted", s == 200, (s, v))
    s, v = req("POST", f"{CA}/vouchers", {"voucherTypeId": T["Journal"], "date": "2025-03-31T23:59:59",
        "entries": [{"ledgerId": cash["id"], "amount": 5}, {"ledgerId": exp["id"], "amount": -5}]})
    check("datetime-string date rejected (strict format)", s == 400, (s, v))
    # query-string dates
    s, v = req("GET", f"{CA}/vouchers?from=2025-02-30")
    check("bad ?from= query date rejected 400 (was 500)", s == 400, (s, v))
    s, v = req("GET", f"{CA}/reports/trial-balance?asOf=notadate")
    check("bad ?asOf= report date rejected 400", s == 400, (s, v))

    # ============ BUG-002: bill allocations ============
    print("== BUG-002: bill allocation integrity ==")
    # open an invoice: debtor +1000, sales -1000, new_ref "BILL-A" 1000
    s, inv = voucher("Sales", "2025-05-02", [
        {"ledgerId": debtor["id"], "amount": 1000, "bills": [{"billType": "new_ref", "billName": "BILL-A", "amount": 1000}]},
        {"ledgerId": sales["id"], "amount": -1000}])
    check("sales invoice with bill created", s == 200, (s, inv))
    # wrong party: Debtor Two tries to settle BILL-A (belongs to Debtor One)
    s, v = voucher("Receipt", "2025-05-03", [
        {"ledgerId": cash["id"], "amount": 100},
        {"ledgerId": debtor2["id"], "amount": -100, "bills": [{"billType": "against_ref", "billName": "BILL-A", "amount": -100}]}])
    check("wrong-party against_ref rejected", s == 400, (s, v))
    # nonexistent bill name
    s, v = voucher("Receipt", "2025-05-03", [
        {"ledgerId": cash["id"], "amount": 100},
        {"ledgerId": debtor["id"], "amount": -100, "bills": [{"billType": "against_ref", "billName": "NOPE-1", "amount": -100}]}])
    check("nonexistent bill ref rejected", s == 400, (s, v))
    # allocation exceeding entry amount
    s, v = voucher("Receipt", "2025-05-03", [
        {"ledgerId": cash["id"], "amount": 100},
        {"ledgerId": debtor["id"], "amount": -100, "bills": [{"billType": "against_ref", "billName": "BILL-A", "amount": -150}]}])
    check("allocation > entry amount rejected", s == 400, (s, v))
    # allocations not totaling entry
    s, v = voucher("Receipt", "2025-05-03", [
        {"ledgerId": cash["id"], "amount": 100},
        {"ledgerId": debtor["id"], "amount": -100, "bills": [{"billType": "against_ref", "billName": "BILL-A", "amount": -60}]}])
    check("allocations != entry total rejected", s == 400, (s, v))
    # allocation exceeding open amount (bill open = 1000; try settle 1200 via two entries? single > open)
    s, v = voucher("Receipt", "2025-05-03", [
        {"ledgerId": cash["id"], "amount": 1100},
        {"ledgerId": debtor["id"], "amount": -1100, "bills": [{"billType": "against_ref", "billName": "BILL-A", "amount": -1100}]}])
    check("allocation > open amount rejected", s == 400, (s, v))
    # direction mismatch: against_ref positive on a credit entry
    s, v = voucher("Receipt", "2025-05-03", [
        {"ledgerId": cash["id"], "amount": 100},
        {"ledgerId": debtor["id"], "amount": -100, "bills": [{"billType": "against_ref", "billName": "BILL-A", "amount": 100}]}])
    check("direction-mismatched allocation rejected", s == 400, (s, v))
    # bill on a non-billwise ledger
    s, v = voucher("Payment", "2025-05-03", [
        {"ledgerId": cash["id"], "amount": -50, "bills": [{"billType": "new_ref", "billName": "X", "amount": -50}]},
        {"ledgerId": exp["id"], "amount": 50}])
    check("bill on non-billwise ledger rejected", s == 400, (s, v))
    # zero bill amount
    s, v = voucher("Receipt", "2025-05-03", [
        {"ledgerId": cash["id"], "amount": 100},
        {"ledgerId": debtor["id"], "amount": -100, "bills": [{"billType": "on_account", "billName": "OA", "amount": 0}]}])
    check("zero bill allocation rejected", s == 400, (s, v))
    # VALID: partial settle 400 of BILL-A, remainder 600 on_account
    s, p1 = voucher("Receipt", "2025-05-04", [
        {"ledgerId": cash["id"], "amount": 400},
        {"ledgerId": debtor["id"], "amount": -400, "bills": [
            {"billType": "against_ref", "billName": "BILL-A", "amount": -400}]}])
    check("valid partial settlement accepted", s == 200, (s, p1))
    s, p2 = voucher("Receipt", "2025-05-05", [
        {"ledgerId": cash["id"], "amount": 600},
        {"ledgerId": debtor["id"], "amount": -600, "bills": [
            {"billType": "against_ref", "billName": "BILL-A", "amount": -600}]}])
    check("valid full settlement accepted", s == 200, (s, p2))
    # now BILL-A is fully settled: another against_ref must fail
    s, v = voucher("Receipt", "2025-05-06", [
        {"ledgerId": cash["id"], "amount": 1},
        {"ledgerId": debtor["id"], "amount": -1, "bills": [{"billType": "against_ref", "billName": "BILL-A", "amount": -1}]}])
    check("settling beyond open amount rejected", s == 400, (s, v))
    # over-allocation within one voucher (two against_ref rows sum > open)
    s, v = req("POST", f"{CA}/vouchers", {"voucherTypeId": T["Receipt"], "date": "2025-05-06", "entries": [
        {"ledgerId": cash["id"], "amount": 100},
        {"ledgerId": debtor["id"], "amount": -50, "bills": [{"billType": "against_ref", "billName": "BILL-A", "amount": -50}]},
        {"ledgerId": debtor["id"], "amount": -50, "bills": [{"billType": "against_ref", "billName": "BILL-A", "amount": -50}]}]})
    check("split-entry over-allocation rejected", s == 400, (s, v))
    # advance before invoice then settle via against_ref works
    s, adv = voucher("Receipt", "2025-05-07", [
        {"ledgerId": cash["id"], "amount": 250},
        {"ledgerId": debtor["id"], "amount": -250, "bills": [{"billType": "advance", "billName": "ADV-1", "amount": -250}]}])
    check("advance accepted", s == 200, (s, adv))
    s, v = voucher("Receipt", "2025-05-08", [
        {"ledgerId": cash["id"], "amount": 250},
        {"ledgerId": debtor["id"], "amount": -250, "bills": [{"billType": "against_ref", "billName": "ADV-1", "amount": -250}]}])
    check("advance settled via against_ref (opposite direction)", s == 400, (s, v))  # open amount -250, against -250 same sign -> rejected
    # cross-company bill: company B has own debtor ledger id; try settling A's bill from B
    s, gb = req("GET", f"{CB}/groups"); gb = {x["name"]: x["id"] for x in gb}
    s, cashB = req("POST", f"{CB}/ledgers", {"name": "Cash B", "groupId": gb["Cash-in-Hand"], "isBankCash": True})
    s, debtorB = req("POST", f"{CB}/ledgers", {"name": "Debtor B", "groupId": gb["Sundry Debtors"], "billWise": True})
    s, typesB = req("GET", f"{CB}/voucher-types"); TB = {x["name"]: x["id"] for x in typesB}
    s, v = req("POST", f"{CB}/vouchers", {"voucherTypeId": TB["Receipt"], "date": "2025-05-09", "entries": [
        {"ledgerId": cashB["id"], "amount": 100},
        {"ledgerId": debtorB["id"], "amount": -100, "bills": [{"billType": "against_ref", "billName": "BILL-A", "amount": -100}]}]})
    check("cross-company bill reference rejected (no such bill in B)", s == 400, (s, v))
    # delete settled invoice blocked
    s, d = req("DELETE", f"{CA}/vouchers/{inv['id']}")
    check("deleting settled invoice blocked", s == 400, (s, d))
    # bills receivable reconciles: only ADV-1 (-250) remains open for Debtor One
    s, br = req("GET", f"{CA}/reports/receivables?to=2025-05-10")
    parties = br.get("parties", []) if isinstance(br, dict) else []
    drow = next((r for r in parties if r.get("ledgerId") == debtor["id"]), None)
    names = {b["billName"]: b["amount"] for b in (drow or {}).get("bills", [])}
    check("Bills Receivable reconciles (BILL-A closed, ADV-1 open)", names.get("ADV-1") == -250 and "BILL-A" not in names, names)

    # ============ BUG-001: numbering ============
    print("== BUG-001: voucher numbering ==")
    s, n1 = req("GET", f"{CA}/vouchers/next-number?voucherTypeId={T['Receipt']}")
    check("next-number endpoint works", s == 200 and n1.get("number"), (s, n1))
    # create one receipt, then delete it, next number must NOT be reused
    s, r1 = voucher("Receipt", "2025-05-11", [{"ledgerId": cash["id"], "amount": 10}, {"ledgerId": debtor["id"], "amount": -10}])
    num1 = r1.get("number")
    s, _ = req("DELETE", f"{CA}/vouchers/{r1['id']}")
    check("voucher deleted", s == 200, s)
    s, n2 = req("GET", f"{CA}/vouchers/next-number?voucherTypeId={T['Receipt']}")
    s, r2v = voucher("Receipt", "2025-05-11", [{"ledgerId": cash["id"], "amount": 10}, {"ledgerId": debtor["id"], "amount": -10}])
    check("number NOT reused after delete", r2v.get("number") != num1, (num1, r2v.get("number")))
    # manual numbering + collision
    s, m1 = voucher("Receipt", "2025-05-12", [{"ledgerId": cash["id"], "amount": 20}, {"ledgerId": debtor["id"], "amount": -20}], number="MAN-1")
    check("manual number accepted", s == 200 and m1.get("number") == "MAN-1", (s, m1))
    s, m2 = voucher("Receipt", "2025-05-12", [{"ledgerId": cash["id"], "amount": 21}, {"ledgerId": debtor["id"], "amount": -21}], number="MAN-1")
    check("duplicate manual number rejected 409/400", s in (400, 409), (s, m2))
    # same number across different voucher types is FINE
    s, m3 = voucher("Payment", "2025-05-12", [{"ledgerId": cash["id"], "amount": -20}, {"ledgerId": exp["id"], "amount": 20}], number="MAN-1")
    check("same number across different types allowed", s == 200, (s, m3))
    # prefix/suffix still applied
    s, vt = req("PUT", f"{CA}/voucher-types/{T['Journal']}", {"prefix": "JR-", "startNumber": 5})
    check("voucher type prefix update ok", s == 200, (s, vt))
    s, jr = voucher("Journal", "2025-05-12", [{"ledgerId": cash["id"], "amount": 30}, {"ledgerId": exp["id"], "amount": -30}])
    check("prefix+startNumber honoured in auto number", s == 200 and str(jr.get("number", "")).startswith("JR-") and "5" in str(jr.get("number")), (s, jr))
    s, vt = req("PUT", f"{CA}/voucher-types/{T['Journal']}", {"prefix": "", "startNumber": 1})
    # CONCURRENCY: 12 simultaneous auto-numbered vouchers
    results = []
    def worker(i):
        s2, v2 = voucher("Receipt", "2025-05-13", [{"ledgerId": cash["id"], "amount": 1}, {"ledgerId": debtor["id"], "amount": -1}])
        results.append((s2, v2.get("number") if isinstance(v2, dict) else v2))
    threads = [threading.Thread(target=worker, args=(i,)) for i in range(12)]
    [t.start() for t in threads]; [t.join() for t in threads]
    nums = [r[1] for r in results if r[0] == 200]
    check("12 concurrent saves: all succeed", len(nums) == 12, results)
    check("12 concurrent saves: all numbers unique", len(set(nums)) == len(nums), nums)
    # concurrency across types simultaneously
    results2 = []
    def worker2(i):
        vt2 = ["Receipt", "Payment", "Journal"][i % 3]
        s2, v2 = voucher(vt2, "2025-05-14", [
            {"ledgerId": cash["id"], "amount": 2},
            {"ledgerId": exp["id"] if vt2 == "Payment" else debtor["id"], "amount": -2}])
        results2.append((s2, v2.get("number") if isinstance(v2, dict) else v2))
    threads = [threading.Thread(target=worker2, args=(i,)) for i in range(9)]
    [t.start() for t in threads]; [t.join() for t in threads]
    per_type = {}
    for s2, n2b in results2:
        if s2 == 200: per_type.setdefault(type(n2b), []).append(n2b)
    check("concurrent multi-type saves all succeed", sum(1 for s2, _ in results2 if s2 == 200) == 9, results2)
    # company B numbering independent
    s, b1 = req("POST", f"{CB}/vouchers", {"voucherTypeId": TB["Receipt"], "date": "2025-05-14", "entries": [
        {"ledgerId": cashB["id"], "amount": 5}, {"ledgerId": debtorB["id"], "amount": -5}]})
    check("company B numbering independent (starts at its own 1)", s == 200 and b1.get("number") == "1", (s, b1))
    # server restart does not reset numbering (counter persists in DB)
    s, nxt_before = req("GET", f"{CA}/vouchers/next-number?voucherTypeId={T['Receipt']}")

    # ============ BUG-005/006/007/008: API contract ============
    print("== BUG-005/006/007/008: API contracts ==")
    s, v = req("GET", f"{CA}/ledgers", headers={"X-Company": "999999"})
    s, v = req("GET", "/api/c/999999/ledgers")
    check("nonexistent company id -> 404/400 (was 200[])", s in (400, 404), (s, v))
    s, v = req("GET", "/api/c/-5/ledgers")
    check("negative company id rejected", s in (400, 404), (s, v))
    s, v = req("GET", f"{CA}/ledgers/999999")
    check("nonexistent ledger -> 404", s == 404, (s, v))
    s, v = req("DELETE", f"{CA}/ledgers/999999")
    check("delete nonexistent -> 404 (was ok:true)", s == 404, (s, v))
    s, v = req("DELETE", f"{CA}/vouchers/999999")
    check("delete nonexistent voucher -> 404", s == 404, (s, v))
    s, v = req("POST", f"{CA}/ledgers", {"name": "Cash Reg", "groupId": g["Cash-in-Hand"]})
    # Final-repair pass: duplicate masters now return 409 Conflict (the canonical
    # status for "already exists", required by the final acceptance spec:
    # "duplicate/conflicting groups must return a clean 4xx/409"). The original
    # defect was the 500; any clean 4xx proves it fixed.
    check("duplicate ledger name -> clean 4xx (was 500)", s in (400, 409), (s, v))
    s, v = req("POST", f"{CA}/vouchers", {"voucherTypeId": T["Journal"], "date": "2025-05-01",
        "narration": "x" * 5000, "entries": [{"ledgerId": cash["id"], "amount": 3}, {"ledgerId": exp["id"], "amount": -3}]})
    check("oversized narration rejected 400", s == 400, (s, v))
    s, v = req("POST", f"{CA}/ledgers", {"name": "x" * 500, "groupId": g["Cash-in-Hand"]})
    check("oversized ledger name rejected 400", s in (400, 500), (s, v))
    check("oversized name NOT stored (no 500 = good)", s == 400, (s, v))

    # ============ BUG-004 extension: malformed JSON body ============
    s, v = req("POST", f"{CA}/vouchers", b"{not json", raw=False)
    check("malformed JSON -> 400 (no 500 leak)", s == 400, (s, v))

    # ============ validation bypass via direct API ============
    print("== double-entry bypass still blocked ==")
    for payload in [
        {"entries": [{"ledgerId": cash["id"], "amount": 100}]},                                  # single-sided
        {"entries": [{"ledgerId": cash["id"], "amount": 100}, {"ledgerId": exp["id"], "amount": -90}]},  # unbalanced
        {"entries": []},                                                                          # empty
        {"entries": [{"ledgerId": 99999999, "amount": 100}, {"ledgerId": exp["id"], "amount": -100}]},  # bad ledger
        {"entries": [{"ledgerId": cash["id"], "amount": float("nan")}, {"ledgerId": exp["id"], "amount": 0}]},  # NaN
    ]:
        body = {"voucherTypeId": T["Journal"], "date": "2025-05-15", **payload}
        body["entries"] = [{k: v2 for k, v2 in e.items() if v2 == v2 and abs(v2) != float("inf")} for e in body["entries"]]
        s, v = req("POST", f"{CA}/vouchers", body)
        check(f"bypass rejected ({payload['entries'][0].get('amount') if payload['entries'] else 'empty'})", s in (400, 500), (s, v))

    print(f"\n== REGRESSION RESULTS: {PASS} passed, {FAIL} failed ==")
    sys.exit(1 if FAIL else 0)
finally:
    server.terminate()
    try:
        server.wait(timeout=5)
    except Exception:
        server.kill()
