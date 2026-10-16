import type {
  ProductStock,
  StockChangeInput,
  StockMovementReason,
} from "@/lib/api/types";

// The stock of a product (documentation, 8): what the dialog sends to
// `POST /products/{id}/stock`, the numbers it restates before the admin
// confirms, and the words of the ledger.

export const STOCK_MAX = 1_000_000;
export const STOCK_NOTE_MAX = 500;

/** The two ways to change a count: the counted number, or units in or out. */
export type StockMode = "set" | "adjust";

export const STOCK_MODE_LABEL: Record<
  StockMode,
  { label: string; hint: string }
> = {
  set: {
    label: "Set the counted number",
    hint: "After counting the shelf: the number of units that are there.",
  },
  adjust: {
    label: "Add or remove units",
    hint: "A delivery that came in (plus), or units that are gone (minus).",
  },
};

/** What a line of the ledger means (8.1). */
export const STOCK_REASON_LABEL: Record<StockMovementReason, string> = {
  restock: "Units added",
  adjustment: "Count corrected",
  import: "CSV import",
  order: "Taken by an order",
  cancel: "Back from a cancelled order",
  return: "Back from a return",
  release: "Given back",
};

export interface StockReading {
  /** What the API gets, or `null` while the input is not valid. */
  body: StockChangeInput | null;
  /** The change in units, signed. */
  delta: number | null;
  /** The count after the change. */
  after: number | null;
  problem: string | null;
}

/**
 * Reads what the admin typed. In `set` mode the number is the new count;
 * in `adjust` mode it is the change, `+12`, `12` or `-4`. A removal of more
 * than there is would be refused by the API (`STOCK_INSUFFICIENT`), so it
 * is refused here first, with the number.
 */
export function readStockChange(
  input: { mode: StockMode; value: string; note: string },
  stock: Pick<ProductStock, "quantity">,
): StockReading {
  const text = input.value.trim().replace(/\s+/g, "");
  const note = input.note.trim() || undefined;
  const invalid = (problem: string): StockReading => ({
    body: null,
    delta: null,
    after: null,
    problem,
  });
  if (text === "") return invalid("Enter a number.");
  if (input.mode === "set") {
    if (!/^\d+$/.test(text)) return invalid("Enter a whole number, 0 or more.");
    const quantity = Number(text);
    if (quantity > STOCK_MAX) return invalid("At most 1,000,000 units.");
    return {
      body: { quantity, ...(note ? { note } : {}) },
      delta: quantity - stock.quantity,
      after: quantity,
      problem: null,
    };
  }
  if (!/^[+-]?\d+$/.test(text)) {
    return invalid("Enter a whole number, with a minus to remove units.");
  }
  const delta = Number(text);
  if (delta === 0) return invalid("Nothing would change.");
  if (Math.abs(delta) > STOCK_MAX) return invalid("At most 1,000,000 units.");
  if (stock.quantity + delta < 0) {
    return invalid(
      `Only ${stock.quantity} ${stock.quantity === 1 ? "unit is" : "units are"} in stock; ${-delta} cannot be removed.`,
    );
  }
  return {
    body: { delta, ...(note ? { note } : {}) },
    delta,
    after: stock.quantity + delta,
    problem: null,
  };
}

/** `+12`, `−4`: a change in units, signed the way the ledger shows it. */
export function formatDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : delta < 0 ? `−${-delta}` : "0";
}

/** The state of a stock in a word, or nothing while all is well. */
export function stockState(
  stock: ProductStock,
): { label: string; tone: "attention" | "danger" } | null {
  if (stock.quantity === 0) return { label: "Sold out", tone: "danger" };
  if (stock.isLow) return { label: "Low stock", tone: "attention" };
  return null;
}
