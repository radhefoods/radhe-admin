import type { Cents, VatRate } from "@/lib/api/types";

// Money is integer cents end to end (documentation, 0.7). Nothing here goes
// through a float: amounts are printed and read digit by digit.

const MINUS = "−";

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** `1999` becomes `€19.99`, `-499` becomes `−€4.99`, `584260` becomes `€5,842.60`. */
export function formatMoney(cents: Cents): string {
  if (!Number.isSafeInteger(cents)) return "—";
  const negative = cents < 0;
  const absolute = Math.abs(cents).toString().padStart(3, "0");
  const euros = groupThousands(absolute.slice(0, -2));
  return `${negative ? MINUS : ""}€${euros}.${absolute.slice(-2)}`;
}

/** The value of a euro input for an amount: `1999` becomes `19.99`. */
export function centsToInput(cents: Cents | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isSafeInteger(cents)) {
    return "";
  }
  const negative = cents < 0;
  const absolute = Math.abs(cents).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${absolute.slice(0, -2)}.${absolute.slice(-2)}`;
}

/**
 * Reads what a person types into a euro field and returns integer cents, or
 * `null` when it is not an amount. Both ways of writing are understood:
 * `19.99`, `19,99`, `1.234,56`, `1,234.56`, `€ 19`, `19`.
 *
 * A separator followed by exactly three digits groups thousands (`1.234` is
 * 1234 euros): an amount has two decimals, never three.
 */
export function parseEuros(input: string): Cents | null {
  const text = input.replace(/[\s€]/g, "").replace(/^EUR/i, "");
  if (text === "" || !/^\d[\d.,]*$/.test(text)) return null;

  const lastSeparator = Math.max(text.lastIndexOf(","), text.lastIndexOf("."));
  let whole = text;
  let fraction = "";
  if (lastSeparator !== -1) {
    const after = text.slice(lastSeparator + 1);
    if (after.length <= 2) {
      whole = text.slice(0, lastSeparator);
      fraction = after;
    } else if (after.length !== 3) {
      return null;
    }
  }

  // What is left in the whole part may only group thousands.
  if (/[.,]/.test(whole)) {
    const groups = whole.split(/[.,]/);
    const first = groups[0] ?? "";
    const wellGrouped =
      first.length >= 1 &&
      first.length <= 3 &&
      groups.slice(1).every((group) => group.length === 3);
    if (!wellGrouped) return null;
    whole = groups.join("");
  }
  if (whole === "") return null;

  const digits = `${whole}${fraction.padEnd(2, "0")}`.replace(/^0+(?=\d)/, "");
  if (digits.length > 15) return null;
  const cents = Number(digits);
  return Number.isSafeInteger(cents) ? cents : null;
}

/** `700` becomes `7 %`, `1070` becomes `10.7 %`. */
export function formatVatRate(rate: VatRate): string {
  return `${rateToInput(rate)} %`;
}

/** The value of a percent input for a VAT rate: `700` becomes `7`. */
export function rateToInput(rate: VatRate | null | undefined): string {
  if (rate === null || rate === undefined || !Number.isSafeInteger(rate)) {
    return "";
  }
  const text = Math.abs(rate).toString().padStart(3, "0");
  const fraction = text.slice(-2).replace(/0+$/, "");
  return `${text.slice(0, -2)}${fraction ? `.${fraction}` : ""}`;
}

/**
 * Reads a percentage with up to two decimals and returns hundredths of a
 * percent: `7` becomes `700`, `19` becomes `1900`, `10,7` becomes `1070`.
 */
export function parseVatRate(input: string): VatRate | null {
  const text = input.replace(/[\s%]/g, "").replace(",", ".");
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const rate = Number(`${match[1]}${(match[2] ?? "").padEnd(2, "0")}`);
  return rate <= 10000 ? rate : null;
}

/** The VAT inside a gross amount, as the API computes it (architecture, 5). */
export function vatInside(gross: Cents, rate: VatRate): Cents {
  return Math.round((gross * rate) / (10000 + rate));
}
