// Sections 10 (orders), 11 (returns), 12 (payments and refunds),
// 13 (invoices) and 16 (attention).

import type { Query } from "../http";
import type { SessionTransport } from "../session";
import type {
  ActivatePaymentInput,
  Attention,
  CashPaymentInput,
  CompleteRefundInput,
  CreateRefundInput,
  CursorResult,
  Id,
  InvoiceDetail,
  InvoiceQuery,
  InvoiceSummary,
  OrderCancelInput,
  OrderCargoSummary,
  OrderDeliveryInput,
  OrderDetail,
  OrderItemAdjustmentInput,
  OrderPayment,
  OrderQuery,
  OrderReturn,
  OrderStatusInput,
  OrderSummary,
  PaymentBlock,
  PaymentJobsResult,
  Refund,
  RefundQuery,
  ReturnApproveInput,
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
    /** The numbers of a cargo. */
    summary: (cargoId: Id, signal?: AbortSignal) =>
      request<OrderCargoSummary>(`${base}/summary`, {
        query: { cargoId },
        signal,
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
    move: (id: Id, input: { cargoId: Id; note?: string }) =>
      request<{ order: OrderDetail }>(`${base}/${id}/move`, {
        method: "POST",
        body: input,
      }),
    /** Corrects how many units of a product were delivered. */
    adjustItem: (id: Id, productId: Id, input: OrderItemAdjustmentInput) =>
      request<{ order: OrderDetail }>(`${base}/${id}/items/${productId}`, {
        method: "PATCH",
        body: input,
      }),
    cancel: (id: Id, input: OrderCancelInput) =>
      request<{ order: OrderDetail }>(`${base}/${id}/cancel`, {
        method: "POST",
        body: input,
      }),

    // 12 Payment of an order
    payment: (id: Id, signal?: AbortSignal) =>
      request<OrderPayment>(`${base}/${id}/payment`, { signal }),
    activatePayment: (id: Id, input: ActivatePaymentInput) =>
      request<{ order: OrderDetail }>(`${base}/${id}/payment/activate`, {
        method: "POST",
        body: input,
      }),
    recordCash: (id: Id, input: CashPaymentInput) =>
      request<{ order: OrderDetail }>(`${base}/${id}/payment/cash`, {
        method: "POST",
        body: input,
      }),
    waivePayment: (id: Id, reason: string) =>
      request<{ order: OrderDetail }>(`${base}/${id}/payment/waive`, {
        method: "POST",
        body: { reason },
      }),
    setRemindersPaused: (id: Id, paused: boolean) =>
      request<{ payment: PaymentBlock }>(`${base}/${id}/payment/reminders`, {
        method: "PATCH",
        body: { paused },
      }),
    remindNow: (id: Id) =>
      request<{ payment: PaymentBlock }>(`${base}/${id}/payment/remind`, {
        method: "POST",
      }),
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
    /** The goods are back: the bill goes down, a credit note is issued. */
    complete: (id: Id, input: ReturnDecisionInput) =>
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

export function paymentsApi({ request }: SessionTransport) {
  return {
    /** Overdue check and due reminders, now. */
    runJobs: () =>
      request<PaymentJobsResult>("/v1/admin/payments/run-jobs", {
        method: "POST",
      }),
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
