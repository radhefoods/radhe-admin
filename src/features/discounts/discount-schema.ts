import { z } from "zod";
import { hasErrorCode } from "@/lib/api/errors";
import {
  DISCOUNT_RULES,
  type DiscountCode,
  type DiscountInput,
  type DiscountPatch,
} from "@/lib/api/types";
import { berlinToIso, toLocalInput } from "@/lib/format/dates";
import { centsToInput, formatMoney, parseEuros } from "@/lib/format/money";

// The rules of the API for a discount code (26, sections 2 and 7): the
// text of the code, a whole percent or an amount, an optional minimum,
// period and limit. The form holds text; the schema says what is wrong in
// the admin's words and the converters make what the API wants.

const CODE = /^[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?$/;

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max.toLocaleString("en")} characters.`);

/** A German date and time as typed, or nothing. */
const moment = z
  .string()
  .refine(
    (value) => value === "" || berlinToIso(value) !== null,
    "Enter a date and a time, or leave it empty.",
  );

const WHOLE = /^\d+$/;

export const discountSchema = z
  .object({
    /** Upper case as typed; empty with `generate` on a new code. */
    code: z.string().trim().toUpperCase(),
    /** A new code only: the API makes the text. */
    generate: z.boolean(),
    note: text(DISCOUNT_RULES.noteMaxLength),
    type: z.enum(["percent", "fixed"]),
    /** A whole percent, or euros. */
    value: z.string().trim(),
    appliesToSaleItems: z.boolean(),
    /** Euros, or nothing. */
    minOrderValue: z.string().trim(),
    startsAt: moment,
    expiresAt: moment,
    /** A whole number, or nothing. */
    maxUses: z.string().trim(),
    oncePerCustomer: z.boolean(),
    isActive: z.boolean(),
  })
  .superRefine((values, context) => {
    const issue = (path: string, message: string) =>
      context.addIssue({ code: "custom", path: [path], message });

    if (!values.generate) {
      if (values.code === "") {
        issue("code", "Enter the code, or let the API generate one.");
      } else if (
        values.code.length < DISCOUNT_RULES.codeMinLength ||
        values.code.length > DISCOUNT_RULES.codeMaxLength
      ) {
        issue(
          "code",
          `${DISCOUNT_RULES.codeMinLength} to ${DISCOUNT_RULES.codeMaxLength} characters.`,
        );
      } else if (!CODE.test(values.code)) {
        issue(
          "code",
          "Letters, digits and hyphens, starting and ending with a letter or digit. Example: DIWALI10",
        );
      }
    }

    if (values.type === "percent") {
      if (!WHOLE.test(values.value)) {
        issue(
          "value",
          values.value === ""
            ? "Enter the percentage."
            : "Enter a whole percentage. Example: 10",
        );
      } else {
        const percent = Number(values.value);
        if (
          percent < DISCOUNT_RULES.percentMin ||
          percent > DISCOUNT_RULES.percentMax
        ) {
          issue(
            "value",
            `Between ${DISCOUNT_RULES.percentMin} and ${DISCOUNT_RULES.percentMax} percent.`,
          );
        }
      }
    } else {
      const cents = parseEuros(values.value);
      if (cents === null) {
        issue(
          "value",
          values.value === ""
            ? "Enter the amount."
            : "This is not an amount. Example: 5.00",
        );
      } else if (cents < DISCOUNT_RULES.fixedMin) {
        issue("value", `At least ${formatMoney(DISCOUNT_RULES.fixedMin)}.`);
      } else if (cents > DISCOUNT_RULES.fixedMax) {
        issue("value", `At most ${formatMoney(DISCOUNT_RULES.fixedMax)}.`);
      }
    }

    if (values.minOrderValue !== "") {
      const cents = parseEuros(values.minOrderValue);
      if (cents === null) {
        issue("minOrderValue", "This is not an amount. Example: 25.00");
      } else if (cents < 1) {
        issue("minOrderValue", "At least €0.01, or leave it empty.");
      } else if (cents > DISCOUNT_RULES.minOrderValueMax) {
        issue(
          "minOrderValue",
          `At most ${formatMoney(DISCOUNT_RULES.minOrderValueMax)}.`,
        );
      }
    }

    if (values.maxUses !== "") {
      if (!WHOLE.test(values.maxUses)) {
        issue("maxUses", "Enter a whole number, or leave it empty.");
      } else {
        const uses = Number(values.maxUses);
        if (
          uses < DISCOUNT_RULES.maxUsesMin ||
          uses > DISCOUNT_RULES.maxUsesMax
        ) {
          issue(
            "maxUses",
            `Between ${DISCOUNT_RULES.maxUsesMin} and ${DISCOUNT_RULES.maxUsesMax.toLocaleString("en")}.`,
          );
        }
      }
    }

    const start = values.startsAt && berlinToIso(values.startsAt);
    const end = values.expiresAt && berlinToIso(values.expiresAt);
    if (start && end && Date.parse(end) <= Date.parse(start)) {
      issue("expiresAt", "The end must come after the start.");
    }
  });

export type DiscountFormValues = z.input<typeof discountSchema>;

/** What a value is typed as: a percent as a whole number, cents as euros. */
function valueInput(code: Pick<DiscountCode, "type" | "value">): string {
  return code.type === "percent"
    ? String(code.value)
    : centsToInput(code.value);
}

export function discountDefaults(code?: DiscountCode): DiscountFormValues {
  return {
    code: code?.code ?? "",
    generate: false,
    note: code?.note ?? "",
    type: code?.type ?? "percent",
    value: code ? valueInput(code) : "",
    appliesToSaleItems: code?.appliesToSaleItems ?? true,
    minOrderValue: centsToInput(code?.minOrderValue ?? null),
    startsAt: toLocalInput(code?.startsAt ?? null),
    expiresAt: toLocalInput(code?.expiresAt ?? null),
    maxUses:
      code?.maxUses === null || code === undefined ? "" : String(code.maxUses),
    oncePerCustomer: code?.oncePerCustomer ?? false,
    isActive: code?.isActive ?? true,
  };
}

/** The checked values as the API counts them: cents or a percent, instants, numbers. */
interface Complete {
  code: string;
  note: string;
  type: DiscountCode["type"];
  value: number;
  appliesToSaleItems: boolean;
  minOrderValue: number | null;
  startsAt: string | null;
  expiresAt: string | null;
  maxUses: number | null;
  oncePerCustomer: boolean;
  isActive: boolean;
}

function complete(values: DiscountFormValues): Complete {
  return {
    code: values.code.trim().toUpperCase(),
    note: values.note.trim(),
    type: values.type,
    value:
      values.type === "percent"
        ? Number(values.value)
        : (parseEuros(values.value) ?? 0),
    appliesToSaleItems: values.appliesToSaleItems,
    minOrderValue:
      values.minOrderValue.trim() === ""
        ? null
        : parseEuros(values.minOrderValue),
    startsAt: values.startsAt ? berlinToIso(values.startsAt) : null,
    expiresAt: values.expiresAt ? berlinToIso(values.expiresAt) : null,
    maxUses: values.maxUses.trim() === "" ? null : Number(values.maxUses),
    oncePerCustomer: values.oncePerCustomer,
    isActive: values.isActive,
  };
}

/** What `POST /discounts` gets: what is empty is left out; no `code` when generated. */
export function toDiscountInput(values: DiscountFormValues): DiscountInput {
  const all = complete(values);
  const input: DiscountInput = {
    type: all.type,
    value: all.value,
    appliesToSaleItems: all.appliesToSaleItems,
    oncePerCustomer: all.oncePerCustomer,
    isActive: all.isActive,
  };
  if (!values.generate && all.code) input.code = all.code;
  if (all.note) input.note = all.note;
  if (all.minOrderValue !== null) input.minOrderValue = all.minOrderValue;
  if (all.startsAt) input.startsAt = all.startsAt;
  if (all.expiresAt) input.expiresAt = all.expiresAt;
  if (all.maxUses !== null) input.maxUses = all.maxUses;
  return input;
}

/** What `PATCH /discounts/{id}` gets: only what changed; an emptied optional field as `null`. */
export function toDiscountPatch(
  values: DiscountFormValues,
  code: DiscountCode,
): DiscountPatch {
  const next = complete(values);
  const before = complete(discountDefaults(code));
  const patch: DiscountPatch = {};
  if (next.code !== before.code) patch.code = next.code;
  if (next.note !== before.note) patch.note = next.note;
  if (next.type !== before.type || next.value !== before.value) {
    patch.type = next.type;
    patch.value = next.value;
  }
  if (next.appliesToSaleItems !== before.appliesToSaleItems) {
    patch.appliesToSaleItems = next.appliesToSaleItems;
  }
  if (next.minOrderValue !== before.minOrderValue) {
    patch.minOrderValue = next.minOrderValue;
  }
  if (next.startsAt !== before.startsAt) patch.startsAt = next.startsAt;
  if (next.expiresAt !== before.expiresAt) patch.expiresAt = next.expiresAt;
  if (next.maxUses !== before.maxUses) patch.maxUses = next.maxUses;
  if (next.oncePerCustomer !== before.oncePerCustomer) {
    patch.oncePerCustomer = next.oncePerCustomer;
  }
  if (next.isActive !== before.isActive) patch.isActive = next.isActive;
  return patch;
}

/** The field a documented refusal of the API belongs to. */
export function discountErrorField(
  error: unknown,
): "code" | "value" | "expiresAt" | null {
  if (hasErrorCode(error, "DISCOUNT_CODE_TAKEN")) return "code";
  if (hasErrorCode(error, "DISCOUNT_IN_USE")) return "code";
  if (hasErrorCode(error, "DISCOUNT_VALUE_INVALID")) return "value";
  if (hasErrorCode(error, "DISCOUNT_SCHEDULE_INVALID")) return "expiresAt";
  return null;
}
