"use client";

import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { invalidation, queryKeys } from "@/lib/api/query-keys";
import type { Id, NotificationQuery } from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { personName } from "@/lib/format/names";

/** How many messages one request brings (the API allows 1 to 100). */
const PAGE_SIZE = 50;

export type NotificationFilters = Omit<NotificationQuery, "limit" | "cursor">;

/**
 * The log of messages, newest first. Paged by cursor without a total (0.8):
 * the list grows with "load more".
 */
/** How many messages the filters match (`GET /notifications/count`, 0.8). */
export function useNotificationCount(
  filters: Omit<NotificationFilters, "sort">,
) {
  return useQuery({
    queryKey: queryKeys.notifications.count(filters),
    queryFn: ({ signal }) => api.notifications.count(filters, signal),
    placeholderData: keepPreviousData,
  });
}

export function useNotifications(filters: NotificationFilters) {
  const query: NotificationQuery = { ...filters, limit: PAGE_SIZE };
  return useInfiniteQuery({
    queryKey: [...queryKeys.notifications.list(query), "pages"] as const,
    queryFn: ({ pageParam, signal }) =>
      api.notifications.list({ ...query, cursor: pageParam }, signal),
    initialPageParam: undefined as Id | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

/** The counts per status and whether WhatsApp is configured. */
export function useNotificationSummary() {
  const can = useCan();
  return useQuery({
    queryKey: queryKeys.notifications.summary(),
    queryFn: ({ signal }) => api.notifications.summary(signal),
    enabled: can("notifications.read"),
  });
}

/**
 * Whether WhatsApp is configured in the API (section 19). `undefined` while
 * it is not known yet, or when the role may not read notifications.
 */
export function useWhatsappEnabled(): boolean | undefined {
  return useNotificationSummary().data?.whatsappEnabled;
}

export function useNotification(id: Id) {
  return useQuery({
    queryKey: queryKeys.notifications.detail(id),
    queryFn: async ({ signal }) =>
      (await api.notifications.get(id, signal)).notification,
  });
}

/** Sends a failed, skipped or cancelled message again. */
export function useRetryNotification(id: Id) {
  return useMutation({
    mutationFn: async () => (await api.notifications.retry(id)).notification,
    meta: { invalidates: invalidation.notification, silent: true },
  });
}

/** Withdraws a queued message. */
export function useCancelNotification(id: Id) {
  return useMutation({
    mutationFn: async (reason?: string) =>
      (await api.notifications.cancel(id, reason)).notification,
    meta: { invalidates: invalidation.notification, silent: true },
  });
}

/** Works the queue now, instead of waiting for the next minute. */
export function useRunQueue() {
  return useMutation({
    mutationFn: () => api.notifications.run(),
    meta: { invalidates: invalidation.notification },
  });
}

// --- Names for ids -----------------------------------------------------------

type RecordKind = "customer" | "order" | "announcement" | "product" | "cargo";

const RECORD_PERMISSION: Record<RecordKind, string> = {
  customer: "customers.read",
  order: "orders.read",
  announcement: "notifications.read",
  product: "catalog.read",
  cargo: "cargos.read",
};

const RECORD_KEY: Record<RecordKind, (id: Id) => readonly unknown[]> = {
  customer: queryKeys.customers.detail,
  order: queryKeys.orders.detail,
  announcement: queryKeys.announcements.detail,
  product: queryKeys.products.detail,
  cargo: queryKeys.cargos.detail,
};

async function recordName(
  kind: RecordKind,
  id: Id,
  signal: AbortSignal,
): Promise<string> {
  switch (kind) {
    case "customer":
      return personName((await api.customers.get(id, signal)).customer);
    case "order":
      return (await api.orders.get(id, signal)).order.orderNumber;
    case "announcement":
      return (await api.announcements.get(id, signal)).announcement.subject.en;
    case "product":
      return (await api.products.get(id, signal)).product.name.en;
    case "cargo":
      return (await api.cargos.get(id, signal)).cargo.code;
  }
}

/**
 * What a record is called, for an id that arrived through a link (a filter
 * chip, a "related" row). `undefined` while it loads, when the role may not
 * read that kind of record, or when the record is gone: the caller then
 * shows the id.
 */
export function useRecordName(
  kind: RecordKind,
  id: Id | null | undefined,
): string | undefined {
  const can = useCan();
  return useQuery({
    // Its own entry next to the record's: only the name is kept.
    queryKey: [...RECORD_KEY[kind](id ?? ""), "name"] as const,
    queryFn: ({ signal }) => recordName(kind, id as Id, signal),
    enabled: Boolean(id) && can(RECORD_PERMISSION[kind]),
    staleTime: 5 * 60_000,
    retry: false,
  }).data;
}
