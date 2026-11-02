import { z } from "zod";
import { REWARDS_RULES, type RewardsSettings } from "@/lib/api/types";
import { berlinToIso, toLocalInput } from "@/lib/format/dates";
import { centsToInput } from "@/lib/format/money";
import { zInt, zOptionalEuros, zOptionalInt } from "@/lib/validation";

// The rules of the API for the settings document (REWARDS.md, section 4).
// The form holds text; the schema says what is wrong in the admin's words
// and makes the numbers the API wants. The names of the fields are those
// of the document, so a `VALIDATION_FAILED` answer lands on its field.

const DECIMAL = /^\d+(?:[.,]\d+)?$/;

/** A number with decimals, typed with a point or a comma. */
function zDecimal(options: {
  min: number;
  max: number;
  decimals: number;
  example: string;
}) {
  const { min, max, decimals, example } = options;
  return z.string().transform((value, context) => {
    const text = value.trim().replace(",", ".");
    if (!DECIMAL.test(text)) {
      context.addIssue({
        code: "custom",
        message:
          text === ""
            ? "Enter a number."
            : `This is not a number. Example: ${example}`,
      });
      return z.NEVER;
    }
    const places = text.split(".")[1]?.length ?? 0;
    if (places > decimals) {
      context.addIssue({
        code: "custom",
        message: `At most ${decimals} decimals.`,
      });
      return z.NEVER;
    }
    const number = Number(text);
    if (number < min || number > max) {
      context.addIssue({
        code: "custom",
        message: `Between ${min.toLocaleString("en", { maximumFractionDigits: decimals })} and ${max.toLocaleString("en")}.`,
      });
      return z.NEVER;
    }
    return number;
  });
}

/** A German date and time as typed, or nothing. */
const moment = z
  .string()
  .refine(
    (value) => value === "" || berlinToIso(value) !== null,
    "Enter a date and a time, or leave it empty.",
  );

const coins = () => zInt({ min: 0, max: REWARDS_RULES.coinsMax });
const coinsRule = z.object({ enabled: z.boolean(), coins: coins() });

export const rewardsSettingsSchema = z
  .object({
    enabled: z.boolean(),
    earning: z.object({
      order: z.object({
        enabled: z.boolean(),
        coinsPerEuro: zDecimal({
          min: 0,
          max: REWARDS_RULES.coinsPerEuroMax,
          decimals: REWARDS_RULES.coinsPerEuroDecimals,
          example: "1",
        }),
      }),
      welcome: coinsRule,
      referral: z.object({ inviter: coinsRule, invitee: coinsRule }),
      review: coinsRule,
      campaign: z.object({
        enabled: z.boolean(),
        multiplier: zDecimal({
          min: REWARDS_RULES.multiplierMin,
          max: REWARDS_RULES.multiplierMax,
          decimals: 2,
          example: "2",
        }),
        startsAt: moment,
        endsAt: moment,
        name: z.string().trim().max(80, "At most 80 characters."),
      }),
    }),
    redemption: z.object({
      enabled: z.boolean(),
      percentPerCoin: zDecimal({
        min: REWARDS_RULES.percentPerCoinMin,
        max: REWARDS_RULES.percentPerCoinMax,
        decimals: REWARDS_RULES.percentPerCoinDecimals,
        example: "0.01",
      }),
      minCoins: zOptionalInt({ min: 0, max: REWARDS_RULES.coinsMax }),
      minRedeemValue: zOptionalEuros({ max: REWARDS_RULES.centsMax }),
      minOrderValue: zOptionalEuros({ max: REWARDS_RULES.centsMax }),
      maxCoinsPerOrder: zOptionalInt({ min: 0, max: REWARDS_RULES.coinsMax }),
      maxDiscount: zOptionalEuros({ max: REWARDS_RULES.centsMax }),
      combinableWithDiscountCodes: z.boolean(),
    }),
    expiry: z.object({
      enabled: z.boolean(),
      inactivityMonths: zInt({ min: 1, max: 120 }),
    }),
  })
  .superRefine((values, context) => {
    const { startsAt, endsAt } = values.earning.campaign;
    if (startsAt && endsAt) {
      const starts = berlinToIso(startsAt);
      const ends = berlinToIso(endsAt);
      if (starts && ends && Date.parse(ends) <= Date.parse(starts)) {
        context.addIssue({
          code: "custom",
          path: ["earning", "campaign", "endsAt"],
          message: "The campaign must end after it starts.",
        });
      }
    }
  });

export type RewardsFormValues = z.input<typeof rewardsSettingsSchema>;
export type RewardsFormOutput = z.output<typeof rewardsSettingsSchema>;

const text = (value: number) => String(value);

/** The saved document as the form holds it: every number as text. */
export function settingsDefaults(saved: RewardsSettings): RewardsFormValues {
  const { earning, redemption, expiry } = saved;
  return {
    enabled: saved.enabled,
    earning: {
      order: {
        enabled: earning.order.enabled,
        coinsPerEuro: text(earning.order.coinsPerEuro),
      },
      welcome: {
        enabled: earning.welcome.enabled,
        coins: text(earning.welcome.coins),
      },
      referral: {
        inviter: {
          enabled: earning.referral.inviter.enabled,
          coins: text(earning.referral.inviter.coins),
        },
        invitee: {
          enabled: earning.referral.invitee.enabled,
          coins: text(earning.referral.invitee.coins),
        },
      },
      review: {
        enabled: earning.review.enabled,
        coins: text(earning.review.coins),
      },
      campaign: {
        enabled: earning.campaign.enabled,
        multiplier: text(earning.campaign.multiplier),
        startsAt: toLocalInput(earning.campaign.startsAt),
        endsAt: toLocalInput(earning.campaign.endsAt),
        name: earning.campaign.name ?? "",
      },
    },
    redemption: {
      enabled: redemption.enabled,
      percentPerCoin: text(redemption.percentPerCoin),
      minCoins: redemption.minCoins === null ? "" : text(redemption.minCoins),
      minRedeemValue: centsToInput(redemption.minRedeemValue),
      minOrderValue: centsToInput(redemption.minOrderValue),
      maxCoinsPerOrder:
        redemption.maxCoinsPerOrder === null
          ? ""
          : text(redemption.maxCoinsPerOrder),
      maxDiscount: centsToInput(redemption.maxDiscount),
      combinableWithDiscountCodes: redemption.combinableWithDiscountCodes,
    },
    expiry: {
      enabled: expiry.enabled,
      inactivityMonths: text(expiry.inactivityMonths),
    },
  };
}

/** The whole document for `PUT /rewards/settings`. */
export function toSettings(values: RewardsFormOutput): RewardsSettings {
  const { earning, redemption, expiry } = values;
  return {
    enabled: values.enabled,
    earning: {
      order: earning.order,
      welcome: earning.welcome,
      referral: earning.referral,
      review: earning.review,
      campaign: {
        enabled: earning.campaign.enabled,
        multiplier: earning.campaign.multiplier,
        startsAt: earning.campaign.startsAt
          ? berlinToIso(earning.campaign.startsAt)
          : null,
        endsAt: earning.campaign.endsAt
          ? berlinToIso(earning.campaign.endsAt)
          : null,
        name: earning.campaign.name === "" ? null : earning.campaign.name,
      },
    },
    redemption,
    expiry,
  };
}
