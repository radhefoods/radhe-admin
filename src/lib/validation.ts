import { z } from "zod";
import { berlinToIso, isCalendarDay } from "@/lib/format/dates";
import { parseEuros, parseVatRate } from "@/lib/format/money";
import { formatMoney } from "@/lib/format/money";

// Pieces of the zod schemas that mirror the API's validation. A form holds
// what the admin typed (text); the schema turns it into what the API wants
// (integer cents, integers, ISO moments) and says what is wrong in the
// admin's words.

/** Text that must not be empty. */
export function zText(max: number, required = "This field is required.") {
  return z
    .string()
    .trim()
    .min(1, required)
    .max(max, `At most ${max} characters.`);
}

/** Text that may be empty; an empty field is left out of the request. */
export function zOptionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max, `At most ${max} characters.`)
    .transform((value) => (value === "" ? undefined : value));
}

/** A euro amount typed by a person, as integer cents. */
export function zEuros(options: { min?: number; max?: number } = {}) {
  const { min = 0, max = 10_000_000 } = options;
  return z.string().transform((value, context) => {
    const cents = parseEuros(value);
    if (cents === null) {
      context.addIssue({
        code: "custom",
        message:
          value.trim() === ""
            ? "Enter an amount."
            : "This is not an amount. Example: 19.99",
      });
      return z.NEVER;
    }
    if (cents < min) {
      context.addIssue({
        code: "custom",
        message: `At least ${formatMoney(min)}.`,
      });
      return z.NEVER;
    }
    if (cents > max) {
      context.addIssue({
        code: "custom",
        message: `At most ${formatMoney(max)}.`,
      });
      return z.NEVER;
    }
    return cents;
  });
}

/** A euro amount that may be left empty (`null`). */
export function zOptionalEuros(options: { min?: number; max?: number } = {}) {
  const amount = zEuros(options);
  return z.string().transform((value, context) => {
    if (value.trim() === "") return null;
    const result = amount.safeParse(value);
    if (!result.success) {
      for (const issue of result.error.issues) {
        context.addIssue({ code: "custom", message: issue.message });
      }
      return z.NEVER;
    }
    return result.data;
  });
}

/** A whole number typed by a person. */
export function zInt(options: { min: number; max: number; label?: string }) {
  const { min, max } = options;
  return z.string().transform((value, context) => {
    const text = value.trim();
    if (!/^-?\d+$/.test(text)) {
      context.addIssue({
        code: "custom",
        message: text === "" ? "Enter a number." : "Enter a whole number.",
      });
      return z.NEVER;
    }
    const number = Number(text);
    if (number < min || number > max) {
      context.addIssue({
        code: "custom",
        message: `Between ${min.toLocaleString("en")} and ${max.toLocaleString("en")}.`,
      });
      return z.NEVER;
    }
    return number;
  });
}

/** A whole number that may be left empty (`null`). */
export function zOptionalInt(options: { min: number; max: number }) {
  const number = zInt(options);
  return z.string().transform((value, context) => {
    if (value.trim() === "") return null;
    const result = number.safeParse(value);
    if (!result.success) {
      for (const issue of result.error.issues) {
        context.addIssue({ code: "custom", message: issue.message });
      }
      return z.NEVER;
    }
    return result.data;
  });
}

/** A VAT rate typed as a percentage, as hundredths of a percent. */
export const zVatRate = z.string().transform((value, context) => {
  const rate = parseVatRate(value);
  if (rate === null) {
    context.addIssue({
      code: "custom",
      message: "Enter the rate in percent, 0 to 100. Example: 7",
    });
    return z.NEVER;
  }
  return rate;
});

/**
 * A translated field of a form: English is required, German may be empty.
 * An empty German text is sent as `null`, which clears it.
 */
export function zTranslated(
  max: number,
  required = "The English text is required.",
) {
  return z
    .object({
      en: z
        .string()
        .trim()
        .min(1, required)
        .max(max, `At most ${max} characters.`),
      de: z.string().trim().max(max, `At most ${max} characters.`),
    })
    .transform((value) => ({
      en: value.en,
      de: value.de === "" ? null : value.de,
    }));
}

/** A translated field of which both languages may be empty. */
export function zTranslatedOptional(max: number) {
  return z
    .object({
      en: z.string().trim().max(max, `At most ${max} characters.`),
      de: z.string().trim().max(max, `At most ${max} characters.`),
    })
    .transform((value) => ({
      en: value.en === "" ? null : value.en,
      de: value.de === "" ? null : value.de,
    }));
}

/** A translated field as a form holds it: two texts, never `null`. */
export function translatedDefaults(
  value: { en?: string | null; de?: string | null } | null | undefined,
): { en: string; de: string } {
  return { en: value?.en ?? "", de: value?.de ?? "" };
}

/**
 * A German date and time (`2026-09-26T23:59`, the value of a
 * `datetime-local` input), as ISO with the German offset for the API.
 */
export const zBerlinDateTime = z.string().transform((value, context) => {
  const iso = berlinToIso(value);
  if (iso === null) {
    context.addIssue({ code: "custom", message: "Enter a date and a time." });
    return z.NEVER;
  }
  return iso;
});

/** A calendar day (`YYYY-MM-DD`, the value of a `date` input). */
export const zDay = z
  .string()
  .refine((value) => isCalendarDay(value), "Enter a date.");

/** The id of a record chosen in a select. */
export const zId = z.string().regex(/^[0-9a-f]{24}$/, "Choose one.");
