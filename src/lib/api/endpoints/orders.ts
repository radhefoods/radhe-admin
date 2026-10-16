// Sections 9 (orders), 10 (returns), 11 (payments and refunds),
// 12 (invoices) and 15 (attention).

import type { Query } from "../http";
import type { SessionTransport } from "../session";
import type {
  Attention,
  BulkChosenMethodInput,
  BulkChosenMethodResult,
  BulkChosenStatusInput,
  BulkChosenStatusResult,
  CompleteRefundInput,
  CountResult,
  CreateRefundInput,
  CursorResult,
  Id,
  InvoiceDetail,
  InvoiceQuery,
  InvoiceSummary,
  OrderCancelInput,
  OrderDeliveryInput,
  OrderDetail,
  OrderItemAdjustmentInput,
  OrderPayment,
  OrderQuery,
  OrderReturn,
  OrderStatusInput,
  OrderSummary,
  Refund,
  RefundQuery,
  ReturnApproveInput,
  ReturnCompleteInput,
  ReturnDecisionInput,
  ReturnQuery,
} from "../types";

export function ordersApi({ request }: SessionTransport) {
  const base = "/v1/admin/orders";
  return {
    list: (query: OrderQuery = {}, signal?: AbortSignal) =>
      request<CursorResult<OrderSummary>>(base, {
        query: query as Query,
        signal,
      }),
    /** How many orders the filters match (0.8). */
    count: (query: OrderQuery = {}, signal?: AbortSignal) =>
      request<CountResult>(`${base}/count`, {
        query: query as Query,
        signal,
      }),
    /** Chosen orders on to a status; every order is answered (9). */
    bulkStatus: (input: BulkChosenStatusInput) =>
      request<BulkChosenStatusResult>(`${base}/bulk/status`, {
        method: "POST",
        body: input,
      }),
    /** The delivery method of chosen orders; every order is answered (9). */
    bulkDeliveryMethod: (input: BulkChosenMethodInput) =>
      request<BulkChosenMethodResult>(`${base}/bulk/delivery-method`, {
        method: "POST",
        body: input,
      }),
    get: (id: Id, signal?: AbortSignal) =>
      request<{ order: OrderDetail }>(`${base}/${id}`, { signal }),
    setStatus: (id: Id, input: OrderStatusInput) =>
      request<{ order: OrderDetail }>(`${base}/${id}/status`, {
        method: "POST",
        body: input,
      }),
    setDelivery: (id: Id, input: OrderDeliveryInput) =>
      request<{ order: OrderDetail }>(`${base}/${id}/delivery`, {
        method: "PATCH",
        body: input,
      }),
    /** Corrects how many units of a pack size were delivered (`items[].variantId`). */
    adjustItem: (id: Id, variantId: Id, input: OrderItemAdjustmentInput) =>
      request<{ order: OrderDetail }>(`${base}/${id}/items/${variantId}`, {
        method: "PATCH",
        body: input,
      }),
    cancel: (id: Id, input: OrderCancelInput) =>
      request<{ order: OrderDetail }>(`${base}/${id}/cancel`, {
        method: "POST",
        body: input,
      }),

    // 11 Payment of an order
    payment: (id: Id, signal?: AbortSignal) =>
      request<OrderPayment>(`${base}/${id}/payment`, { signal }),
    /** Decides a refund: through Stripe, or by hand. */
    createRefund: (id: Id, input: CreateRefundInput) =>
      request<{ refund: Refund }>(`${base}/${id}/payment/refunds`, {
        method: "POST",
        body: input,
      }),
  };
}

export function returnsApi({ request }: SessionTransport) {
  const base = "/v1/admin/returns";
  return {
    list: (query: ReturnQuery = {}, signal?: AbortSignal) =>
      request<CursorResult<OrderReturn>>(base, {
        query: query as Query,
        signal,
      }),
    count: (query: ReturnQuery = {}, signal?: AbortSignal) =>
      request<CountResult>(`${base}/count`, {
        query: query as Query,
        signal,
      }),
    get: (id: Id, signal?: AbortSignal) =>
      request<{ return: OrderReturn }>(`${base}/${id}`, { signal }),
    approve: (id: Id, input: ReturnApproveInput) =>
      request<{ return: OrderReturn }>(`${base}/${id}/approve`, {
        method: "POST",
        body: input,
      }),
    reject: (id: Id, input: ReturnDecisionInput) =>
      request<{ return: OrderReturn }>(`${base}/${id}/reject`, {
        method: "POST",
        body: input,
      }),
    /** The goods are back: the bill goes down, a credit note is issued, `restock` puts the units back. */
    complete: (id: Id, input: ReturnCompleteInput) =>
      request<{ return: OrderReturn }>(`${base}/${id}/complete`, {
        method: "POST",
        body: input,
      }),
  };
}

export function refundsApi({ request }: SessionTransport) {
  const base = "/v1/admin/refunds";
  return {
    list: (query: RefundQuery = {}, signal?: AbortSignal) =>
      request<CursorResult<Refund>>(base, { query: query as Query, signal }),
    count: (query: RefundQuery = {}, signal?: AbortSignal) =>
      request<CountResult>(`${base}/count`, {
        query: query as Query,
        signal,
      }),
    get: (id: Id, signal?: AbortSignal) =>
      request<{ refund: Refund }>(`${base}/${id}`, { signal }),
    /** The money was sent by hand: completes a `pending` manual refund. */
    complete: (id: Id, input: CompleteRefundInput) =>
      request<{ refund: Refund }>(`${base}/${id}/complete`, {
        method: "POST",
        body: input,
      }),
    cancel: (id: Id, note?: string) =>
      request<{ refund: Refund }>(`${base}/${id}/cancel`, {
        method: "POST",
        body: { note },
      }),
    /** Asks Stripe how a Stripe refund stands. */
    sync: (id: Id) =>
      request<{ refund: Refund }>(`${base}/${id}/sync`, { method: "POST" }),
  };
}

export function invoicesApi({ request, raw }: SessionTransport) {
  const base = "/v1/admin/invoices";
  return {
    list: (query: InvoiceQuery = {}, signal?: AbortSignal) =>
      request<CursorResult<InvoiceSummary>>(base, {
        query: query as Query,
        signal,
      }),
    get: (id: Id, signal?: AbortSignal) =>
      request<{ invoice: InvoiceDetail }>(`${base}/${id}`, { signal }),
    /** The PDF, fetched with the session (a plain link would not refresh it). */
    pdf: async (id: Id, signal?: AbortSignal): Promise<Blob> => {
      const response = await raw(`${base}/${id}/pdf`, {
        headers: { Accept: "application/pdf" },
        signal,
      });
      return response.blob();
    },
  };
}

export function attentionApi({ request }: SessionTransport) {
  return {
    get: (signal?: AbortSignal) =>
      request<Attention>("/v1/admin/attention", { signal }),
  };
}
