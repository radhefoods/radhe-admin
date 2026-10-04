// What the admin typed into the global search, and which of the API's
// lookups can answer it. The API has no free-text search across records
// (documentation, 4, 8, 10): an order is found by its exact number or the
// customer's full email, a customer by the beginning of the email, a
// product by words.

export interface SearchPlan {
  /** `RF-1084`: `GET /orders?orderNumber=` */
  orderNumber: string | null;
  /** A complete email: `GET /orders?email=` */
  orderEmail: string | null;
  /** The beginning of an email, 2+ characters: `GET /customers?email=` */
  customerEmailPrefix: string | null;
  /** 2 to 80 characters: `GET /products?q=` */
  productQuery: string | null;
  /** `RF-C027`, matched against the newest cargos. */
  cargoCode: string | null;
}

const EMPTY: SearchPlan = {
  orderNumber: null,
  orderEmail: null,
  customerEmailPrefix: null,
  productQuery: null,
  cargoCode: null,
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function planSearch(input: string): SearchPlan {
  const text = input.trim();
  if (text.length < 2) return EMPTY;

  // A cargo code: RF-C027, C27, rf-c 27.
  const cargo = /^(?:rf[\s-]?)?c[\s-]?(\d{1,6})$/i.exec(text);
  if (cargo) {
    return { ...EMPTY, cargoCode: `RF-C${cargo[1]!.padStart(3, "0")}` };
  }

  // An order number: RF-1084, rf1084, #1084, 1084. Also the order of a
  // return or refund number (RF-1084-R1, RF-1084-RF2).
  const order = /^(?:rf[\s-]?|#)?(\d{3,9})(?:-r\d+|-rf\d+)?$/i.exec(text);
  if (order) {
    return {
      ...EMPTY,
      orderNumber: `RF-${order[1]}`,
      // An article number can be all digits as well.
      productQuery: text.length <= 80 ? text : null,
    };
  }

  if (text.includes("@")) {
    return {
      ...EMPTY,
      orderEmail: EMAIL.test(text) ? text.toLowerCase() : null,
      customerEmailPrefix: text.length <= 254 ? text.toLowerCase() : null,
    };
  }

  return {
    ...EMPTY,
    // Customers are found by the beginning of their email only.
    customerEmailPrefix:
      /\s/.test(text) || text.length > 254 ? null : text.toLowerCase(),
    productQuery: text.length <= 80 ? text : null,
  };
}

export function hasRemoteSearch(plan: SearchPlan): boolean {
  return Object.values(plan).some((value) => value !== null);
}
