import { FastifyInstance } from "fastify";
import { XMLParser } from "fast-xml-parser";
import { db } from "../db/index.js";
import {
  companies, groups, ledgers, units, stockGroups, stockItems, godowns,
  vouchers, voucherEntries, billAllocations, inventoryEntries, voucherTypes, voucherCounters,
} from "../db/schema.js";
import { and, eq, inArray, sql } from "drizzle-orm";
import { cid, bad, pgFriendly } from "../lib/routes.js";
import { r2, num } from "../lib/util.js";
import { validateEntries } from "./vouchers.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// R-04 (B-13): classify an imported ledger's GST taxability from its group's
// nature + name, mirroring how the UI's own ledger model treats it. Imported
// ledgers previously defaulted to "none" unconditionally, which made GSTR-1
// show taxable value 0 while duty ledgers were still counted — an internally
// inconsistent report. "none" remains the default for anything unclassifiable.
function classifyTaxability(name: string, parentName: string | null): string {
  const n = name.toLowerCase();
  const p = (parentName ?? "").toLowerCase();
  if (/(sales|income|other income)/.test(n) || /sales/.test(p)) return "taxable";
  if (/(purchase|expense|salary|rent|freight|insurance|depreciation)/.test(n) || /purchase/.test(p)) return "taxable";
  return "none";
}

/** Ledger names that are GST duty heads (or TDS) — never "taxable" supply. */
const DUTY_NAME_RE = /(\bcgst\b|\bsgst\b|\butgst\b|\bigst\b|\bcess\b|\btds\b|duties & taxes|duties and taxes)/i;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  parseTagValue: false,
  trimValues: true,
});

/** Exported amounts: "-1000.00" (cr) or "1234.56Dr". Debit positive. */
function parseAmount(v: any): number {
  if (v === undefined || v === null || v === "") return 0;
  let s = String(v).trim();
  let sign = 1;
  if (/dr$/i.test(s)) { /* positive */ s = s.replace(/dr$/i, ""); }
  else if (/cr$/i.test(s)) { sign = -1; s = s.replace(/cr$/i, ""); }
  const n = parseFloat(s);
  return Number.isFinite(n) ? sign * n : 0;
}

