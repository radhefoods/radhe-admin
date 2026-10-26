import { z } from "zod";
import {
  QUOTATION_CLOSED,
  QUOTATION_RULES,
  type Cents,
  type Id,
  type QuotationDetail,
  type QuotationItem,
  type QuotationPatch,
  type QuotationStatus,
  type QuotationSummary,
} from "@/lib/api/types";
import { centsToInput, formatMoney, parseEuros } from "@/lib/format/money";
import { plural } from "@/lib/format/names";

// The rules of a wholesale quotation (24, doc/QUOTATIONS.md section 7),
// as pure functions: which actions a status allows, what the lines form
// holds, what "Save prices" sends.

export function isClosed(status: QuotationStatus): boolean {
  return QUOTATION_CLOSED.includes(status);
}

/** Prices and cartons can change while the quotation is not closed. */
export function canPrice(status: QuotationStatus): boolean {
  return !isClosed(status);
}

/** `send` needs `new` or `draft`; a sent quotation is resent, or priced again. */
export function canSend(status: QuotationStatus): boolean {
  return status === "new" || status === "draft";
}

/** Resend, accept and decline belong to a sent quotation. */
export function isSent(status: QuotationStatus): boolean {
  return status === "sent";
}

export function canCancel(status: QuotationStatus): boolean {
  return !isClosed(status);
}

export function allPriced(items: readonly QuotationItem[]): boolean {
  return items.every((item) => item.unitPrice !== null);
}

/** The lines whose cartons exceed the wholesale stock of their SKU right now (25). */
export function shortLines(items: readonly QuotationItem[]): QuotationItem[] {
  return items.filter((item) => item.stock?.short === true);
}

/** The lines whose SKU no longer exists in the wholesale catalogue. */
export function missingLines(items: readonly QuotationItem[]): QuotationItem[] {
  return items.filter((item) => item.stock === null);
}

/**
 * The warning above the actions of a sent quotation: accepting takes the
 * cartons of every line, and these lines would go below zero. Accept is
 * never held back by it (section 8: nothing is refused for want of stock).
 */
export function stockWarning(
  quotation: Pick<QuotationDetail, "status" | "items">,
): string | null {
  if (quotation.status !== "sent") return null;
  const short = shortLines(quotation.items);
  if (short.length === 0) return null;
  return `Stock is short for ${plural(short.length, "line")}; accepting will take it below zero.`;
}

/** "2 of 3 priced", for a quotation without totals. */
export function pricedText(
  quotation: Pick<QuotationSummary, "pricedLines" | "itemCount">,
): string {
  return `${quotation.pricedLines} of ${quotation.itemCount} priced`;
}

/** "3 lines, 7 cartons". */
export function linesText(
  quotation: Pick<QuotationSummary, "itemCount" | "cartons">,
): string {
  return `${plural(quotation.itemCount, "line")}, ${plural(quotation.cartons, "carton")}`;
}

/**
 * What the revision means in words: a draft whose prices changed after a
 * send says so, so that nobody takes it for a quotation never sent.
 */
export function revisionText(
  quotation: Pick<QuotationSummary, "status" | "revision">,
): string | null {
  if (quotation.revision === 0) return null;
  if (quotation.status === "draft" || quotation.status === "new") {
    return `Revision ${quotation.revision} sent before`;
  }
  return `Revision ${quotation.revision}`;
}

// --- The lines form -------------------------------------------------------------

export interface LineValues {
  id: Id;
  cartons: string;
  /** Euros as typed; empty while the line has no price. */
  unitPrice: string;
}

export interface LinesValues {
  lines: LineValues[];
}

export function lineValues(items: readonly QuotationItem[]): LinesValues {
  return {
    lines: items.map((item) => ({
      id: item.id,
      cartons: String(item.cartons),
      unitPrice: centsToInput(item.unitPrice),
    })),
  };
}

const CARTONS_MESSAGE = `A whole number from ${QUOTATION_RULES.cartonsMin} to ${QUOTATION_RULES.cartonsMax.toLocaleString("en")}.`;
const PRICE_MESSAGE = `An amount from ${formatMoney(QUOTATION_RULES.priceMin)} to ${formatMoney(QUOTATION_RULES.priceMax)}, net of VAT.`;
const KEEPS_PRICE_MESSAGE =
  "A priced line keeps a price. Change it instead of removing it.";

