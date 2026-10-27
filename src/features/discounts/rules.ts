import type { DiscountCode, DiscountType } from "@/lib/api/types";
import { formatMoney } from "@/lib/format/money";
import { plural } from "@/lib/format/names";

// What the panel says about a discount code (26): its kind and size, its
// uses, its period. The state itself comes from the API.

export const DISCOUNT_TYPE_LABEL: Record<DiscountType, string> = {
  percent: "Percentage",
  fixed: "Fixed amount",
};

/** "10 %" or "€5.00". */
export function valueText(code: Pick<DiscountCode, "type" | "value">): string {
  return code.type === "percent" ? `${code.value} %` : formatMoney(code.value);
}

/** "12 of 100 · 1 pending", "12 · unlimited". */
export function usesText(
  code: Pick<DiscountCode, "usedCount" | "maxUses" | "reservedCount">,
): string {
  const used =
    code.maxUses === null
      ? `${code.usedCount} · unlimited`
      : `${code.usedCount} of ${code.maxUses}`;
  return code.reservedCount > 0
    ? `${used} · ${code.reservedCount} pending`
    : used;
}

/** "Until 15 Nov 2026, 00:00", "From 18 Nov 2026, 00:00 until …", "Always". */
export function periodText(
  code: Pick<DiscountCode, "startsAt" | "expiresAt">,
  format: (value: string) => string,
): string {
  const { startsAt, expiresAt } = code;
  if (startsAt && expiresAt) {
    return `From ${format(startsAt)} until ${format(expiresAt)}`;
  }
  if (startsAt) return `From ${format(startsAt)}`;
  if (expiresAt) return `Until ${format(expiresAt)}`;
  return "Always";
}

/** Orders were made with the code: its text stays, it cannot be deleted. */
export function inUse(
  code: Pick<DiscountCode, "usedCount" | "reservedCount">,
): boolean {
  return code.usedCount + code.reservedCount > 0;
}

/** "3 orders and 1 pending" for the sentence that explains why a code stays. */
export function inUseText(
  code: Pick<DiscountCode, "usedCount" | "reservedCount">,
): string {
  const parts: string[] = [];
  if (code.usedCount > 0) parts.push(plural(code.usedCount, "paid order"));
  if (code.reservedCount > 0) {
    parts.push(`${plural(code.reservedCount, "order")} waiting for payment`);
  }
  return parts.join(" and ");
}
