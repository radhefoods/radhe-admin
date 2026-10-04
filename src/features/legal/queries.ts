"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import type {
  Id,
  LegalDocument,
  LegalDocumentSummary,
  LegalType,
  UpdateLegalDocumentInput,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { LEGAL_TYPE, toContent, toTitle } from "./legal";

/** Every version of every type, newest first per type, without the content. */
export function useLegalDocuments() {
  const can = useCan();
  return useQuery({
    queryKey: queryKeys.legal.list(),
    queryFn: ({ signal }) => api.legal.list(undefined, signal),
    enabled: can("legal.read"),
  });
}

/** One version with its content. */
export function useLegalDocument(id: Id | undefined) {
  const can = useCan();
  return useQuery({
    queryKey: queryKeys.legal.detail(id ?? ""),
    queryFn: async ({ signal }) =>
      (await api.legal.get(id as Id, signal)).document,
    enabled: Boolean(id) && can("legal.read"),
  });
}

export interface NewVersionInput {
  type: LegalType;
  /** The latest version of the type: the new one starts from its text. */
  from: LegalDocumentSummary | null;
  note?: string;
}

/**
 * Creates the next version of a type as a draft. The API numbers it; the
 * text starts as a copy of the latest version, so only what changes has to
 * be written.
 */
export function useCreateLegalVersion() {
  return useMutation({
    mutationFn: async ({
      type,
      from,
      note,
    }: NewVersionInput): Promise<LegalDocument> => {
      const source = from ? (await api.legal.get(from.id)).document : null;
      const { document } = await api.legal.create({
        type,
        title: toTitle(source?.title ?? { en: LEGAL_TYPE[type].defaultTitle }),
        content: toContent(source?.content ?? {}),
        note: note || undefined,
      });
      return document;
    },
    meta: { invalidates: [queryKeys.legal.all], silent: true },
  });
}

export function useUpdateLegalDocument(id: Id) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateLegalDocumentInput) =>
      (await api.legal.update(id, input)).document,
    onSuccess: (document) => {
      client.setQueryData(queryKeys.legal.detail(id), document);
    },
    meta: { invalidates: [queryKeys.legal.all], silent: true },
  });
}

export function usePublishLegalDocument(id: Id) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.legal.publish(id)).document,
    onSuccess: (document) => {
      client.setQueryData(queryKeys.legal.detail(id), document);
    },
    meta: { invalidates: [queryKeys.legal.all], silent: true },
  });
}

/**
 * Deletes a draft. Only the list is fetched again: the page of the draft is
 * still open at that moment and must not ask for what is gone.
 */
export function useDeleteLegalDocument() {
  return useMutation({
    mutationFn: (id: Id) => api.legal.remove(id),
    meta: { invalidates: [queryKeys.legal.list()], silent: true },
  });
}
