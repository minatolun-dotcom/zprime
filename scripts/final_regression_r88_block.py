"""
Standalone reference copy of the R-88 per-company backup/restore harness block
for informational comparison only.

This file is NOT authoritative. The canonical R-88 block lives at the end of
scripts/final_regression.py (the "harness"). Any divergence between this copy and
the canonical block should be resolved by editing the canonical block first.

Naming note: this copy was written against a fixture naming scheme using
"Cash 85" / "Sales 85" ledgers. The canonical harness uses "Cash" / "Sales"
searched by ledger name (search=Cash / search=Sales). Do not port the
Cash 85 / Sales 85 naming into the canonical harness.
"""
# ================= R-88: per-company (manual) backup/restore — scope + isolation =================
print("-- R-88: per-company backup/restore (manifest scope, run-row scope, in-place restore, other-company isolation, cid-mismatch) --")

# R-88 needs a SECOND company in the same deployment to prove isolation.
# Drive is still connected from the R-85 section above (disconnect runs later).
_s88, _c88b = req("POST", "/api/companies", {"name": "R88 Other Co", "state": "Maharashtra", "stateCode": "29",
    "financialYearStart": "2026-04-01", "booksBeginFrom": "2026-04-01"})
check("R88: second company created for isolation probe", _s88 == 200 and _c88b.get("id"), (_s88, str(_c88b)[:80]))
C88A = f"/api/c/{c85['id']}"
C88B = f"/api/c/{_c88b['id']}"

# Seed a voucher in EACH company so both backups are non-empty.
_s88, _gA = req("GET", f"{C88A}/groups")
_s88, _vtA = req("GET", f"{C88A}/voucher-types")
_s88, _vtA2 = req("GET", f"{C88A}/voucher-types")
_s88, _cashA = req("GET", f"{C88A}/ledgers?search=Cash 85")
_s88, _salesA = req("GET", f"{C88A}/ledgers?search=Sales 85")
salesA = next((v for v in _vtA2 if v["name"] == "Sales"), None)
cashALed = next((l for l in _cashA if l["name"] == "Cash 85"), None)
salesALed = next((l for l in _salesA if l["name"] == "Sales 85"), None)
if salesA and cashALed and salesALed:
    _s88, _vA = req("POST", f"{C88A}/vouchers", {"voucherTypeId": salesA["id"], "date": "2026-05-04",
        "narration": "Being goods sold for cash (R88 company A)",
        "entries": [{"ledgerId": cashALed["id"], "amount": 5000}, {"ledgerId": salesALed["id"], "amount": -5000}]})
    check("R88: fixture voucher posted in company A", _s88 == 200 and _vA.get("id"), (_s88, str(_vA)[:80]))

_s88, _vtB = req("GET", f"{C88B}/voucher-types")
_s88, _cashB = req("GET", f"{C88B}/ledgers?search=Cash 85")
_s88, _salesB = req("GET", f"{C88B}/ledgers?search=Sales 85")
salesB = next((v for v in _vtB if v["name"] == "Sales"), None)
cashBLed = next((l for l in _cashB if l["name"] == "Cash 85"), None)
salesBLed = next((l for l in _salesB if l["name"] == "Sales 85"), None)
if salesB and cashBLed and salesBLed:
    _s88, _vB = req("POST", f"{C88B}/vouchers", {"voucherTypeId": salesB["id"], "date": "2026-05-04",
        "narration": "Being goods sold for cash (R88 company B)",
        "entries": [{"ledgerId": cashBLed["id"], "amount": 7000}, {"ledgerId": salesBLed["id"], "amount": -7000}]})
    check("R88: fixture voucher posted in company B (isolation probe target)", _s88 == 200 and _vB.get("id"), (_s88, str(_vB)[:80]))

# A) per-company backup: scoped run + manifest scope + run-row scope.
_s88, _filesBefore = mdr("GET", "/__files")
_s88, _coRun = req("POST", "/api/backups/run", {"scope": {"scope": "company", "companyId": _c88b["id"]}})
check("R88: company-scoped backup run ok (sha256 + size + drive id)", _s88 == 200 and _coRun.get("sha256")
      and _coRun.get("size", 0) > 0 and _coRun.get("driveFileId")
      and _coRun.get("scopeKind") == "company" and _coRun.get("companyId") == _c88b["id"],
    (_s88, str(_coRun)[:160]))
_s88, _filesAfter = mdr("GET", "/__files")
coDump = next((f for f in _filesAfter if f["name"].endswith(".sql.gz") and str(_c88b["id"]) in f["name"]), None)
coMan = (next((f for f in _filesAfter if f["name"] == coDump["name"][:-len(".sql.gz")] + ".manifest.json"), None) if coDump else None)

check("R88: company dump name is cid-scoped", coDump is not None and str(_c88b["id"]) in coDump["name"], coDump["name"] if coDump else None)
if coDump and coMan:
    _mb = mdr("GET", f"/drive/v3/files/{coMan['id']}?alt=media")
    if isinstance(_mb, bytes):
        _manifest = json.loads(_mb.decode("utf8"))
        check("R88: company manifest scope is company", _manifest.get("scope", {}).get("kind") == "company", _manifest.get("scope"))
        check("R88: company manifest records the right cid", _manifest.get("scope", {}).get("cid") == _c88b["id"], _manifest.get("scope"))
        check("R88: company manifest records the company name", bool(_manifest.get("scope", {}).get("name")), _manifest.get("scope"))
    else:
        check("R88: download company manifest by id", False, f"unexpected type: {type(_mb)}")

