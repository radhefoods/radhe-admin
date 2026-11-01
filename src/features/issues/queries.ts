"use client";

import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { hasErrorCode } from "@/lib/api/errors";
import { invalidation, queryKeys } from "@/lib/api/query-keys";
import type {
  Id,
  Issue,
  IssueQuery,
  IssueRejectInput,
  IssueResolveInput,
  IssueReviewInput,
} from "@/lib/api/types";

/** How many reports one request brings (the API allows 1 to 100). */
const PAGE_SIZE = 25;

export type IssueFilters = Omit<IssueQuery, "limit" | "cursor">;

/** Problem reports, newest first, by cursor without a total (0.8): "load more". */
export function useIssues(filters: IssueFilters, enabled = true) {
  const query: IssueQuery = { ...filters, limit: PAGE_SIZE };
  return useInfiniteQuery({
    queryKey: [...queryKeys.issues.list(query), "pages"] as const,
    queryFn: ({ pageParam, signal }) =>
      api.issues.list({ ...query, cursor: pageParam }, signal),
    initialPageParam: undefined as Id | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** How many reports the filters match (`GET /issues/count`). */
export function useIssueCount(
  filters: Omit<IssueFilters, "sort">,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.issues.count(filters),
    queryFn: ({ signal }) => api.issues.count(filters, signal),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** The reports of one order, for the box on the order page. */
export function useOrderIssues(orderNumber: string) {
  const query: IssueQuery = { orderNumber };
  return useQuery({
    queryKey: queryKeys.issues.list(query),
    queryFn: ({ signal }) => api.issues.list(query, signal),
  });
}

export function useIssue(id: Id) {
  return useQuery({
    queryKey: queryKeys.issues.detail(id),
    queryFn: async ({ signal }) => (await api.issues.get(id, signal)).issue,
  });
}

/**
 * The three decisions on a report (29). Each answer carries the report as
 * it is now and replaces the page's copy; a refund also moves the order,
 * its documents and the refund queue, which `invalidation.issue` names.
 * When the API refuses the step from the current status, the report is
 * loaded again: somebody else was faster.
 */
export function useIssueActions(id: Id) {
  const client = useQueryClient();
  const keep = (answer: { issue: Issue }) => {
    client.setQueryData(queryKeys.issues.detail(id), answer.issue);
    return answer.issue;
  };
  const common = {
    meta: { invalidates: invalidation.issue, silent: true } as const,
    onError: (error: unknown) => {
      if (hasErrorCode(error, "ISSUE_TRANSITION_NOT_ALLOWED")) {
        void client.invalidateQueries({
          queryKey: queryKeys.issues.detail(id),
        });
      }
    },
  };
  return {
    review: useMutation({
      mutationFn: async (input: IssueReviewInput) =>
        keep(await api.issues.review(id, input)),
      ...common,
    }),
    resolve: useMutation({
      mutationFn: async (input: IssueResolveInput) =>
        keep(await api.issues.resolve(id, input)),
      ...common,
    }),
    reject: useMutation({
      mutationFn: async (input: IssueRejectInput) =>
        keep(await api.issues.reject(id, input)),
      ...common,
    }),
  };
}

export type IssueActions = ReturnType<typeof useIssueActions>;
