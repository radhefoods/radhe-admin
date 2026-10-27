// Section 26: discount codes of the retail shop.

import type { Query } from "../http";
import type { SessionTransport } from "../session";
import type {
  DiscountCode,
  DiscountInput,
  DiscountPatch,
  DiscountQuery,
  DiscountUse,
  Id,
  PageQuery,
  PageResult,
} from "../types";

type Discount = { discount: DiscountCode };

export function discountsApi({ request }: SessionTransport) {
  const base = "/v1/admin/discounts";
  return {
    /** Newest first, by page; `q` searches the code and the note. */
    list: (query: DiscountQuery = {}, signal?: AbortSignal) =>
      request<PageResult<DiscountCode>>(base, {
        query: query as Query,
        signal,
      }),
    get: (id: Id, signal?: AbortSignal) =>
      request<Discount>(`${base}/${id}`, { signal }),
    /** Without `code`, the API generates one of 8 characters. */
    create: (input: DiscountInput) =>
      request<Discount>(base, { method: "POST", body: input }),
    /** Any field; `null` clears an optional one; `isActive` switches the code. */
    update: (id: Id, input: DiscountPatch) =>
      request<Discount>(`${base}/${id}`, { method: "PATCH", body: input }),
    /** `409 DISCOUNT_IN_USE` once an order used or reserved the code. */
    remove: (id: Id) => request<void>(`${base}/${id}`, { method: "DELETE" }),
    /** The orders made with the code, newest first, by page. */
    uses: (id: Id, query: PageQuery = {}, signal?: AbortSignal) =>
      request<PageResult<DiscountUse>>(`${base}/${id}/uses`, {
        query: query as Query,
        signal,
      }),
  };
}