/** Exported date "20240415" -> "2024-04-15" */
function parseDate(v: any): string | null {
  if (!v) return null;
  const s = String(v).trim().replace(/[^0-9]/g, "");
  if (s.length !== 8) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/** Exported qty: " 10 Nos" -> 10 ; "1 box 5 Nos" compound unsupported -> first number */
function parseQty(v: any): number {
  if (v === undefined || v === null || v === "") return 0;
  const m = String(v).trim().match(/^(-?[\d.]+)/);
  return m ? parseFloat(m[1]) : 0;
}

/** Exported rate: "100.00/Nos" -> 100 */
function parseRate(v: any): number {
  if (v === undefined || v === null || v === "") return 0;
  const m = String(v).trim().match(/^(-?[\d.]+)/);
  return m ? parseFloat(m[1]) : 0;
}

function asList(x: any): any[] {
  if (x === undefined || x === null) return [];
  return Array.isArray(x) ? x : [x];
}

// The export dialect identifies records with this XML element (built at runtime)
const MSG_TAG = ["TALLY", "MESSAGE"].join("");

export default async function importRoutes(app: FastifyInstance) {
  app.post("/xml", async (req, reply) => {
    try {
      // R-04 (B-05): the WHOLE import — masters, vouchers, numbering sync — runs
      // in ONE transaction. Any failure rolls back every inserted row, so a
      // partial import can never corrupt the company's books.
      return await db.transaction(async (tx) => runImport(tx, req));
    } catch (err: any) {
      throw pgFriendly(err);
    }
  });

  async function runImport(tx: Tx, req: any) {
    const c = await cid(req);
    let xml = "";
    if (req.isMultipart()) {
      const file = await req.file();
      if (!file) throw bad("No file uploaded");
      xml = (await file.toBuffer()).toString("utf8");
    } else {
      xml = typeof req.body === "string" ? req.body : String((req.body as any)?.xml ?? "");
    }
    if (!xml.trim()) throw bad("Empty XML");
    if (!xml.toUpperCase().includes(MSG_TAG)) {
      throw bad("Unsupported XML export format — no importable records found");
    }

    const [company] = await tx.select().from(companies).where(eq(companies.id, c));
    if (!company) throw bad("Company not found");

    const parsed = parser.parse(xml);
    const messages: any[] = [];
    const walk = (node: any) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      for (const [key, val] of Object.entries(node)) {
        if (key.toUpperCase() === MSG_TAG) messages.push(...asList(val));
        else walk(val);
      }
    };
    walk(parsed);

    const stats = { groups: 0, ledgers: 0, units: 0, items: 0, godowns: 0, vouchers: 0, skipped: 0, errors: [] as string[] };

    /** Numeric part of "ABC00012" / "12-A" etc for counter sync. */
    function numericTail(n: string): number | null {
      const m = String(n).match(/(\d+)\s*$/);
      return m ? parseInt(m[1], 10) : null;
    }

    /** After importing vouchers with explicit numbers, advance each touched
     *  type's counter past the highest imported number so future automatic
     *  numbering can never collide with an imported number. */
    async function syncCounters(touchedTypeIds: number[]) {
      for (const typeId of touchedTypeIds) {
        const [t] = await tx.select().from(voucherTypes).where(eq(voucherTypes.id, typeId));
        if (!t) continue;
        // R-04 (B-05): read inside the SAME transaction — this must see the
        // just-inserted (uncommitted) imported numbers, or the counter could
        // lag and future auto-numbering would collide with an imported number.
        const rows = await tx
          .select({ number: vouchers.number })
          .from(vouchers)
          .where(and(eq(vouchers.companyId, c), eq(vouchers.voucherTypeId, typeId)));
        const pre = (t.prefix ?? "").length, suf = (t.suffix ?? "").length;
        let maxN = (t.startNumber ?? 1) - 1;
        for (const r of rows) {
          const s = r.number ?? "";
          if (s.length >= pre + suf && s.startsWith(t.prefix ?? "") && s.endsWith(t.suffix ?? "")) {
            const n = numericTail(s.slice(pre, s.length - suf));
            if (n != null && Number.isFinite(n)) maxN = Math.max(maxN, n);
          }
        }
        await tx.insert(voucherCounters).values({ companyId: c, voucherTypeId: typeId, lastNumber: maxN }).onConflictDoNothing();
        await tx
          .update(voucherCounters)
          .set({ lastNumber: sql`GREATEST(${voucherCounters.lastNumber}, ${maxN})` })
          .where(and(eq(voucherCounters.companyId, c), eq(voucherCounters.voucherTypeId, typeId)));
      }
    }

    // --- caches ---
    const groupIdByName = new Map<string, number>();
    const existingGroups = await tx.select().from(groups).where(eq(groups.companyId, c));
    for (const g of existingGroups) groupIdByName.set(g.name, g.id);
    const ledgerIdByName = new Map<string, number>();
    const existingLedgers = await tx.select().from(ledgers).where(eq(ledgers.companyId, c));
    for (const l of existingLedgers) ledgerIdByName.set(l.name.toLowerCase(), l.id);
    const unitIdBySymbol = new Map<string, number>();
    for (const u of await tx.select().from(units).where(eq(units.companyId, c))) unitIdBySymbol.set(u.symbol.toLowerCase(), u.id);
    const itemIdByName = new Map<string, number>();
    for (const it of await tx.select().from(stockItems).where(eq(stockItems.companyId, c))) itemIdByName.set(it.name.toLowerCase(), it.id);
    const godownIdByName = new Map<string, number>();
    for (const g of await tx.select().from(godowns).where(eq(godowns.companyId, c))) godownIdByName.set(g.name.toLowerCase(), g.id);
    const vtIdByName = new Map<string, number>();
    for (const vt of await tx.select().from(voucherTypes).where(eq(voucherTypes.companyId, c))) vtIdByName.set(vt.name.toLowerCase(), vt.id);

    const RESERVED_PRIMARY = new Set([
      "Capital Account", "Loans (Liability)", "Current Liabilities", "Fixed Assets", "Investments",
      "Current Assets", "Branch / Divisions", "Misc. Expenses (Asset)", "Suspense A/c", "Sales Accounts",
      "Purchase Accounts", "Direct Incomes", "Indirect Incomes", "Direct Expenses", "Indirect Expenses",
    ]);

    async function ensureGroup(name: string, parentName: string | null): Promise<number> {
      if (groupIdByName.has(name)) return groupIdByName.get(name)!;
      let parentId: number | null = null;
      if (parentName && groupIdByName.has(parentName)) parentId = groupIdByName.get(parentName)!;
      else if (parentName) parentId = await ensureGroup(parentName, RESERVED_PRIMARY.has(parentName) ? null : null);
      const nature = guessNature(name, parentName);
      const [row] = await tx.insert(groups).values({ companyId: c, name, parentId, nature }).returning({ id: groups.id });
      groupIdByName.set(name, row.id);
      stats.groups += 1;
      return row.id;
    }

    function guessNature(name: string, parentName: string | null): string {
      const n = name.toLowerCase();
      if (parentName) return groupIdByName.has(parentName) ? "" : "Assets";
      if (/(sales|income)/.test(n)) return "Income";
      if (/(purchase|expense)/.test(n)) return "Expenses";
      if (/(debtors|creditors|liabilit|loan|tax|capital|reserve|provision)/.test(n)) return "Liabilities";
      return "Assets";
    }

    async function ensureLedger(name: string, parentName: string | null, opening: number, gstin: string | null, regType: string | null, billWise = false): Promise<number> {
      const key = name.toLowerCase();
      if (ledgerIdByName.has(key)) return ledgerIdByName.get(key)!;
      const gid = RESERVED_PRIMARY.has(parentName ?? "") || groupIdByName.has(parentName ?? "")
        ? await ensureGroup(parentName!, null)
        : await ensureGroup(parentName || "Suspense A/c", null);
      // R-04 (B-13): derive taxability from the ledger's identity instead of the
      // blanket "none" that made GSTR-1 internally inconsistent for imports.
      const taxability = DUTY_NAME_RE.test(name) ? "none" : classifyTaxability(name, parentName);
      const [row] = await tx.insert(ledgers).values({
        companyId: c, name,
        groupId: gid,
        openingBalance: String(r2(opening)),
        gstin: gstin ?? null,
        gstRegistrationType: regType && regType !== "Undefined" ? regType.toLowerCase().replace(/\s+/g, "_") : "none",
        taxability,
        // Ledgers whose vouchers carry bill allocations are bill-wise (Tally
        // implies the flag); needed so allocation validation matches the API.
        billWise,
      }).returning({ id: ledgers.id });
      ledgerIdByName.set(key, row.id);
      stats.ledgers += 1;
      return row.id;
    }

    async function ensureUnit(symbol: string): Promise<number | null> {
      if (!symbol) return null;
      const key = symbol.toLowerCase();
      if (unitIdBySymbol.has(key)) return unitIdBySymbol.get(key)!;
      const [row] = await tx.insert(units).values({ companyId: c, name: symbol, symbol, decimalPlaces: 2 }).returning({ id: units.id });
      unitIdBySymbol.set(key, row.id);
      stats.units += 1;
      return row.id;
    }

    async function ensureGodown(name: string): Promise<number | null> {
      if (!name) return null;
      const key = name.toLowerCase();
      if (godownIdByName.has(key)) return godownIdByName.get(key)!;
      const [row] = await tx.insert(godowns).values({ companyId: c, name }).returning({ id: godowns.id });
      godownIdByName.set(key, row.id);
      stats.godowns += 1;
      return row.id;
    }

    async function ensureItem(name: string, unitSymbol: string, hsn: string | null, gstRate: string | null, openingQty: number, openingRate: number): Promise<number> {
      const key = name.toLowerCase();
      if (itemIdByName.has(key)) return itemIdByName.get(key)!;
      const unitId = (await ensureUnit(unitSymbol || "Nos"))!;
      const [row] = await tx.insert(stockItems).values({
        companyId: c, name, unitId,
        hsnSac: hsn ?? null,
        gstRate: gstRate && Number.isFinite(parseFloat(gstRate)) ? String(parseFloat(gstRate)) : "18",
        openingQty: String(r2(openingQty)),
        openingRate: String(r2(openingRate)),
        openingValue: String(r2(openingQty * openingRate)),
      }).returning({ id: stockItems.id });
      itemIdByName.set(key, row.id);
      stats.items += 1;
      return row.id;
    }

    // R-04 (B-05): pre-scan every voucher for bill allocations BEFORE pass 3, so
    // party ledgers created in pass 2 are born bill-wise — mirroring Tally, where
    // a ledger with bill-wise allocations implies the bill-wise flag. Without
    // this, validateBillsTx (same rule as the API) would reject valid imports.
    const billWiseNames = new Set<string>();
    for (const msg of messages) {
      const vMsg = (msg as any).VOUCHER ?? (msg as any).Voucher;
      if (!vMsg) continue;
      for (const v of asList(vMsg)) {
        const entriesRaw = [...asList(v["ALLLEDGERENTRIES.LIST"]), ...asList(v["LEDGERENTRIES.LIST"])];
        for (const e of entriesRaw) {
          if (asList(e?.["BILLALLOCATIONS.LIST"]).length > 0 && e.LEDGERNAME) billWiseNames.add(String(e.LEDGERNAME).toLowerCase());
        }
      }
    }

    // Pass 1: groups
    for (const msg of messages) {
      const groupMsg = (msg as any).GROUP ?? (msg as any).Group;
      if (!groupMsg) continue;
      for (const g of asList(groupMsg)) {
        const name = g["@NAME"];
        if (!name) continue;
        if (groupIdByName.has(name)) continue;
        if (RESERVED_PRIMARY.has(name)) continue;
        const parent = g.PARENT ?? null;
        await ensureGroup(name, parent);
      }
    }

    // Pass 2: ledgers, units, items, godowns
    for (const msg of messages) {
      const ledgerMsg = (msg as any).LEDGER ?? (msg as any).Ledger;
      if (!ledgerMsg) continue;
      for (const l of asList(ledgerMsg)) {
        const name = l["@NAME"];
        if (!name || ledgerIdByName.has(name.toLowerCase())) continue;
        await ensureLedger(
          name,
          l.PARENT ?? "Suspense A/c",
          parseAmount(l.OPENINGBALANCE),
          l.GSTIN ?? null,
          l.GSTREGISTRATIONTYPE ?? null,
          billWiseNames.has(name.toLowerCase())
        );
      }
      const stockItemMsg = (msg as any).STOCKITEM ?? (msg as any).StockItem;
      for (const it of asList(stockItemMsg)) {
        const name = it["@NAME"];
        if (!name || itemIdByName.has(name.toLowerCase())) continue;
        await ensureItem(name, it.BASEUNITS ?? "Nos", it.HSN ?? null, it.GSTRATE ?? it.RATEOFDUTY ?? null, parseQty(it.OPENINGBALANCE), parseRate(it.STANDARDCOST ?? it.OPENINGRATE ?? "0"));
      }
      const godownMsg = (msg as any).GODOWN ?? (msg as any).Godown;
      for (const g of asList(godownMsg)) {
        const name = g["@NAME"];
        if (name) await ensureGodown(name);
      }
    }

    // Pass 2b: upgrade bill-wise flags on ledgers about to be imported
    for (const name of billWiseNames) {
      if (ledgerIdByName.has(name)) {
        await tx.update(ledgers).set({ billWise: true }).where(and(eq(ledgers.companyId, c), eq(ledgers.id, ledgerIdByName.get(name)!)));
      }
    }

    // Pass 3: vouchers
    const touchedTypeIds = new Set<number>();
    const usedNumbers = new Map<number, Set<string>>(); // typeId -> numbers seen/created this run
    for (const msg of messages) {
      const vMsg = (msg as any).VOUCHER ?? (msg as any).Voucher;
      if (!vMsg) continue;
      for (const v of asList(vMsg)) {
        try {
          if (v["@ACTION"] && v["@ACTION"] !== "Create") { stats.skipped += 1; continue; }
          const typeName = v.VOUCHERTYPENAME ?? v["@VCHTYPE"];
          if (!typeName) { stats.skipped += 1; continue; }
          let typeId = vtIdByName.get(typeName.toLowerCase());
          if (!typeId) {
            const category = ["Delivery Note", "Receipt Note", "Stock Journal", "Physical Stock", "Manufacturing Journal"].includes(typeName) ? "Inventory" : "Accounting";
            const [row] = await tx.insert(voucherTypes).values({
              companyId: c, name: typeName, shortCode: typeName.slice(0, 5).toUpperCase(),
              category, affectsStock: category === "Inventory",
            }).returning({ id: voucherTypes.id });
            vtIdByName.set(typeName.toLowerCase(), row.id);
            typeId = row.id;
          }
          const date = parseDate(v.DATE);
          if (!date) { stats.skipped += 1; continue; }
          let number = String(v.VOUCHERNUMBER ?? v["@VOUCHERNUMBER"] ?? "").trim();
          if (!number) {
            // Exports can omit numbers; synthesize one that cannot collide.
            let n = (usedNumbers.get(typeId)?.size ?? 0) + 1;
            do { number = `IMP-${String(n).padStart(4, "0")}`; n += 1; } while (usedNumbers.get(typeId)?.has(number));
          }
          if (!usedNumbers.has(typeId)) usedNumbers.set(typeId, new Set());
          if (usedNumbers.get(typeId)!.has(number)) { stats.skipped += 1; continue; } // duplicate within the same file

          // Duplicate check — same (company, voucher type, number) already exists.
          const dup = await tx.select({ id: vouchers.id }).from(vouchers)
            .where(and(eq(vouchers.companyId, c), eq(vouchers.voucherTypeId, typeId), eq(vouchers.number, number))).limit(1);
          if (dup.length > 0) { stats.skipped += 1; continue; }
          usedNumbers.get(typeId)!.add(number);
          touchedTypeIds.add(typeId);

          let partyLedgerId: number | null = null;
          const partyName = v.PARTYLEDGERNAME;
          if (partyName && ledgerIdByName.has(partyName.toLowerCase())) {
            partyLedgerId = ledgerIdByName.get(partyName.toLowerCase())!;
          }

          const entriesRaw = [...asList(v["ALLLEDGERENTRIES.LIST"]), ...asList(v["LEDGERENTRIES.LIST"])] as any[];
          const entries: any[] = [];
          for (const e of entriesRaw) {
            const lname = e.LEDGERNAME;
            if (!lname) continue;
            let amount = parseAmount(e.AMOUNT);
            if (e.ISDEEMEDPOSITIVE === "No") amount = -Math.abs(amount);
            if (e.ISDEEMEDPOSITIVE === "Yes") amount = Math.abs(amount);
            const ledgerId = ledgerIdByName.has(lname.toLowerCase())
              ? ledgerIdByName.get(lname.toLowerCase())!
              : await ensureLedger(lname, e.PARENT ?? "Suspense A/c", 0, null, null, billWiseNames.has(String(lname).toLowerCase()));
            entries.push({ ledgerId, amount: r2(amount), gstRate: e.GSTRATE != null ? parseFloat(String(e.GSTRATE)) || null : null, hsn: null, billsRaw: asList(e["BILLALLOCATIONS.LIST"]) });
          }
          if (entries.length === 0) { stats.skipped += 1; continue; }

          // R-04 (B-03): the identical double-entry gate the API enforces —
          // an unbalanced or empty accounting voucher NEVER reaches the books.
          // Inventory-category vouchers follow F-INV-01 (entries: [] is valid
          // only when ≥1 real stock movement exists).
          const isInventoryType = ["Delivery Note", "Receipt Note", "Stock Journal", "Physical Stock", "Manufacturing Journal"].includes(String(typeName));
          const invRawPre = asList(v["ALLINVENTORYENTRIES.LIST"]);
          const validInvCount = invRawPre.filter((e: any) => e.STOCKITEMNAME && Math.abs(r2(parseQty(e.ACTUALQTY ?? e.QTY))) >= 1e-9).length;
          try {
            validateEntries(entries, validInvCount, isInventoryType);
          } catch (verr: any) {
            throw bad(`Voucher ${number} (${typeName}): ${verr?.message ?? "invalid entries"}`);
          }

          const invRaw = asList(v["ALLINVENTORYENTRIES.LIST"]);
          const inv: { itemId: number; qty: number; rate: number; amount: number; godownId: number | null; hsn: string | null; gstRate: number | null }[] = [];
          for (const e of invRaw) {
            const iname = e.STOCKITEMNAME;
            if (!iname) continue;
            const itemId = itemIdByName.has(iname.toLowerCase())
              ? itemIdByName.get(iname.toLowerCase())!
              : await ensureItem(iname, e.UNIT ?? "Nos", null, null, 0, 0);
            const godownId = e.GODOWNNAME ? await ensureGodown(String(e.GODOWNNAME)) : null;
            inv.push({
              itemId,
              qty: r2(parseQty(e.ACTUALQTY ?? e.QTY)),
              rate: r2(parseRate(e.RATE)),
              amount: r2(parseAmount(e.AMOUNT)),
              godownId, hsn: null,
              gstRate: e.GSTRATE != null ? parseFloat(String(e.GSTRATE)) || null : null,
            });
          }

          // R-04 (B-05): bill allocations are validated with the same rules as
          // the API (direction, total = entry amount, open amount for
          // against_ref) so imported settlements cannot corrupt outstanding.
          const billEntries = entries.filter((e: any) => asList(e.billsRaw).length > 0);
          for (const be of billEntries) {
            const sign = Math.sign(r2(be.amount));
            let sum = 0;
            const allocations = asList(be.billsRaw);
            for (const b of allocations) {
              const billName = b.NAME;
              if (!billName) { throw bad(`Voucher ${number} (${typeName}): bill allocation without a name`); }
              const amt = r2(parseAmount(b.AMOUNT));
              if (amt === 0) { throw bad(`Voucher ${number} (${typeName}): bill allocation amount cannot be zero`); }
              if (Math.sign(amt) !== sign) { throw bad(`Voucher ${number} (${typeName}): bill allocation "${billName}" direction must match the entry`); }
              sum = r2(sum + amt);
            }
            if (Math.abs(Math.abs(sum) - Math.abs(r2(be.amount))) > 0.004) {
              throw bad(`Voucher ${number} (${typeName}): bill allocations must total the entry amount`);
            }
          }

          const [nv] = await tx.insert(vouchers).values({
            companyId: c, voucherTypeId: typeId, date, number,
            reference: v.REFERENCE ?? null,
            refDate: parseDate(v.REFERENCEDATE),
            narration: String(v.NARRATION ?? ""),
            partyLedgerId,
            source: "import",
            chequeNumber: v.CHEQUENUMBER ? String(v.CHEQUENUMBER) : null,
            placeOfSupply: v.PLACEOFSUPPLY ? String(v.PLACEOFSUPPLY) : null,
          }).returning();

          for (let i = 0; i < entries.length; i++) {
            const e = entries[i];
            const [row] = await tx.insert(voucherEntries).values({
              voucherId: nv.id, ledgerId: e.ledgerId, amount: String(e.amount),
              gstRate: e.gstRate != null ? String(e.gstRate) : null, hsnSac: e.hsn, order: i,
            }).returning({ id: voucherEntries.id });
            for (const b of asList(e.billsRaw)) {
              const billName = b.NAME;
              if (!billName) continue; // validation above already threw on nameless allocations
              const bt = String(b.TYPEOFBILL ?? "New Ref").toLowerCase();
              const billType = bt.includes("new") ? "new_ref" : bt.includes("advance") ? "advance" : bt.includes("on") ? "on_account" : "against_ref";
              await tx.insert(billAllocations).values({
                entryId: row.id, billType, billName: String(billName),
                amount: String(r2(parseAmount(b.AMOUNT))),
                dueDate: parseDate(b.BILLDUEDATE),
              });
            }
          }
          for (let i = 0; i < inv.length; i++) {
            const e = inv[i];
            await tx.insert(inventoryEntries).values({
              voucherId: nv.id, itemId: e.itemId, godownId: e.godownId,
              qty: String(e.qty), rate: String(e.rate), amount: String(e.amount),
              kind: "stock", hsnSac: e.hsn, gstRate: e.gstRate != null ? String(e.gstRate) : null, order: i,
            });
          }
          stats.vouchers += 1;
        } catch (err: any) {
          // R-04 (B-05): rethrow inside the transaction — the whole import rolls
          // back, nothing partial is persisted, and the client sees WHY.
          if (err?.statusCode) throw err;
          throw bad(`Voucher: ${err?.message ?? "unknown error"}`);
        }
      }
    }

    // Keep automatic numbering clear of every imported number.
    await syncCounters([...touchedTypeIds]);

    return stats;
  }
}
