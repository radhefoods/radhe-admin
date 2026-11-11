import type { FineCents, ProfitLine } from "@/lib/api/types";
import { formatMoney } from "@/lib/format/money";

// How the figures of costs and profit are printed (documentation, 32).
// They are cents that may have up to four decimals. Printing rounds them;
// nothing here adds two figures up: every total comes from the API.

const MINUS = "−";
const DASH = "–";

/** A zero that came out of a rounding or a negation is a plain zero. */
const plain = (value: number) => (value === 0 ? 0 : value);

/**
 * An amount for the tables: two decimals. `27.6` (cents) becomes `€0.28`,
 * `-410.75` becomes `−€4.11`. `null` (not known) becomes a dash.
 */
export function formatFine(cents: FineCents | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) {
    return DASH;
  }
  return formatMoney(plain(Math.round(cents)));
}

/** A cost in a table of results: the amount as a negative one; a zero stays a zero. */
export function formatCost(cents: FineCents | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) {
    return DASH;
  }
  return formatFine(-cents);
}

/**
 * An amount in the calculation of one pack, where the steps are fractions
 * of a cent: up to four decimals of a euro, at least two. `13.8` (cents)
 * becomes `€0.138`, `14.3451` becomes `€0.1435`, `138` becomes `€1.38`.
 */
export function formatExact(cents: FineCents | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) {
    return DASH;
  }
  // Hundredths of a cent: the fourth decimal of a euro.
  const parts = plain(Math.round(cents * 100));
  const digits = Math.abs(parts).toString().padStart(5, "0");
  const euros = digits.slice(0, -4).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = digits.slice(-4).replace(/0{1,2}$/, "");
  return `${parts < 0 ? MINUS : ""}€${euros}.${fraction}`;
}

/** `25.77` becomes `25.77 %`, `35` becomes `35 %`; `null` becomes a dash. */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return DASH;
  }
  const text = Math.abs(value)
    .toFixed(2)
    .replace(/\.?0+$/, "");
  return `${value < 0 && text !== "0" ? MINUS : ""}${text} %`;
}

/** Whether two figures print differently in a table: the ordered one is shown next to the final one. */
export function differs(
  ordered: FineCents | null | undefined,
  final: FineCents | null | undefined,
): boolean {
  return formatFine(ordered) !== formatFine(final);
}

/** The pack of a line as the order page names it: "100 g". */
export function packOf(line: Pick<ProfitLine, "packSize">): string {
  return `${line.packSize.value} ${line.packSize.unit}`;
}

/** "2", or "2 ordered, 1 kept" when the customer did not keep them all. */
export function quantityText(quantity: ProfitLine["quantity"]): string {
  return quantity.kept === quantity.ordered
    ? String(quantity.ordered)
    : `${quantity.ordered} ordered, ${quantity.kept} kept`;
}

/**
 * Why the price charged for a pack is not the calculated one: the admin set
 * it by hand, it was reduced, or both. `null` when the two are the same.
 */
export function chargedNote(unit: ProfitLine["unit"]): string | null {
  if (!unit.calculation || unit.price === unit.calculation.price) return null;
  const reasons = [
    ...(unit.priceMode === "manual" ? ["price set by hand"] : []),
    ...(unit.regularPrice !== null ? ["reduced"] : []),
  ];
  return reasons.length > 0 ? reasons.join(", ") : "";
}