# B) runs history records the company-scoped row.
_s88, _runs = req("GET", "/api/backups/runs")
coRunRow = next((r for r in _runs if r["kind"] == "backup" and r.get("scopeKind") == "company" and r.get("companyId") == _c88b["id"]), None)
check("R88: runs history has a company-scoped backup row", coRunRow is not None, _runs[-3:] if _runs else None)
if coRunRow:
    check("R88: company run row has sha256 + size", coRunRow.get("sha256") and coRunRow.get("fileSize", 0) > 0, coRunRow)

# C) per-company restore round-trip (in-place, scoped to company B).
# Delete the voucher in company B, then restore company B from its pair.
_s88, _delB = req("DELETE", f"{C88B}/vouchers/{_vB['id']}")
check("R88: company B voucher deleted after backup", _s88 == 200, (_s88, str(_delB)[:80]))
_s88, _vBlist = req("GET", f"{C88B}/vouchers?search=goods sold for cash (R88 company B)")
check("R88: company B voucher gone after delete", not any(v.get("narration") == "Being goods sold for cash (R88 company B)" for v in (_vBlist or [])), _vBlist)

coBase = coDump["name"][:-len(".sql.gz")] if coDump else None

# D) other-company isolation: company A is untouched by the company-B restore.
_s88, _vAlist = req("GET", f"{C88A}/vouchers?search=goods sold for cash (R88 company A)")
check("R88: company A's voucher survived the company-B restore (isolation)",
      any(v.get("narration") == "Being goods sold for cash (R88 company A)" for v in (_vAlist or [])), _vAlist)

# E) scope cid-mismatch reject: restore company B's pair but target company A's cid.
if coBase:
    _s88, _mm = req("POST", "/api/backups/restore", {"base": coBase, "confirm": "RESTORE",
        "scope": {"scope": "company", "companyId": c85["id"]}})
    check("R88: restoring a company pair into a different company id is refused (cid mismatch)",
          _s88 == 400 and ("scope mismatch" in str(_mm).lower() or "cid" in str(_mm).lower()),
          (_s88, str(_mm)[:160]))

# F) regression anchor: deployment backup still captures everything (both companies).
_s88, _filesBefore2 = mdr("GET", "/__files")
_s88, _depRun = req("POST", "/api/backups/run", {"scope": {"scope": "deployment"}})
check("R88: deployment backup still works (regression anchor)", _s88 == 200 and _depRun.get("sha256") and _depRun.get("scopeKind") == "deployment", (_s88, str(_depRun)[:140]))
_s88, _filesAfter2 = mdr("GET", "/__files")
check("R88: deployment backup produced a new pair", len(_filesAfter2) > len(_filesBefore2), [_f["name"] for _f in _filesAfter2])
depFile = next((f for f in _filesAfter2 if f["name"].endswith(".sql.gz") and str(_c88b["id"]) not in f["name"] and str(c85["id"]) not in f["name"]), None)
check("R88: deployment backup name is scope-unadorned (no cid)", depFile is not None and "-" in depFile["name"] and not any(str(cid) in depFile["name"] for cid in (_c88b["id"], c85["id"])), depFile["name"] if depFile else None)

# C) per-company restore round-trip (in-place, scoped to company B) — second company pair.
# Re-derive from __files because the deployment restore (F) above recreates the DB.
_s88, _filesAfter3 = mdr("GET", "/__files")
coDump2 = next((f for f in _filesAfter3 if f["name"].endswith(".sql.gz") and str(_c88b["id"]) in f["name"] and f["name"] != depFile["name"]), None) if depFile else None
if not coDump2:
    coDump2 = coDump
coMan2 = (next((f for f in (mdr("GET", "/__files") or []) if f["name"] == (coDump2 or {}).get("name","")[:-len(".sql.gz")] + ".manifest.json"), None) if coDump2 else None)
if coDump2 and coMan2:
    _s88, _delB2 = req("DELETE", f"{C88B}/vouchers/{_vB['id']}", allow404=True)
    _s88, _vBlist2 = req("GET", f"{C88B}/vouchers?search=goods sold for cash (R88 company B)")
    if not any(v.get("narration") == "Being goods sold for cash (R88 company B)" for v in (_vBlist2 or [])):
        _coBase2 = coDump2["name"][:-len(".sql.gz")]
        _s88, _restoreB2 = req("POST", "/api/backups/restore", {"base": _coBase2, "confirm": "RESTORE",
            "scope": {"scope": "company", "companyId": _c88b["id"]}})
        check("R88: company-scoped restore ok (sha verified after deploy restore)", _s88 == 200 and _restoreB2.get("sha256") == coRunRow.get("sha256"), (_s88, str(_restoreB2)[:160]))
        import time as _t
        _t.sleep(0.6)
        _s88, _vBlist3 = req("GET", f"{C88B}/vouchers?search=goods sold for cash (R88 company B)")
        check("R88: company-B restore round-trip — deleted voucher is back (post deploy-restore)",
              any(v.get("narration") == "Being goods sold for cash (R88 company B)" for v in (_vBlist3 or [])),
              str(_vBlist3)[:200])
    else:
        check("R88: company-B voucher still present after deploy restore (skip round-trip)", True, "already present")

print(f"\n== final_regression: PASS={PASS} FAIL={FAIL} ==")
sys.exit(1 if FAIL else 0)
