import type { Id, OrderDetail, OrderItem } from "@/lib/api/types";

// The arithmetic of the final bill, as the API does it: what a confirmation
// restates before a correction, a completed return or a refunded report must
// be the amount the credit note will carry.

/**
 * What `kept` units of a line cost: the unit price less their part of the
 * line's discount code (26) and of the coins redeemed on it (30).
 */
export function keptLineTotal(
  item: Pick<
    OrderItem,
    "quantity" | "unitPrice" | "discountAmount" | "rewardAmount"
  >,
  kept: number,
): number {
  const partOf = (amount: number) =>
    item.quantity > 0 ? Math.round((amount * kept) / item.quantity) : 0;
  return (
    kept * item.unitPrice -
    partOf(item.discountAmount) -
    partOf(item.rewardAmount ?? 0)
  );
}

/**
 * What the goods of the final bill fall by when `units` more of each pack
 * size are credited (a completed return, a report resolved with a refund).
 * Without a discount code and without coins this is units × unit price;
 * with them, the customer gets back what was paid for the units, not their
 * list price. The delivery fee is not part of it.
 */
export function creditForUnits(
  order: Pick<OrderDetail, "items">,
  units: Readonly<Record<Id, number>>,
): number {
  return order.items.reduce((sum, item) => {
    const taken = units[item.variantId] ?? 0;
    if (taken <= 0) return sum;
    const kept = Math.max(0, item.deliveredQuantity - item.returnedQuantity);
    return (
      sum +
      keptLineTotal(item, kept) -
      keptLineTotal(item, Math.max(0, kept - taken))
    );
  }, 0);
}
