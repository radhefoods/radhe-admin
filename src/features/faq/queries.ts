"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { hasErrorCode } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";
import type {
  Faq,
  FaqGroup,
  FaqGroupInput,
  FaqGroupList,
  FaqGroupPatch,
  FaqInput,
  FaqOrderInput,
  FaqPatch,
  Id,
  ListResult,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";

type FaqList = ListResult<Faq>;

/** Every group in display order, with its counts (22). */
export function useFaqGroups() {
  const can = useCan();
  return useQuery({
    queryKey: queryKeys.faq.groups(),
    queryFn: ({ signal }) => api.faqGroups.list(signal),
    enabled: can("content.read"),
  });
}

/** Every question: grouped ones first, groups in display order, then the ones without a group. */
export function useFaqs() {
  const can = useCan();
  return useQuery({
    queryKey: queryKeys.faq.list(),
    queryFn: ({ signal }) => api.faqs.list({}, signal),
    enabled: can("content.read"),
  });
}

const META = { invalidates: [queryKeys.faq.all], silent: true } as const;

export function useCreateFaqGroup() {
  return useMutation({
    mutationFn: async (input: FaqGroupInput) =>
      (await api.faqGroups.create(input)).group,
    meta: META,
  });
}

/** The answer is the group as it is now: the list shows it at once. */
function keepGroup(client: QueryClient, group: FaqGroup): void {
  client.setQueryData<FaqGroupList>(queryKeys.faq.groups(), (list) =>
    list
      ? {
          ...list,
          items: list.items.map((entry) =>
            entry.id === group.id ? { ...entry, ...group } : entry,
          ),
        }
      : list,
  );
}

export function useUpdateFaqGroup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: FaqGroupPatch & { id: Id }) =>
      (await api.faqGroups.update(id, input)).group,
    onSuccess: (group) => keepGroup(client, group),
    meta: META,
  });
}

export function useDeleteFaqGroup() {
  return useMutation({
    mutationFn: (id: Id) => api.faqGroups.remove(id),
    meta: META,
  });
}

/**
 * The new order of all groups. The API wants every group exactly once; the
 * list follows at once and is loaded again afterwards. When the API says
 * the groups changed meanwhile, its list is the truth.
 */
export function useReorderFaqGroups() {
  const client = useQueryClient();
  const key = queryKeys.faq.groups();
  return useMutation({
    mutationFn: (orderedIds: Id[]) => api.faqGroups.reorder({ orderedIds }),
    onMutate: async (orderedIds) => {
      await client.cancelQueries({ queryKey: key });
      const before = client.getQueryData<FaqGroupList>(key);
      if (before) {
        const byId = new Map(before.items.map((entry) => [entry.id, entry]));
        client.setQueryData<FaqGroupList>(key, {
          ...before,
          items: orderedIds
            .map((id, index) => {
              const entry = byId.get(id);
              return entry ? { ...entry, sortOrder: index } : null;
            })
            .filter((entry): entry is FaqGroup => entry !== null),
        });
      }
      return { before };
    },
    onError: (error, _input, context) => {
      if (context?.before && !hasErrorCode(error, "FAQ_GROUP_ORDER_INVALID")) {
        client.setQueryData(key, context.before);
      }
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: queryKeys.faq.all });
    },
  });
}

export function useCreateFaq() {
  return useMutation({
    mutationFn: async (input: FaqInput) => (await api.faqs.create(input)).faq,
    meta: META,
  });
}

function keepFaq(client: QueryClient, faq: Faq): void {
  client.setQueryData<FaqList>(queryKeys.faq.list(), (list) =>
    list
      ? {
          ...list,
          items: list.items.map((entry) => (entry.id === faq.id ? faq : entry)),
        }
      : list,
  );
}

/** Any field, the publish switch included; a moved question goes last in its new group. */
export function useUpdateFaq() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: FaqPatch & { id: Id }) =>
      (await api.faqs.update(id, input)).faq,
    onSuccess: (faq) => keepFaq(client, faq),
    meta: META,
  });
}

export function useDeleteFaq() {
  return useMutation({
    mutationFn: (id: Id) => api.faqs.remove(id),
    meta: META,
  });
}

/**
 * The new order of the questions of one group. The panel always sends the
 * group's complete list; the list follows at once and is loaded again
 * afterwards. `FAQ_ORDER_INVALID` means the group changed meanwhile: then
 * the API's list stands.
 */
export function useReorderFaqs() {
  const client = useQueryClient();
  const key = queryKeys.faq.list();
  return useMutation({
    mutationFn: (input: FaqOrderInput) => api.faqs.reorder(input),
    onMutate: async ({ groupId, orderedIds }) => {
      await client.cancelQueries({ queryKey: key });
      const before = client.getQueryData<FaqList>(key);
      if (before) {
        const group = groupId ?? null;
        const moved = new Map(
          orderedIds.map((id, index) => [id, index] as const),
        );
        const inGroup = before.items
          .filter((entry) => entry.groupId === group)
          .sort(
            (a, b) =>
              (moved.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
              (moved.get(b.id) ?? Number.MAX_SAFE_INTEGER),
          )
          .map((entry, index) => ({ ...entry, sortOrder: index }));
        let cursor = 0;
        client.setQueryData<FaqList>(key, {
          ...before,
          items: before.items.map((entry) =>
            entry.groupId === group ? inGroup[cursor++]! : entry,
          ),
        });
      }
      return { before };
    },
    onError: (error, _input, context) => {
      if (context?.before && !hasErrorCode(error, "FAQ_ORDER_INVALID")) {
        client.setQueryData(key, context.before);
      }
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: queryKeys.faq.all });
    },
  });
}
