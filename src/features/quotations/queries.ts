"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { hasErrorCode } from "@/lib/api/errors";
import { invalidation, queryKeys } from "@/lib/api/query-keys";
import type {
  Id,
  QuotationPatch,
  QuotationQuery,
  QuotationWithEmails,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";

/** A page of quotations with the API's filters and sort (24). */
export function useQuotations(query: QuotationQuery) {
  const can = useCan();
  return useQuery({
    queryKey: queryKeys.quotations.list(query),
    queryFn: ({ signal }) => api.quotations.list(query, signal),
    placeholderData: keepPreviousData,
    enabled: can("quotations.read"),
  });
}

/** The quotation with its lines and the emails about it. */
export function useQuotation(id: Id) {
  return useQuery({
    queryKey: queryKeys.quotations.detail(id),
    queryFn: ({ signal }) => api.quotations.get(id, signal),
  });
}

/**
 * Everything that changes one quotation. Each answer is the quotation as
 * it is now, with its emails, and replaces the page at once; the list,
 * the start page and the messages log are loaded again behind it. When
 * the API says the quotation is not in the right status any more, or a
 * line is gone, the page is loaded again too: someone else was faster.
 */
export function useQuotationActions(id: Id) {
  const client = useQueryClient();
  const key = queryKeys.quotations.detail(id);
  const onSuccess = (result: QuotationWithEmails) =>
    client.setQueryData<QuotationWithEmails>(key, result);
  const onError = (error: unknown) => {
    if (
      hasErrorCode(
        error,
        "QUOTATION_STATUS_INVALID",
        "QUOTATION_ITEM_NOT_FOUND",
        "QUOTATION_NOT_PRICED",
      )
    ) {
      void client.invalidateQueries({ queryKey: key });
    }
  };
  const meta = { invalidates: invalidation.quotation, silent: true } as const;
  const shared = { onSuccess, onError, meta };

  return {
    save: useMutation({
      mutationFn: (input: QuotationPatch) => api.quotations.update(id, input),
      ...shared,
    }),
    send: useMutation({
      mutationFn: () => api.quotations.send(id),
      ...shared,
    }),
    resend: useMutation({
      mutationFn: () => api.quotations.resend(id),
      ...shared,
    }),
    accept: useMutation({
      mutationFn: () => api.quotations.accept(id),
      ...shared,
    }),
    decline: useMutation({
      mutationFn: () => api.quotations.decline(id),
      ...shared,
    }),
    cancel: useMutation({
      mutationFn: () => api.quotations.cancel(id),
      ...shared,
    }),
  };
}

export type QuotationActions = ReturnType<typeof useQuotationActions>;
