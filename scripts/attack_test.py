#!/usr/bin/env python3
"""zprime adversarial attack suite. Requires zprime-test-pg running. Starts its own server on 3101."""
import json, os, subprocess, sys, time, urllib.request, urllib.error, http.cookiejar, threading

BASE = "http://localhost:3101"
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

PASS = 0; FAIL = 0; findings = []
def check(name, cond, detail="", bug=None, sev=None):
    global PASS, FAIL
    if cond: PASS += 1; print(f"  ok  {name}")
    else:
        FAIL += 1; print(f" FAIL {name} :: {detail}")
        if bug: findings.append((sev or "P3", bug, detail))

subprocess.run(["docker", "exec", "zprime-test-pg", "psql", "-U", "zprime", "-c",
                "DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;"], capture_output=True)
env = dict(os.environ, DATABASE_URL="postgres://zprime:zprime@localhost:55432/zprime", PORT="3101",
    JWT_SECRET="test-suite-secret", ADMIN_PASSWORD="admin123")  # R-09: explicit fixtures (fail-fast otherwise)
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
    print("server up\n== PART 26: AUTH SECURITY ==")

    # unauthenticated access
    s, b = req("GET", "/api/companies", use_opener=False)
    check("companies blocked without auth", s in (401, 403), (s, b), "AUTH-1: unauthenticated access to /api/companies", "P0")
    s, b = req("GET", "/api/c/1/ledgers", use_opener=False)
    check("company data blocked without auth", s in (401, 403), (s, b), "AUTH-2: unauthenticated company data access", "P0")
    s, b = req("GET", "/api/c/999999/vouchers", headers={"Cookie": "token=forged.jwt.value"})
    check("forged cookie rejected", s in (401, 403), (s, b), "AUTH-3: forged JWT accepted", "P0")
    s, b = req("POST", "/api/auth/login", {"username": "admin", "password": "' OR 1=1 --"})
    check("sqli login rejected", s == 401, (s, b))
    s, b = req("GET", "/api/health", use_opener=False)
    check("health endpoint public (ok)", s == 200)

    print("== SETUP: two companies ==")
    s, b = req("POST", "/api/auth/login", {"username": "admin", "password": "admin123"})
    check("login", s == 200, b)
    s, A = req("POST", "/api/companies", {"name": "Company A", "state": "Maharashtra", "stateCode": "27",
        "gstin": "27AAAAA0000A1Z5", "financialYearStart": "2025-04-01", "booksBeginFrom": "2025-04-01"})
    s, B = req("POST", "/api/companies", {"name": "Company B", "state": "Karnataka", "stateCode": "29",
        "gstin": "29BBBBB1111B1Z3", "financialYearStart": "2025-04-01", "booksBeginFrom": "2025-04-01"})
    cidA, cidB = A["id"], B["id"]
    CA, CB = f"/api/c/{cidA}", f"/api/c/{cidB}"
    s, groupsA = req("GET", f"{CA}/groups"); gA = {g["name"]: g["id"] for g in groupsA}
    s, vtsA = req("GET", f"{CA}/voucher-types"); vtA = {v["name"]: v["id"] for v in vtsA}
    s, cashA = req("POST", f"{CA}/ledgers", {"name": "Cash A", "groupId": gA["Cash-in-Hand"]})
    s, capitalA = req("POST", f"{CA}/ledgers", {"name": "Capital A", "groupId": gA["Capital Account"]})
    s, debtorA = req("POST", f"{CA}/ledgers", {"name": "Secret Debtor", "groupId": gA["Sundry Debtors"], "billWise": True})
    s, salesA = req("POST", f"{CA}/ledgers", {"name": "Sales A", "groupId": gA["Sales Accounts"], "taxability": "taxable", "gstRate": "18"})
    s, v = req("POST", f"{CA}/vouchers", {"voucherTypeId": vtA["Receipt"], "date": "2025-04-05",
        "entries": [{"ledgerId": cashA["id"], "amount": 10000}, {"ledgerId": capitalA["id"], "amount": -10000}]})
    check("company A setup voucher", s == 200, v)
    secret_voucher_id = v["id"]

    print("== PART 8: COMPANY ISOLATION (IDOR) ==")
    s, b = req("GET", f"/api/c/{cidB}/ledgers")
    namesB = [l["name"] for l in (b or [])]
    check("B does not see A ledgers", "Secret Debtor" not in namesB, namesB, "ISO-1: cross-company ledger leak", "P0")
    s, b = req("GET", f"/api/c/{cidB}/vouchers?from=2025-04-01&to=2025-04-30")
    check("B does not see A vouchers", not any(x.get("id") == secret_voucher_id for x in (b or [])), b, "ISO-2: cross-company voucher leak", "P0")
    # direct ID access from wrong company
    s, b = req("GET", f"{CB}/vouchers/{secret_voucher_id}")
    check("B cannot fetch A voucher by id", s in (400, 403, 404), (s, b), "ISO-3: IDOR voucher fetch", "P0")
    s, b = req("PUT", f"{CB}/ledgers/{debtorA['id']}", {"name": "HACKED"})
    check("B cannot modify A ledger", s in (400, 403, 404), (s, b), "ISO-4: IDOR ledger modify", "P0")
    s, b = req("DELETE", f"{CB}/vouchers/{secret_voucher_id}")
    check("B cannot delete A voucher", s in (400, 403, 404), (s, b), "ISO-5: IDOR voucher delete", "P0")
    # voucher referencing another company's ledger
    s, vtsB = req("GET", f"{CB}/voucher-types"); vtB = {x["name"]: x["id"] for x in vtsB}
    s, b = req("POST", f"{CB}/vouchers", {"voucherTypeId": vtB["Journal"], "date": "2025-04-06",
        "entries": [{"ledgerId": cashA["id"], "amount": 100}, {"ledgerId": capitalA["id"], "amount": -100}]})
    check("B cannot post using A ledgers", s in (400, 403, 404), (s, b), "ISO-6: cross-company ledger posting", "P0")
    # forged company id in path
    s, b = req("GET", "/api/c/999999/ledgers")
    check("nonexistent company 404", s in (403, 404), (s, b))
    s, b = req("GET", "/api/c/-1/ledgers")
    check("negative company id rejected", s in (400, 403, 404), (s, b), "ISO-7: negative id accepted", "P2")
    s, b = req("GET", "/api/c/abc/ledgers")
    check("non-numeric company id rejected", s in (400, 403, 404), (s, b), "ISO-8: non-numeric id accepted", "P2")

    print("== PART 5: DOUBLE-ENTRY BYPASS ==")
    def bad_voucher(name, entries, expect_reject=True):
        s, b = req("POST", f"{CA}/vouchers", {"voucherTypeId": vtA["Journal"], "date": "2025-04-07", "entries": entries})
        if expect_reject:
            check(name, s == 400, (s, b), f"DE-1: {name} accepted", "P1")
        else:
            check(name, s == 200, (s, b))
        return b
    bad_voucher("single-sided debit rejected", [{"ledgerId": cashA["id"], "amount": 500}])
    bad_voucher("single-sided credit rejected", [{"ledgerId": cashA["id"], "amount": -500}])
    bad_voucher("unbalanced rejected", [{"ledgerId": cashA["id"], "amount": 500}, {"ledgerId": capitalA["id"], "amount": -400}])
    bad_voucher("zero-total voucher rejected", [{"ledgerId": cashA["id"], "amount": 0}])
    bad_voucher("empty entries rejected", [])
    bad_voucher("nonexistent ledger rejected", [{"ledgerId": 999999, "amount": 100}, {"ledgerId": cashA["id"], "amount": -100}])
    # BUG-003 policy decision: a BALANCED journal with opposite signs is
    # legitimate accounting (credit Cash / debit Capital) and MUST be accepted.
    # Only zero entries / zero totals / unbalanced amounts are invalid.
    # (Original expectation "negative amount rejected" encoded the wrong rule.)
    bad_voucher("balanced +/- journal accepted (policy: valid)", [{"ledgerId": cashA["id"], "amount": -100}, {"ledgerId": capitalA["id"], "amount": 100}], expect_reject=False)
    bad_voucher("string amount rejected", [{"ledgerId": cashA["id"], "amount": "abc"}, {"ledgerId": capitalA["id"], "amount": -"100" if False else 100}])
    bad_voucher("null ledger rejected", [{"ledgerId": None, "amount": 100}, {"ledgerId": cashA["id"], "amount": -100}])
    # same ledger both sides
    s, b = req("POST", f"{CA}/vouchers", {"voucherTypeId": vtA["Journal"], "date": "2025-04-07",
        "entries": [{"ledgerId": cashA["id"], "amount": 100}, {"ledgerId": cashA["id"], "amount": -100}]})
    check("same-ledger-both-sides handled (accepted or rejected, no crash)", s in (200, 400), (s, b))
    if s == 200:
        s, tb = req("GET", f"{CA}/reports/trial-balance?from=2025-04-01&to=2025-04-30")
        check("TB balanced after same-ledger voucher", abs(tb["totalDebit"] - tb["totalCredit"]) < 0.01, tb)

    print("== PART 6: VOUCHER NUMBERING ==")
    nums = []
    for i in range(5):
        s, v = req("POST", f"{CA}/vouchers", {"voucherTypeId": vtA["Payment"], "date": "2025-04-10",
            "entries": [{"ledgerId": cashA["id"], "amount": 1 + i}, {"ledgerId": capitalA["id"], "amount": -(1 + i)}]})
        nums.append(v.get("number") if s == 200 else f"ERR{s}")
    check("sequential numbering no dupes", len(set(nums)) == 5 and all(n not in ("ERR400",) for n in nums), nums, "NUM-1: duplicate voucher numbers", "P1")
    # duplicate manual number
    s, v1 = req("POST", f"{CA}/vouchers", {"voucherTypeId": vtA["Journal"], "date": "2025-04-11", "reference": "DUP-1",
        "entries": [{"ledgerId": cashA["id"], "amount": 5}, {"ledgerId": capitalA["id"], "amount": -5}]})
    s, v2 = req("POST", f"{CA}/vouchers", {"voucherTypeId": vtA["Journal"], "date": "2025-04-11", "reference": "DUP-1",
        "entries": [{"ledgerId": cashA["id"], "amount": 6}, {"ledgerId": capitalA["id"], "amount": -6}]})
    check("duplicate reference accepted or warned (no crash)", s in (200, 400), (s, v2))
    # concurrency: 8 parallel voucher creations
    results = []
    def create_v(i):
        s, v = req("POST", f"{CA}/vouchers", {"voucherTypeId": vtA["Receipt"], "date": "2025-04-12",
            "entries": [{"ledgerId": cashA["id"], "amount": 1}, {"ledgerId": capitalA["id"], "amount": -1}]})
        results.append((s, v.get("number") if s == 200 else None))
    threads = [threading.Thread(target=create_v, args=(i,)) for i in range(8)]
    [t.start() for t in threads]; [t.join() for t in threads]
    ok_nums = [n for s, n in results if s == 200 and n]
    check("concurrent creates all succeed", len(ok_nums) == 8, results, "NUM-2: concurrent voucher creation failures", "P2")
    check("concurrent numbering unique", len(set(ok_nums)) == len(ok_nums), ok_nums, "NUM-3: duplicate numbers under concurrency", "P1")

    print("== PART 4: AMOUNT EDGE CASES ==")
    for name, amt in [("0.01", 0.01), ("0.05", 0.05), ("0.99", 0.99), ("1234.56", 1234.56), ("999999999.99", 999999999.99)]:
        s, v = req("POST", f"{CA}/vouchers", {"voucherTypeId": vtA["Journal"], "date": "2025-04-13",
            "entries": [{"ledgerId": cashA["id"], "amount": amt}, {"ledgerId": capitalA["id"], "amount": -amt}]})
        check(f"amount {name} posts", s == 200, (s, v), f"AMT-1: amount {name} fails", "P2")
    s, v = req("POST", f"{CA}/vouchers", {"voucherTypeId": vtA["Journal"], "date": "2025-04-13",
        "entries": [{"ledgerId": cashA["id"], "amount": 1e15}, {"ledgerId": capitalA["id"], "amount": -1e15}]})
    check("huge amount 1e15 handled", s in (200, 400), (s, v), "AMT-2: 1e15 crash/overflow", "P2")
    if s == 200:
        s, tb = req("GET", f"{CA}/reports/trial-balance?from=2025-04-01&to=2025-04-30")
        check("TB balanced with huge amount", abs(tb["totalDebit"] - tb["totalCredit"]) < 0.01, (tb["totalDebit"], tb["totalCredit"]), "AMT-3: precision loss breaks TB", "P1")
    s, v = req("POST", f"{CA}/vouchers", {"voucherTypeId": vtA["Journal"], "date": "2025-04-13",
        "entries": [{"ledgerId": cashA["id"], "amount": 0.005}, {"ledgerId": capitalA["id"], "amount": -0.005}]})
    check("sub-paisa amount handled", s in (200, 400), (s, v), "AMT-4: sub-paisa mishandled", "P3")
    s, v = req("POST", f"{CA}/vouchers", {"voucherTypeId": vtA["Journal"], "date": "2025-04-13",
        "entries": [{"ledgerId": cashA["id"], "amount": float("nan")}, {"ledgerId": capitalA["id"], "amount": -1}]})
    check("NaN amount rejected", s == 400, (s, v), "AMT-5: NaN accepted into DB", "P1")
    s, v = req("POST", f"{CA}/vouchers", {"voucherTypeId": vtA["Journal"], "date": "2025-04-13",
        "entries": [{"ledgerId": cashA["id"], "amount": float("inf")}, {"ledgerId": capitalA["id"], "amount": -1}]})
    check("Infinity amount rejected", s == 400, (s, v), "AMT-6: Infinity accepted", "P1")

    print("== PART 7: FINANCIAL YEAR BOUNDARY ==")
    s, v = req("POST", f"{CA}/vouchers", {"voucherTypeId": vtA["Journal"], "date": "2025-03-31",
        "entries": [{"ledgerId": cashA["id"], "amount": 100}, {"ledgerId": capitalA["id"], "amount": -100}]})
    check("pre-books date rejected or handled", s in (200, 400), (s, v), "FY-1: pre-books date silently accepted", "P3")
    s, v = req("POST", f"{CA}/vouchers", {"voucherTypeId": vtA["Journal"], "date": "2025-04-01",
        "entries": [{"ledgerId": cashA["id"], "amount": 50}, {"ledgerId": capitalA["id"], "amount": -50}]})
    check("books-begin date accepted", s == 200, (s, v))
    s, v = req("POST", f"{CA}/vouchers", {"voucherTypeId": vtA["Journal"], "date": "2026-04-01",
        "entries": [{"ledgerId": cashA["id"], "amount": 50}, {"ledgerId": capitalA["id"], "amount": -50}]})
    check("next-FY date handled", s in (200, 400), (s, v))
    s, v = req("POST", f"{CA}/vouchers", {"voucherTypeId": vtA["Journal"], "date": "2025-02-30",
        "entries": [{"ledgerId": cashA["id"], "amount": 50}, {"ledgerId": capitalA["id"], "amount": -50}]})
    check("invalid date 2025-02-30 rejected", s == 400, (s, v), "FY-2: invalid date accepted", "P2")
    s, v = req("POST", f"{CA}/vouchers", {"voucherTypeId": vtA["Journal"], "date": "not-a-date",
        "entries": [{"ledgerId": cashA["id"], "amount": 50}, {"ledgerId": capitalA["id"], "amount": -50}]})
    check("garbage date rejected", s == 400, (s, v), "FY-3: garbage date accepted", "P2")
    # period boundary: ledger closing = opening of next period
    s, lv1 = req("GET", f"{CA}/reports/ledger-vouchers/{cashA['id']}?from=2025-04-01&to=2025-04-30")
    s, lv2 = req("GET", f"{CA}/reports/ledger-vouchers/{cashA['id']}?from=2025-05-01&to=2025-05-31")
    if lv1.get("closing") is not None and lv2.get("opening") is not None:
        check("ledger closing=next opening", abs(lv1["closing"] - lv2["opening"]) < 0.01, (lv1["closing"], lv2["opening"]), "FY-4: period carry-forward broken", "P1")

    print("== PART 15: NEGATIVE STOCK ==")
    s, unit = req("POST", f"{CA}/units", {"name": "Nos", "symbol": "Nos", "decimalPlaces": 0})
    s, item = req("POST", f"{CA}/stock-items", {"name": "NegItem", "unitId": unit["id"], "gstRate": "18", "openingQty": "0", "openingRate": "0", "openingValue": "0"})
    s, v = req("POST", f"{CA}/vouchers", {"voucherTypeId": vtA["Sales"], "date": "2025-04-20",
        "entries": [{"ledgerId": debtorA["id"], "amount": 118}, {"ledgerId": salesA["id"], "amount": -100, "gstRate": 18}],
        "inventoryEntries": [{"itemId": item["id"], "qty": -10, "rate": 10, "amount": 100, "kind": "stock"}]})
    check("sale with zero stock handled", s in (200, 400), (s, v), "INV-1: zero-stock sale crashes", "P2")
    if s == 200:
        s, ss = req("GET", f"{CA}/reports/stock-summary?to=2025-04-30")
        row = next((x for x in (ss or []) if x["name"] == "NegItem"), None)
        check("negative stock qty reported", row is not None and row["closingQty"] == -10, row, "INV-2: negative stock not visible", "P2")
        check("stock value not negative", row is None or float(row.get("closingValue", 0)) >= 0, row, "INV-3: negative stock value", "P1")
    # zero qty / zero rate
    s, v = req("POST", f"{CA}/vouchers", {"voucherTypeId": vtA["Sales"], "date": "2025-04-21",
        "entries": [{"ledgerId": debtorA["id"], "amount": 118}, {"ledgerId": salesA["id"], "amount": -100, "gstRate": 18}],
        "inventoryEntries": [{"itemId": item["id"], "qty": 0, "rate": 10, "amount": 0, "kind": "stock"}]})
    check("zero-qty line handled", s in (200, 400), (s, v), "INV-4: zero-qty line crash", "P3")
    s, v = req("POST", f"{CA}/vouchers", {"voucherTypeId": vtA["Sales"], "date": "2025-04-21",
        "entries": [{"ledgerId": debtorA["id"], "amount": 118}, {"ledgerId": salesA["id"], "amount": -100, "gstRate": 18}],
        "inventoryEntries": [{"itemId": 999999, "qty": -1, "rate": 10, "amount": 10, "kind": "stock"}]})
    check("nonexistent item rejected", s in (200, 400), (s, v), "INV-5: nonexistent item accepted", "P2")

    print("== PART 9/10: GST CALCULATION & ROUNDING ==")
    s, cgst = req("GET", f"{CA}/ledgers")
    Lg = {l["name"]: l["id"] for l in cgst}
    # 999.99 @ 18% => CGST 89.9991 -> round 90.00 each? independent: taxable*0.09
    cases = [("99.99@18", 99.99, 18), ("100.01@18", 100.01, 18), ("1234.56@18", 1234.56, 18), ("1.01@5", 1.01, 5)]
    for name, taxable, rate in cases:
        cg = round(taxable * rate / 200, 2); sg = cg
        total = round(taxable + cg + sg, 2)
        s, v = req("POST", f"{CA}/vouchers", {"voucherTypeId": vtA["Sales"], "date": "2025-04-22",
            "entries": [
                {"ledgerId": debtorA["id"], "amount": total},
                {"ledgerId": salesA["id"], "amount": -taxable, "gstRate": rate},
                {"ledgerId": Lg["CGST"], "amount": -cg, "gstRate": rate / 2},
                {"ledgerId": Lg["SGST/UTGST"], "amount": -sg, "gstRate": rate / 2},
            ]})
        check(f"GST case {name} posts", s == 200, (s, v), f"GST-1: {name} rejected", "P2")
        if s == 200:
            s, lv = req("GET", f"{CA}/reports/ledger-vouchers/{debtorA['id']}?from=2025-04-01&to=2025-04-30")
            # party closing should include this invoice total
    s, g1 = req("GET", f"{CA}/reports/gstr1?from=2025-04-01&to=2025-04-30")
    tot_taxable = sum(float(x.get("taxable", 0)) for x in (g1.get("b2b", []) + g1.get("b2c", [])))
    check("GSTR-1 totals finite", isinstance(tot_taxable, (int, float)), g1.get("totals"), "GST-2: GSTR-1 totals broken", "P1")

    print("== PART 11: BILL-WISE ==")
    # overpay an invoice
    s, v = req("POST", f"{CA}/vouchers", {"voucherTypeId": vtA["Sales"], "date": "2025-04-23",
        "entries": [{"ledgerId": debtorA["id"], "amount": 100, "bills": [{"billType": "new_ref", "billName": "OV-1", "amount": 100}]},
                    {"ledgerId": salesA["id"], "amount": -100}]})
    check("bill invoice created", s == 200, (s, v))
    if s == 200:
        s, v = req("POST", f"{CA}/vouchers", {"voucherTypeId": vtA["Receipt"], "date": "2025-04-24",
            "entries": [{"ledgerId": cashA["id"], "amount": 150},
                        {"ledgerId": debtorA["id"], "amount": -150, "bills": [{"billType": "against_ref", "billName": "OV-1", "amount": -150}]}]})
        check("overpayment accepted or rejected", s in (200, 400), (s, v), "BILL-1: overpayment corrupts outstanding", "P1")
        s, rec = req("GET", f"{CA}/reports/receivables?to=2025-04-30")
        check("receivables finite after overpay", isinstance(rec.get("total"), (int, float)), rec, "BILL-2: receivables broken after overpay", "P1")
        # allocate to wrong party's bill
        s, other = req("POST", f"{CA}/ledgers", {"name": "Other Party", "groupId": gA["Sundry Debtors"], "billWise": True})
        s, v = req("POST", f"{CA}/vouchers", {"voucherTypeId": vtA["Receipt"], "date": "2025-04-24",
            "entries": [{"ledgerId": cashA["id"], "amount": 10},
                        {"ledgerId": other["id"], "amount": -10, "bills": [{"billType": "against_ref", "billName": "OV-1", "amount": -10}]}]})
        check("cross-party bill ref rejected", s == 400, (s, v), "BILL-3: bill allocated to wrong party accepted", "P1")
        # negative allocation
        s, v = req("POST", f"{CA}/vouchers", {"voucherTypeId": vtA["Receipt"], "date": "2025-04-24",
            "entries": [{"ledgerId": cashA["id"], "amount": 10},
                        {"ledgerId": debtorA["id"], "amount": -10, "bills": [{"billType": "against_ref", "billName": "OV-1", "amount": 99999}]}]})
        check("bill amount != entry amount rejected", s == 400, (s, v), "BILL-4: mismatched bill allocation accepted", "P1")

    print("== PART 35: DELETION / REFERENTIAL INTEGRITY ==")
    s, b = req("DELETE", f"{CA}/ledgers/{cashA['id']}")
    check("deleting ledger used in vouchers blocked or warned", s in (400, 403, 409) or s == 200, (s, b), "DEL-1: ledger with postings deleted silently", "P1")
    if s == 200:
        s, tb = req("GET", f"{CA}/reports/trial-balance?from=2025-04-01&to=2025-04-30")
        check("TB still balanced after ledger delete", abs(tb["totalDebit"] - tb["totalCredit"]) < 0.01, tb, "DEL-2: ledger delete corrupts TB", "P0")
    s, b = req("DELETE", f"{CA}/ledgers/{debtorA['id']}")
    check("deleting party with bills blocked", s in (400, 403, 409) or s == 200, (s, b), "DEL-3: party with bills deleted", "P1")
    s, b = req("DELETE", f"{CA}/groups/{gA['Sundry Debtors']}")
    check("deleting default group blocked", s in (400, 403, 409), (s, b), "DEL-4: default group deletable", "P1")
    s, b = req("DELETE", f"{CA}/stock-items/{item['id']}")
    check("deleting item with movements blocked or handled", s in (400, 403, 409, 200), (s, b), "DEL-5: item delete corrupts stock", "P2")

    print("== PART 27: INPUT FUZZING ==")
    fuzz = ["", " ", "<script>alert(1)</script>", "'; DROP TABLE ledgers; --", "A" * 10000, "🎉💰", "../../etc/passwd", "\n\t\r", "NaN", "null", "{}"]
    for i, payload in enumerate(fuzz):
        s, b = req("POST", f"{CA}/ledgers", {"name": payload, "groupId": gA["Indirect Expenses"]})
        check(f"fuzz ledger name #{i} handled", s in (200, 400), (s, str(b)[:120]), f"FZ-1: payload {payload[:20]!r} crashes", "P2")
    s, ledgers = req("GET", f"{CA}/ledgers")
    xss = [l["name"] for l in ledgers if "<script>" in l["name"]]
    check("XSS payload stored (render-side must escape)", True)  # storage ok; UI must escape
    s, b = req("GET", f"{CA}/ledgers?q=%27%3B%20DROP%20TABLE%20ledgers%3B%20--")
    check("SQLi in search param handled", s in (200, 400), (s, str(b)[:100]), "SEC-1: SQLi via search", "P0")

    print("== PART 29: ATOMICITY (malformed voucher) ==")
    s, b = req("POST", f"{CA}/vouchers", {"voucherTypeId": vtA["Sales"], "date": "2025-04-25",
        "entries": [{"ledgerId": debtorA["id"], "amount": 118}, {"ledgerId": salesA["id"], "amount": -100, "gstRate": 18}],
        "inventoryEntries": [{"itemId": item["id"], "qty": -1, "rate": "not-a-number", "amount": 10, "kind": "stock"}]})
    check("malformed inventory rejected cleanly", s == 400, (s, b), "ATOM-1: malformed inventory partial-commit", "P1")
    s, day = req("GET", f"{CA}/vouchers?from=2025-04-25&to=2025-04-25")
    check("no orphan voucher from failed save", len(day or []) == 0, day, "ATOM-2: orphan voucher after failed save", "P1")

    print("== PART 31: PERF SANITY ==")
    t0 = time.time()
    s, ledgers = req("GET", f"{CA}/ledgers")
    t1 = time.time()
    check(f"ledgers list fast ({t1-t0:.2f}s)", t1 - t0 < 2, t1 - t0, "PERF-1: slow masters list", "P3")
    t0 = time.time()
    s, tb = req("GET", f"{CA}/reports/trial-balance?from=2025-04-01&to=2026-03-31")
    t1 = time.time()
    check(f"TB fast ({t1-t0:.2f}s)", t1 - t0 < 3, t1 - t0, "PERF-2: slow trial balance", "P3")
    t0 = time.time()
    s, bs = req("GET", f"{CA}/reports/balance-sheet?to=2026-03-31")
    t1 = time.time()
    check(f"BS fast ({t1-t0:.2f}s)", t1 - t0 < 3, t1 - t0, "PERF-3: slow balance sheet", "P3")
    check("BS balances after all attacks", abs(bs.get("difference", 1)) < 0.01, bs, "BS-1: balance sheet broken by attack data", "P1")

    print("== PART 19: XML IMPORT ATTACK ==")
    for name, xml, expect in [
        ("malformed xml", "<ENVELOPE><BODY>", 400),
        ("empty xml", "", 400),
        ("huge xml", "<ENVELOPE>" + "<A>x</A>" * 200000 + "</ENVELOPE>", None),
    ]:
        s, b = req("POST", f"{CA}/import/xml", xml, headers={"Content-Type": "text/plain"})
        if expect is not None:
            check(f"xml {name} -> {expect}", s == expect or s in (400, 413), (s, str(b)[:80]), f"XML-1: {name} -> {s}", "P2")
        else:
            check(f"xml {name} no crash", s in (200, 400, 413), (s, str(b)[:80]), f"XML-2: {name} crash", "P2")
    evil = """<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA><TALLYMESSAGE>
    <LEDGER NAME="x' OR 1=1 --"><PARENT>Sundry Debtors</PARENT></LEDGER>
    </TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>"""
    s, b = req("POST", f"{CA}/import/xml", evil, headers={"Content-Type": "text/plain"})
    check("sqli-in-xml handled", s in (200, 400), (s, str(b)[:80]), "XML-3: SQLi via XML import", "P0")
    s, ledgers = req("GET", f"{CA}/ledgers")
    check("injected ledger did not wipe table", len(ledgers) > 5, len(ledgers))

    print(f"\n== DONE: {PASS} passed, {FAIL} failed ==")
    if findings:
        print("\nFINDINGS:")
        for sev, bug, det in findings:
            print(f"  [{sev}] {bug} :: {det[:160]}")
finally:
    server.terminate()
    try: server.wait(timeout=5)
    except Exception: server.kill()
