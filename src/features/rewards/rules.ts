import type {
  RewardAdjustmentReason,
  RewardTransactionType,
  RewardsSettings,
} from "@/lib/api/types";
import { formatMoney } from "@/lib/format/money";

/** What a row of the ledger is, in the admin's words (REWARDS.md, section 4). */
export const REWARD_TYPE_LABEL: Record<RewardTransactionType, string> = {
  order: "Order delivered",
  welcome: "Welcome",
  referral_inviter: "Friend invited",
  referral_invitee: "Invited by a friend",
  review: "Review published",
  redeem: "Redeemed",
  redeem_return: "Returned",
  reversal: "Taken back",
  adjustment: "Adjusted by hand",
  expiry: "Expired",
};

export const REWARD_REASON_LABEL: Record<RewardAdjustmentReason, string> = {
  goodwill: "Goodwill",
  correction: "Correction",
  misuse: "Misuse",
  other: "Other",
};

/** `1,250 coins`, `1 coin`. */
export function coinsText(coins: number): string {
  const count = Math.abs(coins).toLocaleString("en");
  return `${count} ${Math.abs(coins) === 1 ? "coin" : "coins"}`;
}

/** `+120`, `−59`: a movement of the ledger with its sign. */
export function signedCoins(coins: number): string {
  const count = Math.abs(coins).toLocaleString("en");
  return coins < 0 ? `−${count}` : coins > 0 ? `+${count}` : "0";
}

/** A rate or a percentage as the API stores it, without trailing zeros. */
export function decimalText(value: number, maxDecimals: number): string {
  return value.toLocaleString("en", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  });
}

/**
 * The live example next to the percent per coin: "100 coins = 1 % of the
 * goods, €0.50 on €50.00 of goods". `null` when the percent is not a
 * number yet.
 */
export function redemptionExample(percentPerCoin: number): {
  coins: number;
  percent: string;
  onFifty: string;
} {
  const coins = 100;
  const percent = coins * percentPerCoin;
  const goods = 5000;
  return {
    coins,
    percent: decimalText(percent, 6),
    onFifty: formatMoney(Math.round((goods * percent) / 100)),
  };
}

/** Whether a campaign runs now, in words for the settings tab. */
export function campaignState(
  campaign: RewardsSettings["earning"]["campaign"],
  now: number,
): "off" | "scheduled" | "running" | "over" | "open" {
  if (!campaign.enabled) return "off";
  const starts = campaign.startsAt ? Date.parse(campaign.startsAt) : null;
  const ends = campaign.endsAt ? Date.parse(campaign.endsAt) : null;
  if (starts !== null && starts > now) return "scheduled";
  if (ends !== null && ends < now) return "over";
  return starts === null && ends === null ? "open" : "running";
}
