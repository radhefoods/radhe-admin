import {
  WHOLESALE_RULES,
  type WholesaleSku,
  type WholesaleStockChangeInput,
  type WholesaleStockOverview,
  type WholesaleStockReason,
} from "@/lib/api/types";
import { plural } from "@/lib/format/names";

// The rules of the wholesale catalogue (25, doc/WHOLESALE_CATALOG.md), as
// pure functions: the words for cartons and stock, and what the stock
// dialog sends.

/** "20 × 1 kg, 4 × 5 kg": the cartons of a product, as the API labels them. */
export function cartonsText(
  skus: readonly Pick<WholesaleSku, "carton">[],
): string {
  return skus.map((sku) => sku.carton.label).join(", ");
}

/** A count below zero is a shortage: what accepting a quotation took that was not there. */
export function skuStockState(
  stock: number,
): { label: string; tone: "danger" } | null {
  return stock < 0 ? { label: "Short", tone: "danger" } : null;
}

/** The state of a product over its SKUs: how many are below zero. */
export function overviewState(
  stock: WholesaleStockOverview,
): { label: string; tone: "danger" } | null {
  if (stock.shortSkus === 0) return null;
  return {
    label:
      stock.shortSkus === 1 ? "1 SKU short" : `${stock.shortSkus} SKUs short`,
    tone: "danger",
  };
}

/** What a line of the ledger means (section 8). */
export const STOCK_REASON_LABEL: Record<WholesaleStockReason, string> = {
  adjustment: "Adjusted",
  import: "CSV import",
  quotation_accepted: "Quotation accepted",
};

/** The two ways to change a count: the exact number, or cartons in or out. */
export type StockMode = "set" | "adjust";

export const STOCK_MODE_LABEL: Record<
  StockMode,
  { label: string; hint: string }
> = {
  set: {
    label: "Exact count",
    hint: "After counting the warehouse: the cartons that are there.",
  },
  adjust: {
    label: "Add or remove",
    hint: "A delivery that came in (plus), or cartons that went out (minus).",
  },
};

export interface StockReading {
  /** What the API gets, or `null` while the input is not valid. */
  body: WholesaleStockChangeInput | null;
  /** The change in cartons, signed. */
  delta: number | null;
  /** The count after the change; may be below zero. */
  after: number | null;
  problem: string | null;
}

const LIMIT = WHOLESALE_RULES.stockMax.toLocaleString("en");

/**
 * Reads what the admin typed. In `set` mode the number is the new count;
 * in `adjust` mode it is the change, `+12`, `12` or `-4`. Below zero is
 * allowed (a shortage); the API takes integers up to a million either way.
 */
export function readStockChange(
  input: { mode: StockMode; value: string; note: string },
  stock: number,
): StockReading {
  const text = input.value.trim().replace(/\s+/g, "").replace("−", "-");
  const note = input.note.trim() || undefined;
  const invalid = (problem: string): StockReading => ({
    body: null,
    delta: null,
    after: null,
    problem,
  });
  if (text === "") return invalid("Enter a number.");
  if (!/^[+-]?\d+$/.test(text)) {
    return invalid(
      input.mode === "set"
        ? "Enter a whole number of cartons."
        : "Enter a whole number, with a minus to remove cartons.",
    );
  }
  const number = Number(text);
  if (Math.abs(number) > WHOLESALE_RULES.stockMax) {
    return invalid(`At most ${LIMIT} cartons.`);
  }
  if (input.mode === "set") {
    return {
      body: { quantity: number, ...(note ? { note } : {}) },
      delta: number - stock,
      after: number,
      problem: null,
    };
  }
  if (number === 0) return invalid("Nothing would change.");
  const after = stock + number;
  if (Math.abs(after) > WHOLESALE_RULES.stockMax) {
    return invalid(`The count would pass ${LIMIT} cartons.`);
  }
  return {
    body: { delta: number, ...(note ? { note } : {}) },
    delta: number,
    after,
    problem: null,
  };
}

/** "3 cartons", "1 carton". */
export function cartonsOf(count: number): string {
  return plural(count, "carton");
}
