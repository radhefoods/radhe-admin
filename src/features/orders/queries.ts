"use client";

import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { invalidation, queryKeys } from "@/lib/api/query-keys";
import type {
  ActivatePaymentInput,
  CashPaymentInput,
  CreateRefundInput,
  Id,
  OrderCancelInput,
  OrderDeliveryInput,
  OrderItemAdjustmentInput,
  OrderQuery,
  OrderStatusInput,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";

const PAGE_SIZE = 25;

/** Orders, newest first, page by page (the API pages them by cursor). */
export function useOrders(
  query: Omit<OrderQuery, "cursor" | "limit">,
  enabled = true,
) {
  return useInfiniteQuery({
    queryKey: queryKeys.orders.list(query),
    queryFn: ({ pageParam, signal }) =>
      api.orders.list(
        { ...query, limit: PAGE_SIZE, cursor: pageParam },
        signal,
      ),
    initialPageParam: undefined as Id | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled,
  });
}

export function useOrder(id: Id) {
  return useQuery({
    queryKey: queryKeys.orders.detail(id),
    queryFn: async ({ signal }) => (await api.orders.get(id, signal)).order,
  });
}

/** Documents, refunds and what can be refunded. Needs `payments.read`. */
export function useOrderPayment(id: Id, enabled = true) {
  const can = useCan();
  return useQuery({
    queryKey: queryKeys.orders.payment(id),
    queryFn: ({ signal }) => api.orders.payment(id, signal),
    enabled: enabled && can("payments.read"),
  });
}

/**
 * Everything that changes one order. Each change also moves numbers
 * elsewhere (the cargo, the attention overview, the messages), which
 * `invalidation` names.
 */
export function useOrderActions(id: Id) {
  const order = { invalidates: invalidation.order, silent: true } as const;
  const payment = { invalidates: invalidation.payment, silent: true } as const;
  return {
    setStatus: useMutation({
      mutationFn: (input: OrderStatusInput) => api.orders.setStatus(id, input),
      meta: order,
    }),
    setDelivery: useMutation({
      mutationFn: (input: OrderDeliveryInput) =>
        api.orders.setDelivery(id, input),
      meta: order,
    }),
    move: useMutation({
      mutationFn: (input: { cargoId: Id; note?: string }) =>
        api.orders.move(id, input),
      meta: order,
    }),
    adjustItem: useMutation({
      mutationFn: ({
        productId,
        ...input
      }: OrderItemAdjustmentInput & { productId: Id }) =>
        api.orders.adjustItem(id, productId, input),
      // A correction after the invoice issues a credit note.
      meta: payment,
    }),
    cancel: useMutation({
      mutationFn: (input: OrderCancelInput) => api.orders.cancel(id, input),
      meta: order,
    }),
    activatePayment: useMutation({
      mutationFn: (input: ActivatePaymentInput) =>
        api.orders.activatePayment(id, input),
      meta: payment,
    }),
    recordCash: useMutation({
      mutationFn: (input: CashPaymentInput) => api.orders.recordCash(id, input),
      meta: payment,
    }),
    waive: useMutation({
      mutationFn: (reason: string) => api.orders.waivePayment(id, reason),
      meta: payment,
    }),
    setRemindersPaused: useMutation({
      mutationFn: (paused: boolean) =>
        api.orders.setRemindersPaused(id, paused),
      meta: { invalidates: invalidation.payment },
    }),
    remindNow: useMutation({
      mutationFn: () => api.orders.remindNow(id),
      meta: payment,
    }),
    createRefund: useMutation({
      mutationFn: (input: CreateRefundInput) =>
        api.orders.createRefund(id, input),
      meta: payment,
    }),
  };
}

export type OrderActions = ReturnType<typeof useOrderActions>;
