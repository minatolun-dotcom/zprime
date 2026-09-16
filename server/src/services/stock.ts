import { db } from "../db/index.js";
import { companies, stockItems, inventoryEntries, vouchers, units } from "../db/schema.js";
import { and, asc, eq, lte, sql } from "drizzle-orm";
import { num, r2 } from "../lib/util.js";

export interface ItemStock {
  itemId: number; name: string; unit: string; decimals: number;
  openingQty: number; openingValue: number;
  inQty: number; inValue: number; outQty: number; outValue: number;
  closingQty: number; closingValue: number; closingRate: number;
  minQty: number;
}

/**
 * Stock summary per item up to `asOf`, processed chronologically.
 * Weighted average: outward cost = running average.
 * FIFO: outward consumes oldest lots first.
 */
export async function stockSummary(companyId: number, asOf: string, itemId?: number): Promise<ItemStock[]> {
  const items = await db
    .select({
      id: stockItems.id, name: stockItems.name, unit: units.symbol, decimals: units.decimalPlaces,
      openingQty: stockItems.openingQty, openingValue: stockItems.openingValue,
      costing: stockItems.costingMethod, minQty: stockItems.minQty,
    })
    .from(stockItems)
    .innerJoin(units, eq(units.id, stockItems.unitId))
    .where(eq(stockItems.companyId, companyId));

  const state = new Map<number, {
    openingQty: number; openingValue: number;
    inQty: number; inValue: number; outQty: number; outValue: number;
    runningQty: number; runningValue: number;
    fifoLots: { qty: number; rate: number }[];
    costing: string;
  }>();

  for (const it of items) {
    const oq = num(it.openingQty), ov = num(it.openingValue);
    state.set(it.id, {
      openingQty: oq, openingValue: ov, inQty: 0, inValue: 0, outQty: 0, outValue: 0,
      runningQty: oq, runningValue: ov, fifoLots: oq > 0 ? [{ qty: oq, rate: oq > 0 ? ov / oq : 0 }] : [],
      costing: it.costing,
    });
  }

  // All inventory movements up to asOf, per item in date order
  const rows = await db
    .select({
      itemId: inventoryEntries.itemId, qty: inventoryEntries.qty, rate: inventoryEntries.rate,
      amount: inventoryEntries.amount, kind: inventoryEntries.kind,
      date: vouchers.date, voucherId: vouchers.id, order: inventoryEntries.order,
    })
    .from(inventoryEntries)
    .innerJoin(vouchers, eq(vouchers.id, inventoryEntries.voucherId))
    .where(and(eq(vouchers.companyId, companyId), eq(vouchers.isCancelled, false), lte(vouchers.date, asOf)))
    .orderBy(asc(vouchers.date), asc(vouchers.id), asc(inventoryEntries.order));

  const apply = (itemId: number, qty: number, value: number, rate: number) => {
    const st = state.get(itemId);
    if (!st) return;
    if (qty > 0) {
      st.inQty = r2(st.inQty + qty);
      st.inValue = r2(st.inValue + value);
      st.runningQty = r2(st.runningQty + qty);
      st.runningValue = r2(st.runningValue + value);
      if (st.costing === "fifo" && qty > 0) st.fifoLots.push({ qty, rate: qty > 0 ? value / qty : rate });
    } else if (qty < 0) {
      const out = -qty;
      let cost = 0;
      if (st.costing === "fifo") {
        let remaining = out;
        while (remaining > 1e-9 && st.fifoLots.length > 0) {
          const lot = st.fifoLots[0];
          const take = Math.min(lot.qty, remaining);
          cost += take * lot.rate;
          lot.qty = r2(lot.qty - take);
          remaining = r2(remaining - take);
          if (lot.qty <= 1e-9) st.fifoLots.shift();
        }
      } else {
        // R-06 (B-01): cap outward cost at the value actually held. Charging
        // WAVG on more units than exist invents cost for units that never
        // existed (drives runningValue deeply negative, later "recovered" by
        // the old clamp as phantom profit). When qty <= 0 the marginal units
        // genuinely carry no recorded cost, so the charge is the held value.
        const heldQty = Math.max(st.runningQty, 0);
        const heldValue = Math.max(st.runningValue, 0);
        cost = heldQty > 1e-9 ? r2(Math.min(out, heldQty) * (heldValue / heldQty)) : 0;
      }
      st.outQty = r2(st.outQty + out);
      st.outValue = r2(st.outValue + cost);
      st.runningQty = r2(st.runningQty - out);
      st.runningValue = r2(st.runningValue - cost);
      // R-06: the silent negative-value clamp is GONE. With the posting-time
      // guard (default) running value can no longer go negative; with the
      // company opt-in the negative value is the HONEST representation of
      // stock sold beyond held value and is shown as such (negative closing
      // value, negative COGS contribution) instead of being laundered to 0.
    }
  };

  for (const row of rows) {
    if (itemId && row.itemId !== itemId) continue;
    const st = state.get(row.itemId);
    if (!st) continue;
    const qty = num(row.qty);
    if (row.kind === "physical") {
      // Physical stock voucher: sets closing qty -> apply diff at running avg
      const diff = r2(qty - st.runningQty);
      const avg = st.runningQty > 1e-9 ? st.runningValue / st.runningQty : num(row.rate);
      if (Math.abs(diff) > 1e-9) apply(row.itemId, diff, r2(Math.abs(diff) * avg), avg);
    } else {
      const amount = num(row.amount) || r2(Math.abs(qty) * num(row.rate));
      apply(row.itemId, qty, qty > 0 ? amount : amount, num(row.rate));
    }
  }

  return items
    .filter((it) => (!itemId || it.id === itemId))
    .map((it) => {
      const st = state.get(it.id)!;
      const closingQty = st.runningQty;
      // R-06: report the engine's true running value. Under the default guard
      // it cannot be negative; under the explicit opt-in a negative value is
      // honest information, not an artifact to hide.
      const closingValue = st.runningValue;
      return {
        itemId: it.id, name: it.name, unit: it.unit, decimals: it.decimals,
        openingQty: st.openingQty, openingValue: st.openingValue,
        inQty: st.inQty, inValue: st.inValue, outQty: st.outQty, outValue: st.outValue,
        closingQty, closingValue,
        closingRate: closingQty > 1e-9 ? r2(closingValue / closingQty) : 0,
        minQty: num(it.minQty),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Total closing stock value, optionally restricted to a stock group name. */
export async function stockClosingValue(companyId: number, asOf: string, _groupName?: string): Promise<number> {
  const rows = await stockSummary(companyId, asOf);
  return r2(rows.reduce((s, r) => s + r.closingValue, 0));
}