function parseCartons(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= QUOTATION_RULES.cartonsMin &&
    value <= QUOTATION_RULES.cartonsMax
    ? value
    : null;
}

/** The typed price in cents; `null` for an empty field, `NaN` for a wrong one. */
function parsePrice(text: string): Cents | null {
  if (text.trim() === "") return null;
  const cents = parseEuros(text);
  return cents !== null &&
    cents >= QUOTATION_RULES.priceMin &&
    cents <= QUOTATION_RULES.priceMax
    ? cents
    : Number.NaN;
}

/**
 * The schema of the lines form: cartons 1 to 10,000, a price from one cent
 * to €100,000, or no price yet. Whether a line may be left without a price
 * depends on the quotation as it is now: `emptiedPrices` checks that.
 */
export const LINES_SCHEMA = z.object({
  lines: z
    .array(
      z.object({
        id: z.string(),
        cartons: z.string(),
        unitPrice: z.string(),
      }),
    )
    .superRefine((lines, context) => {
      lines.forEach((line, index) => {
        if (parseCartons(line.cartons) === null) {
          context.addIssue({
            code: "custom",
            path: [index, "cartons"],
            message: CARTONS_MESSAGE,
          });
        }
        const price = parsePrice(line.unitPrice);
        if (price !== null && Number.isNaN(price)) {
          context.addIssue({
            code: "custom",
            path: [index, "unitPrice"],
            message: PRICE_MESSAGE,
          });
        }
      });
    }),
});

/**
 * The rows whose price was removed although the line has one: the API
 * takes no `null` price, so the admin changes it instead. Returns the
 * message to put at each of these fields.
 */
export function emptiedPrices(
  values: LinesValues,
  items: readonly QuotationItem[],
): { index: number; message: string }[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return values.lines.flatMap((line, index) =>
    line.unitPrice.trim() === "" &&
    (byId.get(line.id)?.unitPrice ?? null) !== null
      ? [{ index, message: KEEPS_PRICE_MESSAGE }]
      : [],
  );
}

/** The amount of a line as typed: cartons × price per carton, or `null` without a price. */
export function lineAmount(line: LineValues): Cents | null {
  const cartons = parseCartons(line.cartons);
  const price = parsePrice(line.unitPrice);
  if (cartons === null || price === null || Number.isNaN(price)) return null;
  return cartons * price;
}

/**
 * What `PATCH …/{id}` gets: only the lines whose price or cartons differ
 * from the quotation, each with only what changed. Lines that are not
 * valid are left out; the form stops the submit before that anyway.
 */
export function toLinesPatch(
  values: LinesValues,
  items: readonly QuotationItem[],
): QuotationPatch["items"] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const patch: QuotationPatch["items"] = [];
  for (const line of values.lines) {
    const item = byId.get(line.id);
    if (!item) continue;
    const cartons = parseCartons(line.cartons);
    const price = parsePrice(line.unitPrice);
    const entry: QuotationPatch["items"][number] = { id: line.id };
    if (price !== null && !Number.isNaN(price) && price !== item.unitPrice) {
      entry.unitPrice = price;
    }
    if (cartons !== null && cartons !== item.cartons) entry.cartons = cartons;
    if (entry.unitPrice !== undefined || entry.cartons !== undefined) {
      patch.push(entry);
    }
  }
  return patch;
}

/** The name of the person and the company, as the lists show them. */
export function contactText(
  quotation: Pick<QuotationSummary, "contact">,
): string {
  return `${quotation.contact.company} · ${quotation.contact.name}`;
}

export type QuotationAction =
  "send" | "resend" | "accept" | "decline" | "cancel";

/** The actions a status offers, in the order the page shows them (7). */
export function actionsFor(status: QuotationStatus): QuotationAction[] {
  if (canSend(status)) return ["send", "cancel"];
  if (isSent(status)) return ["resend", "decline", "accept", "cancel"];
  return [];
}

/** Why "Send quotation" is held back right now, or `null`. */
export function sendBlocked(
  quotation: Pick<QuotationDetail, "items">,
  dirty: boolean,
): string | null {
  if (dirty) return "Save the prices first.";
  if (!allPriced(quotation.items)) {
    const missing = quotation.items.filter((item) => item.unitPrice === null);
    return `${plural(missing.length, "line")} without a price.`;
  }
  return null;
}
