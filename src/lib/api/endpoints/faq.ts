// Section 22: the FAQ, groups and questions.

import type { SessionTransport } from "../session";
import type { Query } from "../http";
import type {
  Faq,
  FaqGroup,
  FaqGroupInput,
  FaqGroupList,
  FaqGroupOrderInput,
  FaqGroupPatch,
  FaqInput,
  FaqOrderInput,
  FaqPatch,
  FaqQuery,
  Id,
  ListResult,
} from "../types";

export function faqGroupsApi({ request }: SessionTransport) {
  const base = "/v1/admin/faq-groups";
  return {
    /** Every group in display order, with its counts, and the counts of the ungrouped questions. */
    list: (signal?: AbortSignal) => request<FaqGroupList>(base, { signal }),
    get: (id: Id, signal?: AbortSignal) =>
      request<{ group: FaqGroup }>(`${base}/${id}`, { signal }),
    /** A new group goes last. */
    create: (input: FaqGroupInput) =>
      request<{ group: FaqGroup }>(base, { method: "POST", body: input }),
    update: (id: Id, input: FaqGroupPatch) =>
      request<{ group: FaqGroup }>(`${base}/${id}`, {
        method: "PATCH",
        body: input,
      }),
    /** Every group exactly once, in the new order. */
    reorder: (input: FaqGroupOrderInput) =>
      request<ListResult<FaqGroup>>(`${base}/order`, {
        method: "PUT",
        body: input,
      }),
    /** `409 FAQ_GROUP_HAS_FAQS` while the group has questions. */
    remove: (id: Id) => request<void>(`${base}/${id}`, { method: "DELETE" }),
  };
}

export function faqsApi({ request }: SessionTransport) {
  const base = "/v1/admin/faqs";
  return {
    /** Grouped questions first, groups in display order, then the ones without a group. */
    list: (query: FaqQuery = {}, signal?: AbortSignal) =>
      request<ListResult<Faq>>(base, { query: query as Query, signal }),
    get: (id: Id, signal?: AbortSignal) =>
      request<{ faq: Faq }>(`${base}/${id}`, { signal }),
    /** A new question goes last in its group. */
    create: (input: FaqInput) =>
      request<{ faq: Faq }>(base, { method: "POST", body: input }),
    /** A moved question goes last in its new group; `isPublished` is the publish switch. */
    update: (id: Id, input: FaqPatch) =>
      request<{ faq: Faq }>(`${base}/${id}`, { method: "PATCH", body: input }),
    /** The order within one group; answers the complete list of the group. */
    reorder: (input: FaqOrderInput) =>
      request<ListResult<Faq>>(`${base}/order`, { method: "PUT", body: input }),
    remove: (id: Id) => request<void>(`${base}/${id}`, { method: "DELETE" }),
  };
}
