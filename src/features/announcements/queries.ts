"use client";

import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { invalidation, queryKeys } from "@/lib/api/query-keys";
import type {
  AnnouncementInput,
  AnnouncementProgress,
  AnnouncementQuery,
  Id,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { useDebounced } from "@/lib/hooks/use-debounced";

const PAGE_SIZE = 25;

/** The history of announcements, newest first, paged by cursor (0.8). */
export function useAnnouncements(
  filters: Pick<AnnouncementQuery, "productId">,
) {
  const query: AnnouncementQuery = { ...filters, limit: PAGE_SIZE };
  return useInfiniteQuery({
    queryKey: [...queryKeys.announcements.list(query), "pages"] as const,
    queryFn: ({ pageParam, signal }) =>
      api.announcements.list({ ...query, cursor: pageParam }, signal),
    initialPageParam: undefined as Id | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

/** How many messages of an announcement have not ended yet. */
export function stillGoingOut(progress: AnnouncementProgress): number {
  return (
    progress.email.queued +
    progress.email.sending +
    progress.whatsapp.queued +
    progress.whatsapp.sending
  );
}

/**
 * An announcement with its progress. While messages are still going out,
 * the numbers are read again every few seconds.
 */
export function useAnnouncement(id: Id) {
  return useQuery({
    queryKey: queryKeys.announcements.detail(id),
    queryFn: ({ signal }) => api.announcements.get(id, signal),
    refetchInterval: (query) =>
      query.state.data && stillGoingOut(query.state.data.progress) > 0
        ? 10_000
        : false,
  });
}

/** Who would get it and how it reads. Nothing is sent. */
export function usePreviewAnnouncement() {
  return useMutation({
    mutationFn: (input: AnnouncementInput) => api.announcements.preview(input),
    meta: { silent: true },
  });
}

export function useSendAnnouncement() {
  return useMutation({
    mutationFn: (input: AnnouncementInput) => api.announcements.send(input),
    meta: { invalidates: invalidation.notification, silent: true },
  });
}

/** Withdraws the messages that have not gone out yet. */
export function useCancelAnnouncement(id: Id) {
  return useMutation({
    mutationFn: () => api.announcements.cancel(id),
    meta: { invalidates: invalidation.notification, silent: true },
  });
}

/** The API searches products from 2 characters on (8). */
const SEARCH_MIN = 2;
const CHOICES = 8;

/** Products to choose from: the search of the catalogue, a few at a time. */
export function useProductChoices(text: string, enabled: boolean) {
  const can = useCan();
  const debounced = useDebounced(text.trim(), 250);
  const q = debounced.length >= SEARCH_MIN ? debounced.slice(0, 80) : undefined;
  const query = { q, limit: CHOICES };
  const result = useQuery({
    queryKey: [...queryKeys.products.list(query), "choices"] as const,
    queryFn: ({ signal }) => api.products.list(query, signal),
    enabled: enabled && can("catalog.read"),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  return {
    ...result,
    /** The typed text has not been searched yet. */
    waiting: result.isFetching || debounced !== text.trim(),
    searched: q,
  };
}
