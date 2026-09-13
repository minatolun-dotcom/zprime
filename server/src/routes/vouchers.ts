import { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import {
  vouchers, voucherEntries, billAllocations, inventoryEntries, voucherTypes, ledgers,
  stockItems, godowns, tdsSections, voucherCounters, payslips,
} from "../db/schema.js";
import { and, asc, desc, eq, gte, lte, ne, lt, sql, inArray } from "drizzle-orm";
import { cid, bad, voucherSchema, pgFriendly, pgCode, type VoucherInput } from "../lib/routes.js";
import { r2, num } from "../lib/util.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ---------- lookups (inside the caller's transaction) ----------
async function assertTypeTx(tx: Tx, companyId: number, typeId: number) {
  const [t] = await tx.select().from(voucherTypes).where(and(eq(voucherTypes.companyId, companyId), eq(voucherTypes.id, typeId)));
  if (!t) throw bad("Voucher type not found");
  return t;
}

/** Every referenced ledger must belong to this company. An empty ledger-id list
 *  is NOT rejected here: F-INV-01 allows inventory-category vouchers to be
 *  inventory-only (entries: []). Double-entry safety is enforced afterwards by
 *  validateEntries(), which still rejects empty/unbalanced accounting vouchers —
 *  so no other voucher type can pass with zero ledger rows. */
async function assertLedgersTx(tx: Tx, companyId: number, ledgerIds: (number | null | undefined)[]) {
  const ids = [...new Set(ledgerIds.filter((x): x is number => typeof x === "number" && Number.isFinite(x) && x > 0))];
  if (ids.length === 0) return;
  const rows = await tx.select({ id: ledgers.id }).from(ledgers).where(and(eq(ledgers.companyId, companyId), inArray(ledgers.id, ids)));
  if (rows.length !== ids.length) throw bad("Unknown ledger in entries");
}

/** Every referenced master (items, godowns, TDS sections) must belong to this company. */
async function assertRefsTx(tx: Tx, companyId: number, input: VoucherInput) {
  const itemIds = [...new Set((input.inventoryEntries ?? []).map((i) => i.itemId))];
  if (itemIds.length > 0) {
    const rows = await tx.select({ id: stockItems.id }).from(stockItems).where(and(eq(stockItems.companyId, companyId), inArray(stockItems.id, itemIds)));
    if (rows.length !== itemIds.length) throw bad("Unknown stock item in inventory entries");
  }
  const godownIds = [...new Set((input.inventoryEntries ?? []).map((i) => i.godownId).filter((g): g is number => typeof g === "number" && g > 0))];
  if (godownIds.length > 0) {
    const rows = await tx.select({ id: godowns.id }).from(godowns).where(and(eq(godowns.companyId, companyId), inArray(godowns.id, godownIds)));
    if (rows.length !== godownIds.length) throw bad("Unknown godown in inventory entries");
  }
  const tdsIds = [...new Set(input.entries.map((e) => e.tdsSectionId).filter((t): t is number => typeof t === "number" && t > 0))];
  if (tdsIds.length > 0) {
    const rows = await tx.select({ id: tdsSections.id }).from(tdsSections).where(and(eq(tdsSections.companyId, companyId), inArray(tdsSections.id, tdsIds)));
    if (rows.length !== tdsIds.length) throw bad("Unknown TDS section in entries");
  }
}

// ---------- double entry ----------
/** Accounting vouchers reject zero-amount entries and zero totals outright.
 *  Inventory-category vouchers (Stock Journal, Physical Stock, Delivery/
 *  Receipt Note, Mfg Journal) may be inventory-only (entries: []) when valid
 *  inventory rows exist — that is a legitimate entry (F-INV-01).
 *  Still rejected: unbalanced amounts, or a completely empty voucher. */
/** Inventory rows that represent a real movement: an item + non-zero qty.
 *  Used to decide whether an inventory-category voucher legitimately carries
 *  zero accounting entries (F-INV-01). */
function validInventoryCount(input: VoucherInput): number {
  return (input.inventoryEntries ?? []).filter((ie) => ie.itemId > 0 && Math.abs(r2(ie.qty)) >= 1e-9).length;
}

/** A physical count is an absolute quantity — a negative "counted qty" is
 *  meaningless and would drive stock deeply negative. */
function assertPhysicalRows(input: VoucherInput, isPhysicalType: boolean) {
  if (!isPhysicalType) return;
  for (const ie of input.inventoryEntries ?? []) {
    if (ie.qty < -1e-9) throw bad("Physical Stock counted quantity cannot be negative");
  }
}

function validateEntries(entries: { amount: number }[], inventoryCount: number, isInventoryType: boolean) {
  const total = r2(entries.reduce((s, e) => s + e.amount, 0));
  if (Math.abs(total) > 0.004) throw bad(`Debits and credits do not balance (difference ${total.toFixed(2)})`);
  if (isInventoryType) {
    const hasNonZero = entries.some((e) => Math.abs(r2(e.amount)) >= 0.005);
    if (!hasNonZero && inventoryCount === 0) throw bad("Inventory voucher needs inventory entries or non-zero ledger entries");
    return;
  }
  if (entries.length === 0) throw bad("Voucher needs at least one entry");
  for (const e of entries) {
    if (!Number.isFinite(e.amount) || Math.abs(r2(e.amount)) < 0.005) throw bad("Entry amount cannot be zero");
  }
  const gross = r2(entries.reduce((s, e) => s + Math.abs(e.amount), 0));
  if (gross < 0.005) throw bad("Voucher total cannot be zero");
}

// ---------- numbering ----------
/**
 * Draw the next voucher number atomically. A per-(company, voucherType) counter
 * row is advanced with UPDATE ... RETURNING under row lock, so concurrent
 * writers can never draw the same number and deletion never rewinds it.
 * The unique index on (companyId, voucherTypeId, number) is the final authority.
 */
export async function nextNumber(tx: Tx, companyId: number, typeId: number): Promise<string> {
  const [t] = await tx.select().from(voucherTypes).where(eq(voucherTypes.id, typeId));
  const start = t.startNumber ?? 1;
  // Initialize the counter to startNumber-1 if this is the first voucher of the type.
  await tx.insert(voucherCounters).values({ companyId, voucherTypeId: typeId, lastNumber: start - 1 }).onConflictDoNothing();
  const [c] = await tx
    .update(voucherCounters)
    .set({ lastNumber: sql`${voucherCounters.lastNumber} + 1` })
    .where(and(eq(voucherCounters.companyId, companyId), eq(voucherCounters.voucherTypeId, typeId)))
    .returning({ lastNumber: voucherCounters.lastNumber });
  let n = c.lastNumber;
  if (n < start) {
    const [c2] = await tx
      .update(voucherCounters)
      .set({ lastNumber: sql`GREATEST(${voucherCounters.lastNumber}, ${start})` })
      .where(and(eq(voucherCounters.companyId, companyId), eq(voucherCounters.voucherTypeId, typeId), lt(voucherCounters.lastNumber, start)))
      .returning({ lastNumber: voucherCounters.lastNumber });
    n = c2 ? c2.lastNumber : start;
  }
  return `${t.prefix ?? ""}${n}${t.suffix ?? ""}`;
}

/** Pull all bill-wise party ledger rows used by this voucher, in stable id order, FOR UPDATE.
 *  This serializes concurrent allocations against the same party. */
async function lockPartyLedgers(tx: Tx, entries: { ledgerId: number; bills?: { billName: string }[] }[]) {
  const ids = [...new Set(entries.filter((e) => (e.bills?.length ?? 0) > 0).map((e) => e.ledgerId))].sort((a, b) => a - b);
  if (ids.length === 0) return;
  await tx.select({ id: ledgers.id }).from(ledgers).where(inArray(ledgers.id, ids)).for("update");
}

// ---------- shared settled-bill guard (R-02) ----------
/** R-02: DELETE and CANCEL share ONE settled-bill integrity rule.
 *
 *  DELETE: blocking is correct — deleting a voucher physically destroys its bill
 *  rows, so settlements by other vouchers would dangle and corrupt outstanding.
 *
 *  CANCEL: the voucher's bill rows SURVIVE (they are read only through non-
 *  cancelled vouchers), so its own open bills simply become invisible to future
 *  settlements and its settled bills keep their settlement history intact —
 *  that is exactly Tally-style cancellation, so cancellation is NOT blocked by
 *  settled bills.
 *
 *  What BOTH must reject: cancelling/deleting a voucher that itself CONTAINS
 *  settlements (against_ref) of another voucher's bills — that would make the
 *  settled bill reappear as open without removing the settlement history.
 *  (Settlements die with the voucher's body rows; Model A never resurrects
 *  them on uncancel.)
 */
async function assertNoOutgoingSettlementsTx(tx: Tx, companyId: number, voucherId: number) {
  const mine = await tx
    .select({ billName: billAllocations.billName, billType: billAllocations.billType })
    .from(billAllocations)
    .innerJoin(voucherEntries, eq(voucherEntries.id, billAllocations.entryId))
    .where(eq(voucherEntries.voucherId, voucherId));
  const settleNames = [...new Set(mine.filter((m) => m.billType === "against_ref").map((m) => m.billName))];
  if (settleNames.length === 0) return;
  const targets = await tx
    .select({ ledgerId: voucherEntries.ledgerId, billName: billAllocations.billName })
    .from(billAllocations)
    .innerJoin(voucherEntries, eq(voucherEntries.id, billAllocations.entryId))
    .innerJoin(vouchers, eq(vouchers.id, voucherEntries.voucherId))
    .where(and(
      eq(vouchers.companyId, companyId),
      eq(vouchers.isCancelled, false),
      eq(billAllocations.billType, "new_ref"),
      inArray(billAllocations.billName, settleNames),
      ne(voucherEntries.voucherId, voucherId),
    ));
  if (targets.length > 0) {
    throw bad("Cannot cancel or delete: this voucher settles bills on other vouchers. Edit or cancel the settling allocations out first.", 409);
  }
}

// ---------- bill-wise validation ----------
/**
 * Invariants enforced here (server-side; the client is never trusted):
 *  1. Only bill-wise ledgers can carry bill allocations.
 *  2. Every allocation's direction (sign) matches its entry's direction.
 *  3. Allocations on an entry must total exactly the entry amount.
 *  4. An "against_ref" allocation must reference an open bill on the SAME
 *     ledger with the opposite sign (i.e. something actually outstanding),
 *     and may not exceed the open amount — including amounts consumed
 *     earlier in the same voucher.
 * Open amount of a bill = sum of every allocation with the same
 * (ledgerId, billName) across the company's non-cancelled vouchers.
 */
async function validateBillsTx(tx: Tx, companyId: number, entries: VoucherInput["entries"], excludeVoucherId?: number) {
  const billEntries = entries.filter((e) => (e.bills?.length ?? 0) > 0);
  if (billEntries.length === 0) return;

  await lockPartyLedgers(tx, billEntries);

  const ledgerIds = [...new Set(billEntries.map((e) => e.ledgerId))];
  const lrows = await tx.select({ id: ledgers.id, billWise: ledgers.billWise }).from(ledgers).where(inArray(ledgers.id, ledgerIds));
  const billWise = new Map(lrows.map((l) => [l.id, l.billWise]));
  for (const e of billEntries) {
    if (!billWise.get(e.ledgerId)) throw bad("Ledger is not enabled for bill-wise details");
  }

  // A-02 invariant: a bill allocation must ALWAYS resolve to the intended
  // outstanding bill. Bills are identified by (party ledger, bill name) — so a
  // NEW bill whose name already exists on the same party ledger (any voucher
  // type, any other voucher) would merge into that bill and corrupt outstanding.
  // The party rows are locked above, so this check is race-safe.
  const newRefs = billEntries.flatMap((e) =>
    e.bills!.filter((b) => b.billType === "new_ref" || b.billType === "advance").map((b) => ({ ledgerId: e.ledgerId, name: b.billName.trim() }))
  );
  if (newRefs.length > 0) {
    const names = [...new Set(newRefs.map((n) => n.name))];
    const conds = [
      eq(vouchers.companyId, companyId),
      eq(vouchers.isCancelled, false),
      inArray(billAllocations.billName, names),
    ];
    // When EDITING a voucher, its own previous allocations are still in the DB
    // (the PUT deletes+rewrites the body later in the same transaction) — they
    // must not collide with the voucher's own rewritten bill names.
    if (excludeVoucherId != null) conds.push(ne(voucherEntries.voucherId, excludeVoucherId));
    const existing = await tx
      .select({ ledgerId: voucherEntries.ledgerId, billName: billAllocations.billName })
      .from(billAllocations)
      .innerJoin(voucherEntries, eq(voucherEntries.id, billAllocations.entryId))
      .innerJoin(vouchers, eq(vouchers.id, voucherEntries.voucherId))
      .where(and(...conds));
    const taken = new Set(existing.map((r) => `${r.ledgerId}::${r.billName}`));
    // Also enforce uniqueness WITHIN this voucher's own new refs.
    const seen = new Set<string>();
    for (const n of newRefs) {
      const key = `${n.ledgerId}::${n.name}`;
      if (taken.has(key) || seen.has(key)) {
        throw bad(`Bill name "${n.name}" already exists on this party ledger. Use a unique bill name (auto-numbered bills include the voucher type prefix).`, 409);
      }
      seen.add(key);
    }
  }

  // Bill names we must verify as open bills
  const wantedNames = [...new Set(billEntries.flatMap((e) => e.bills!.filter((b) => b.billType === "against_ref").map((b) => b.billName.trim())))];
  const open = new Map<string, number>(); // key: ledgerId::billName
  if (wantedNames.length > 0) {
    const rows = await tx
      .select({ ledgerId: voucherEntries.ledgerId, billName: billAllocations.billName, amount: billAllocations.amount })
      .from(billAllocations)
      .innerJoin(voucherEntries, eq(voucherEntries.id, billAllocations.entryId))
      .innerJoin(vouchers, eq(vouchers.id, voucherEntries.voucherId))
      .where(and(eq(vouchers.companyId, companyId), eq(vouchers.isCancelled, false), inArray(billAllocations.billName, wantedNames)));
    for (const r of rows) {
      const key = `${r.ledgerId}::${r.billName}`;
      open.set(key, r2((open.get(key) ?? 0) + num(r.amount)));
    }
  }

  for (const e of billEntries) {
    const sign = Math.sign(r2(e.amount));
    let sum = 0;
    const consumed = new Map<string, number>();
    for (const b of e.bills!) {
      const amt = r2(b.amount);
      if (amt === 0) throw bad("Bill allocation amount cannot be zero");
      if (Math.sign(amt) !== sign) throw bad(`Bill allocation "${b.billName}" direction must match the entry`);
      sum = r2(sum + amt);
      if (b.billType === "against_ref") {
        const key = `${e.ledgerId}::${b.billName.trim()}`;
        const avail = r2((open.get(key) ?? 0) + (consumed.get(key) ?? 0));
        if (Math.abs(avail) < 0.005) throw bad(`Bill "${b.billName}" has no open amount to settle`);
        if (Math.sign(amt) !== -Math.sign(avail)) throw bad(`Bill "${b.billName}" is not open in the expected direction`);
        if (Math.abs(amt) > Math.abs(avail) + 0.004) throw bad(`Allocation exceeds open amount for bill "${b.billName}"`);
        consumed.set(key, r2((consumed.get(key) ?? 0) + amt));
      }
    }
    if (Math.abs(Math.abs(sum) - Math.abs(e.amount)) > 0.004) throw bad("Bill allocations must total the entry amount");
  }
}

// ---------- body writer (entries, bills, inventory) ----------
async function writeBody(tx: Tx, voucherId: number, input: VoucherInput) {
  for (let i = 0; i < input.entries.length; i++) {
    const e = input.entries[i];
    const [row] = await tx
      .insert(voucherEntries)
      .values({
        voucherId,
        ledgerId: e.ledgerId,
        amount: String(r2(e.amount)),
        gstRate: e.gstRate != null ? String(e.gstRate) : null,
        hsnSac: e.hsnSac ?? null,
        tdsSectionId: e.tdsSectionId ?? null,
        order: i,
      })
      .returning({ id: voucherEntries.id });
    for (const b of e.bills ?? []) {
      await tx.insert(billAllocations).values({
        entryId: row.id,
        billType: b.billType,
        billName: b.billName,
        amount: String(r2(b.amount)),
        dueDate: b.dueDate ?? null,
      });
    }
  }

  for (let i = 0; i < (input.inventoryEntries ?? []).length; i++) {
    const ie = input.inventoryEntries[i];
    await tx.insert(inventoryEntries).values({
      voucherId,
      itemId: ie.itemId,
      godownId: ie.godownId ?? null,
      qty: String(r2(ie.qty)),
      rate: String(r2(ie.rate)),
      amount: String(r2(ie.amount)),
      kind: ie.kind,
      hsnSac: ie.hsnSac ?? null,
      gstRate: ie.gstRate != null ? String(ie.gstRate) : null,
      order: i,
    });
  }
}

async function insertVoucherTx(tx: Tx, companyId: number, input: VoucherInput, source: string) {
  const type = await assertTypeTx(tx, companyId, input.voucherTypeId);
  await assertLedgersTx(tx, companyId, [...input.entries.map((e) => e.ledgerId), input.partyLedgerId]);
  await assertRefsTx(tx, companyId, input);
  assertPhysicalRows(input, type.name === "Physical Stock");
  validateEntries(input.entries, validInventoryCount(input), type.category === "Inventory");
  const number = input.number?.trim() || (await nextNumber(tx, companyId, input.voucherTypeId));
  await validateBillsTx(tx, companyId, input.entries);

  const [v] = await tx
    .insert(vouchers)
    .values({
      companyId,
      voucherTypeId: input.voucherTypeId,
      date: input.date,
      number,
      reference: input.reference ?? null,
      refDate: input.refDate ?? null,
      narration: input.narration ?? "",
      partyLedgerId: input.partyLedgerId ?? null,
      source,
      chequeNumber: input.chequeNumber ?? null,
      chequeDate: input.chequeDate ?? null,
      placeOfSupply: input.placeOfSupply ?? null,
    })
    .returning();

  await writeBody(tx, v.id, input);
  return v;
}

export default async function voucherRoutes(app: FastifyInstance) {
  // List vouchers (Day Book) with filters
  app.get("/vouchers", async (req) => {
    const c = await cid(req);
    const q = req.query as any;
    const conds = [eq(vouchers.companyId, c)];
    if (q.from) conds.push(gte(vouchers.date, q.from));
    if (q.to) conds.push(lte(vouchers.date, q.to));
    if (q.type) conds.push(eq(vouchers.voucherTypeId, parseInt(q.type, 10)));
    const rows = await db
      .select({
        id: vouchers.id, date: vouchers.date, number: vouchers.number,
        reference: vouchers.reference, narration: vouchers.narration,
        partyLedgerId: vouchers.partyLedgerId,
        partyName: ledgers.name,
        typeId: voucherTypes.id, typeName: voucherTypes.name, shortCode: voucherTypes.shortCode,
        isCancelled: vouchers.isCancelled, source: vouchers.source,
        amount: sql<number>`coalesce((select sum(amount) from voucher_entries e where e.voucher_id = ${vouchers.id} and e.amount > 0), 0)::float8`,
      })
      .from(vouchers)
      .innerJoin(voucherTypes, eq(voucherTypes.id, vouchers.voucherTypeId))
      .leftJoin(ledgers, eq(ledgers.id, vouchers.partyLedgerId))
      .where(and(...conds))
      .orderBy(desc(vouchers.date), asc(vouchers.id))
      .limit(5000);
    return rows;
  });

  // Full voucher detail
  app.get("/vouchers/:id", async (req) => {
    const c = await cid(req);
    const id = parseInt((req.params as any).id, 10);
    const [v] = await db
      .select()
      .from(vouchers)
      .where(and(eq(vouchers.companyId, c), eq(vouchers.id, id)));
    if (!v) throw bad("Voucher not found", 404);
    const entries = await db
      .select({
        id: voucherEntries.id, ledgerId: voucherEntries.ledgerId, ledgerName: ledgers.name,
        amount: voucherEntries.amount, gstRate: voucherEntries.gstRate, hsnSac: voucherEntries.hsnSac,
        tdsSectionId: voucherEntries.tdsSectionId, order: voucherEntries.order,
      })
      .from(voucherEntries)
      .innerJoin(ledgers, eq(ledgers.id, voucherEntries.ledgerId))
      .where(eq(voucherEntries.voucherId, id))
      .orderBy(asc(voucherEntries.order));
    const bills = await db
      .select({ entryId: billAllocations.entryId, billType: billAllocations.billType, billName: billAllocations.billName, amount: billAllocations.amount, dueDate: billAllocations.dueDate })
      .from(billAllocations)
      .innerJoin(voucherEntries, eq(voucherEntries.id, billAllocations.entryId))
      .where(eq(voucherEntries.voucherId, id));
    const inv = await db
      .select()
      .from(inventoryEntries)
      .where(eq(inventoryEntries.voucherId, id))
      .orderBy(asc(inventoryEntries.order));
    const [type] = await db.select().from(voucherTypes).where(eq(voucherTypes.id, v.voucherTypeId));
    return { ...v, type, entries: entries.map((e) => ({ ...e, amount: num(e.amount), bills: bills.filter((b) => b.entryId === e.id) })), inventoryEntries: inv.map((e) => ({ ...e, qty: num(e.qty), rate: num(e.rate), amount: num(e.amount) })) };
  });

  // Peek the next auto number without consuming it
  app.get("/vouchers/next-number", async (req) => {
    const c = await cid(req);
    const typeId = parseInt((req.query as any).voucherTypeId, 10);
    const [t] = await db.select().from(voucherTypes).where(and(eq(voucherTypes.companyId, c), eq(voucherTypes.id, typeId)));
    if (!t) throw bad("Voucher type not found", 404);
    const [ctr] = await db.select().from(voucherCounters).where(and(eq(voucherCounters.companyId, c), eq(voucherCounters.voucherTypeId, typeId)));
    const last = ctr?.lastNumber ?? (t.startNumber ?? 1) - 1;
    const n = Math.max(last + 1, t.startNumber ?? 1);
    return { number: `${t.prefix ?? ""}${n}${t.suffix ?? ""}` };
  });

  app.post("/vouchers", async (req) => {
    const c = await cid(req);
    const parsed = voucherSchema.safeParse(req.body);
    if (!parsed.success) throw bad("Invalid voucher: " + parsed.error.issues[0]?.message);
    const input = parsed.data;
    const manual = !!input.number?.trim();
    // A transaction rollback undoes the counter draw, so a retry inside the next
    // transaction would redraw the same colliding number. On a unique-index
    // collision for automatic numbering, burn numbers OUTSIDE the transaction
    // so the next attempt advances past the stale counter value.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await db.transaction(async (tx) => insertVoucherTx(tx, c, input, "manual"));
      } catch (err: any) {
        if (!manual && pgCode(err) === "23505") {
          try {
            await db.transaction(async (tx) => {
              await nextNumber(tx, c, input.voucherTypeId);
            });
          } catch { /* counter init race — the retry itself re-inits */ }
          continue;
        }
        throw pgFriendly(err);
      }
    }
    throw bad("Could not allocate a unique voucher number", 409);
  });

  app.put("/vouchers/:id", async (req) => {
    const c = await cid(req);
    const id = parseInt((req.params as any).id, 10);
    const parsed = voucherSchema.safeParse(req.body);
    if (!parsed.success) throw bad("Invalid voucher: " + parsed.error.issues[0]?.message);
    const input = parsed.data;
    try {
      return await db.transaction(async (tx) => {
        const [existing] = await tx.select().from(vouchers).where(and(eq(vouchers.companyId, c), eq(vouchers.id, id))).for("update");
        if (!existing) throw bad("Voucher not found", 404);
        // R-02: a cancelled voucher is frozen — date, party, entries, inventory,
        // GST, bills, narration, amounts must all stay untouched. The only legal
        // transition is the dedicated /uncancel endpoint.
        if (existing.isCancelled) throw bad("Cancelled vouchers cannot be edited. Uncancel the voucher first.", 409);
        const type = await assertTypeTx(tx, c, input.voucherTypeId);
        await assertLedgersTx(tx, c, [...input.entries.map((e) => e.ledgerId), input.partyLedgerId]);
        await assertRefsTx(tx, c, input);
        assertPhysicalRows(input, type.name === "Physical Stock");
        validateEntries(input.entries, validInventoryCount(input), type.category === "Inventory");
        const number = input.number?.trim() || existing.number;
        await validateBillsTx(tx, c, input.entries, id);

        await tx
          .update(vouchers)
          .set({
            voucherTypeId: input.voucherTypeId,
            date: input.date,
            number,
            reference: input.reference ?? null,
            refDate: input.refDate ?? null,
            narration: input.narration ?? "",
            partyLedgerId: input.partyLedgerId ?? null,
            chequeNumber: input.chequeNumber ?? null,
            chequeDate: input.chequeDate ?? null,
            placeOfSupply: input.placeOfSupply ?? null,
          })
          .where(eq(vouchers.id, id));

        await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, id));
        await tx.delete(inventoryEntries).where(eq(inventoryEntries.voucherId, id));
        await writeBody(tx, id, input);
        return { id };
      });
    } catch (err: any) {
      throw pgFriendly(err);
    }
  });

  // ---- R-02 voucher cancellation (Model A: mark + exclude) ----
  // The voucher row, its number and all body rows (entries / inventory / bills)
  // are preserved; every active report, inventory, GST and bill calculation
  // already excludes isCancelled = true, so the marked voucher becomes logically
  // inactive with no reversal journal. /uncancel restores the exact prior state.
  app.post("/vouchers/:id/cancel", async (req) => {
    const c = await cid(req);
    const id = parseInt((req.params as any).id, 10);
    if (!Number.isFinite(id) || id <= 0) throw bad("Invalid voucher id");
    // Optional, trimmable reason with the app's standard free-text cap.
    let reason: string | null = null;
    const body = req.body as any;
    if (body?.reason != null) {
      if (typeof body.reason !== "string") throw bad("Cancellation reason must be a string");
      reason = body.reason.trim().slice(0, 200) || null;
    }
    try {
      return await db.transaction(async (tx) => {
        const [v] = await tx.select().from(vouchers).where(and(eq(vouchers.companyId, c), eq(vouchers.id, id))).for("update");
        if (!v) throw bad("Voucher not found", 404);
        if (v.isCancelled) throw bad("Voucher is already cancelled", 409);
        // Same integrity rule as delete: must not strand settlements it holds
        // against other vouchers' bills. Settled bills ON this voucher are fine
        // — the bill rows survive cancellation (Model A).
        await assertNoOutgoingSettlementsTx(tx, c, id);
        await tx
          .update(vouchers)
          .set({
            isCancelled: true,
            cancelledAt: new Date(),
            cancelReason: reason,
            cancelledBy: typeof req.userId === "number" && req.userId > 0 ? req.userId : null,
          })
          .where(eq(vouchers.id, id));
        return { ok: true, id, isCancelled: true };
      });
    } catch (err: any) {
      throw pgFriendly(err);
    }
  });

  // ---- R-02 uncancel: restore the cancelled voucher to active ----
  // No body rows are recreated — cancellation never removed them. Numbering is
  // untouched (the counter never rewound), but re-activating MUST respect the
  // unique (company, type, number) index if a same-number voucher was created
  // while this one was cancelled.
  app.post("/vouchers/:id/uncancel", async (req) => {
    const c = await cid(req);
    const id = parseInt((req.params as any).id, 10);
    if (!Number.isFinite(id) || id <= 0) throw bad("Invalid voucher id");
    try {
      return await db.transaction(async (tx) => {
        const [v] = await tx.select().from(vouchers).where(and(eq(vouchers.companyId, c), eq(vouchers.id, id))).for("update");
        if (!v) throw bad("Voucher not found", 404);
        if (!v.isCancelled) throw bad("Voucher is not cancelled", 409);
        // If another (still active) voucher of the same type took this number
        // while this one was cancelled, restoring would collide — the DB unique
        // index is the authority, but we fail with a clear application error.
        const [clash] = await tx
          .select({ id: vouchers.id, number: vouchers.number })
          .from(vouchers)
          .where(and(
            eq(vouchers.companyId, c), eq(vouchers.voucherTypeId, v.voucherTypeId),
            eq(vouchers.number, v.number), eq(vouchers.isCancelled, false), ne(vouchers.id, id),
          ));
        if (clash) throw bad(`Cannot uncancel: voucher number ${v.number} has been reissued to another voucher. Delete or cancel the other voucher first.`, 409);
        // A payroll voucher being restored must not collide with a payroll run
        // processed for the same month while it was cancelled (payslip unique
        // index). Reuse the same detection as the payroll route.
        if (v.source === "payroll") {
          const narration = v.narration ?? "";
          const m = narration.match(/Payroll for ([A-Za-z]+) (\d{4})/);
          if (m) {
            const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
            const mi = months.indexOf(m[1]);
            if (mi >= 0) {
              const month = `${m[2]}-${String(mi + 1).padStart(2, "0")}`;
              const [{ cnt }] = await tx
                .select({ cnt: sql<number>`count(*)::int` })
                .from(payslips)
                .where(and(eq(payslips.companyId, c), eq(payslips.month, month), ne(payslips.voucherId, id)));
              if (cnt > 0) throw bad(`Cannot uncancel: payroll for ${month} has been processed again. Cancel the newer payroll voucher first.`, 409);
            }
          }
        }
        await tx
          .update(vouchers)
          .set({ isCancelled: false, cancelledAt: null, cancelReason: null, cancelledBy: null })
          .where(eq(vouchers.id, id));
        return { ok: true, id, isCancelled: false };
      });
    } catch (err: any) {
      throw pgFriendly(err);
    }
  });

  app.delete("/vouchers/:id", async (req) => {
    const c = await cid(req);
    const id = parseInt((req.params as any).id, 10);
    try {
      return await db.transaction(async (tx) => {
        const [existing] = await tx.select().from(vouchers).where(and(eq(vouchers.companyId, c), eq(vouchers.id, id))).for("update");
        if (!existing) throw bad("Voucher not found", 404);

        // R-02: cancelled vouchers are the audit-preserving state and cannot be
        // hard-deleted. Uncancel first; normal delete rules then apply.
        if (existing.isCancelled) {
          throw bad("Cancelled vouchers cannot be deleted. Uncancel the voucher first.", 409);
        }

        // Guard: a voucher whose own bills (new_ref / advance) are settled by
        // OTHER vouchers cannot be deleted — deleting it would strand the
        // settlements and corrupt outstanding balances.
        const mine = await tx
          .select({ ledgerId: voucherEntries.ledgerId, billName: billAllocations.billName, billType: billAllocations.billType })
          .from(billAllocations)
          .innerJoin(voucherEntries, eq(voucherEntries.id, billAllocations.entryId))
          .where(eq(voucherEntries.voucherId, id));
        const created = mine.filter((m) => m.billType === "new_ref" || m.billType === "advance");
        if (created.length > 0) {
          const names = [...new Set(created.map((k) => k.billName))];
          const refs = await tx
            .select({ ledgerId: voucherEntries.ledgerId, billName: billAllocations.billName })
            .from(billAllocations)
            .innerJoin(voucherEntries, eq(voucherEntries.id, billAllocations.entryId))
            .innerJoin(vouchers, eq(vouchers.id, voucherEntries.voucherId))
            .where(and(eq(vouchers.companyId, c), eq(billAllocations.billType, "against_ref"), inArray(billAllocations.billName, names), ne(voucherEntries.voucherId, id)));
          const keys = new Set(created.map((k) => `${k.ledgerId}::${k.billName}`));
          if (refs.some((r) => keys.has(`${r.ledgerId}::${r.billName}`))) {
            throw bad("Cannot delete: bills on this voucher are settled by other vouchers. Delete or edit the settling vouchers first.");
          }
        }

        // R-02: deleting a voucher that itself settles other vouchers' bills
        // would make those bills reappear open while the settlements vanish —
        // shared with cancel (same accounting integrity rule).
        await assertNoOutgoingSettlementsTx(tx, c, id);
        if (existing.source === "payroll") {
          // R-02 payroll safety: the voucher's payslips carry the processed-month
          // guard (pslip_emp_month_uq). Hard-deleting the voucher would cascade
          // the payslips and silently make the month reprocessable — double salary
          // is one keystroke away. Cancellation is the correct removal path.
          throw bad("Payroll vouchers cannot be deleted. Cancel the payroll voucher instead — payslips and the processed-month guard are preserved.", 409);
        }

        await tx.delete(vouchers).where(and(eq(vouchers.companyId, c), eq(vouchers.id, id)));
        return { ok: true };
      });
    } catch (err: any) {
      throw pgFriendly(err);
    }
  });
}
