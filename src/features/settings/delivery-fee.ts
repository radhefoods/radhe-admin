import type { Cents, DeliveryFeeTier } from "@/lib/api/types";
import { formatMoney } from "@/lib/format/money";

// The delivery fee of the shop (documentation, 5: PUT delivery-fee): tiers
// by the value of the goods, in integer cents. The highest tier an order
// reaches applies.

export const MIN_TIERS = 1;
export const MAX_TIERS = 10;
/** The largest amount the API accepts for a tier, in cents. */
export const MAX_TIER_AMOUNT = 10_000_000;

export interface TierProblem {
  /** The position of the tier the problem is shown at. */
  index: number;
  message: string;
}

/**
 * What the API would refuse: one tier must start at 0, and no two tiers may
 * start at the same value. The problems are named at the tier that has to
 * change.
 */
export function tierProblems(tiers: readonly DeliveryFeeTier[]): TierProblem[] {
  const problems: TierProblem[] = [];
  if (tiers.length === 0) return problems;

  if (!tiers.some((tier) => tier.minOrderValue === 0)) {
    let lowest = 0;
    tiers.forEach((tier, index) => {
      if (tier.minOrderValue < (tiers[lowest]?.minOrderValue ?? 0))
        lowest = index;
    });
    problems.push({
      index: lowest,
      message:
        "One tier must start at €0.00: it is the fee of every order that reaches no higher tier.",
    });
  }

  const firstAt = new Map<Cents, number>();
  tiers.forEach((tier, index) => {
    if (firstAt.has(tier.minOrderValue)) {
      problems.push({
        index,
        message: `Another tier already starts at ${formatMoney(tier.minOrderValue)}.`,
      });
    } else {
      firstAt.set(tier.minOrderValue, index);
    }
  });
  return problems;
}

/** Lowest first, as the API stores and returns them. */
export function sortTiers(
  tiers: readonly DeliveryFeeTier[],
): DeliveryFeeTier[] {
  return [...tiers].sort((a, b) => a.minOrderValue - b.minOrderValue);
}

function costs(fee: Cents): string {
  return fee === 0 ? "delivery is free" : `delivery costs ${formatMoney(fee)}`;
}

/**
 * What the tiers mean, one sentence per tier, lowest first:
 * "Below €50.00 delivery costs €4.99." "From €50.00 delivery is free."
 */
export function tierSentences(tiers: readonly DeliveryFeeTier[]): string[] {
  const sorted = sortTiers(tiers);
  return sorted.map((tier, index) => {
    const next = sorted[index + 1];
    if (tier.minOrderValue === 0) {
      if (!next) {
        return tier.fee === 0
          ? "Delivery is free for every order."
          : `Delivery costs ${formatMoney(tier.fee)} for every order.`;
      }
      return `Below ${formatMoney(next.minOrderValue)} ${costs(tier.fee)}.`;
    }
    return `From ${formatMoney(tier.minOrderValue)} ${costs(tier.fee)}.`;
  });
}

/**
 * The fee of an order whose goods are worth `orderValue`: the highest tier
 * the order reaches. `null` when no tier starts low enough.
 */
export function feeFor(
  tiers: readonly DeliveryFeeTier[],
  orderValue: Cents,
): Cents | null {
  let reached: DeliveryFeeTier | null = null;
  for (const tier of tiers) {
    if (tier.minOrderValue > orderValue) continue;
    if (!reached || tier.minOrderValue > reached.minOrderValue) reached = tier;
  }
  return reached ? reached.fee : null;
}
