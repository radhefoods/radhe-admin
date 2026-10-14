// What the admin typed into the global search, and which of the API's
// lookups can answer it. Orders and customers are searched by words of
// the number, the name, the email or the phone (`q`, documentation 4 and
// 10); products by words (8); a cargo by its code against the newest ones.

export interface SearchPlan {
  /** 2 to 100 characters: `GET /orders?q=` and `GET /customers?q=` */
  query: string | null;
  /** 2 to 80 characters: `GET /products?q=` */
  productQuery: string | null;
  /** `RF-C027`, matched against the newest cargos. */
  cargoCode: string | null;
}

const EMPTY: SearchPlan = { query: null, productQuery: null, cargoCode: null };

export function planSearch(input: string): SearchPlan {
  const text = input.trim();
  if (text.length < 2) return EMPTY;

  // A cargo code: RF-C027, C27, rf-c 27.
  const cargo = /^(?:rf[\s-]?)?c[\s-]?(\d{1,6})$/i.exec(text);
  if (cargo) {
    return { ...EMPTY, cargoCode: `RF-C${cargo[1]!.padStart(3, "0")}` };
  }

  // An order number in any way of writing it: RF-1084, rf1084, #1084,
  // 1084; also the order of a return or refund number (RF-1084-R1,
  // RF-1084-RF2). The API matches the beginning of the number.
  const order = /^(?:rf[\s-]?|#)?(\d{3,9})(?:-r\d+|-rf\d+)?$/i.exec(text);
  if (order) {
    return {
      ...EMPTY,
      query: `RF-${order[1]}`,
      // An article number can be all digits as well.
      productQuery: text.length <= 80 ? text : null,
    };
  }

  return {
    ...EMPTY,
    query: text.length <= 100 ? text : null,
    productQuery: text.includes("@") || text.length > 80 ? null : text,
  };
}

export function hasRemoteSearch(plan: SearchPlan): boolean {
  return Object.values(plan).some((value) => value !== null);
}
