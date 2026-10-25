// Section 24: wholesale quotations.

import type { SessionTransport } from "../session";
import type { Query } from "../http";
import type {
  Id,
  PageResult,
  QuotationPatch,
  QuotationQuery,
  QuotationSummary,
  QuotationWithEmails,
} from "../types";

export function quotationsApi({ request, raw }: SessionTransport) {
  const base = "/v1/admin/quotations";
  const act = (id: Id, action: string) =>
    request<QuotationWithEmails>(`${base}/${id}/${action}`, {
      method: "POST",
    });
  return {
    list: (query: QuotationQuery = {}, signal?: AbortSignal) =>
      request<PageResult<QuotationSummary>>(base, {
        query: query as Query,
        signal,
      }),
    get: (id: Id, signal?: AbortSignal) =>
      request<QuotationWithEmails>(`${base}/${id}`, { signal }),
    /** The PDF as the customer gets it, in any status; fetched with the session. */
    pdf: async (id: Id, signal?: AbortSignal): Promise<Blob> => {
      const response = await raw(`${base}/${id}/pdf`, {
        headers: { Accept: "application/pdf" },
        signal,
      });
      return response.blob();
    },
    /** Prices per carton (net cents) and corrected cartons; the quotation becomes `draft`. */
    update: (id: Id, input: QuotationPatch) =>
      request<QuotationWithEmails>(`${base}/${id}`, {
        method: "PATCH",
        body: input,
      }),
    /** From `new` or `draft` with every line priced: `sent`, the email with the PDF. */
    send: (id: Id) => act(id, "send"),
    /** From `sent`: the same revision once more. */
    resend: (id: Id) => act(id, "resend"),
    accept: (id: Id) => act(id, "accept"),
    decline: (id: Id) => act(id, "decline"),
    /** From `new`, `draft` or `sent`. */
    cancel: (id: Id) => act(id, "cancel"),
  };
}
