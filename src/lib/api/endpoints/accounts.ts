// Sections 27 (referrals), 28 (order reviews) and 29 (problem reports).

import type { Query } from "../http";
import type { SessionTransport } from "../session";
import type {
  CountResult,
  CursorResult,
  Id,
  Issue,
  IssueQuery,
  IssueRejectInput,
  IssueResolveInput,
  IssueReviewInput,
  Referral,
  ReferralQuery,
  Review,
  ReviewQuery,
  ReviewRejectInput,
  ReviewReplyInput,
} from "../types";

export function referralsApi({ request }: SessionTransport) {
  const base = "/v1/admin/referrals";
  return {
    /** Newest first, by cursor; `referrerId` gives the invitations of one customer. */
    list: (query: ReferralQuery = {}, signal?: AbortSignal) =>
      request<CursorResult<Referral>>(base, {
        query: query as Query,
        signal,
      }),
    count: (query: ReferralQuery = {}, signal?: AbortSignal) =>
      request<CountResult>(`${base}/count`, {
        query: query as Query,
        signal,
      }),
  };
}

type ReviewAnswer = { review: Review };

export function reviewsApi({ request }: SessionTransport) {
  const base = "/v1/admin/reviews";
  return {
    list: (query: ReviewQuery = {}, signal?: AbortSignal) =>
      request<CursorResult<Review>>(base, { query: query as Query, signal }),
    count: (query: ReviewQuery = {}, signal?: AbortSignal) =>
      request<CountResult>(`${base}/count`, {
        query: query as Query,
        signal,
      }),
    get: (id: Id, signal?: AbortSignal) =>
      request<ReviewAnswer>(`${base}/${id}`, { signal }),
    /** Publishes the review: the shop shows it among what customers say. */
    approve: (id: Id) =>
      request<ReviewAnswer>(`${base}/${id}/approve`, { method: "POST" }),
    /** The note is shown to the customer; a published review is taken off the shop. */
    reject: (id: Id, input: ReviewRejectInput) =>
      request<ReviewAnswer>(`${base}/${id}/reject`, {
        method: "POST",
        body: input,
      }),
    /** The public answer under the review; answering again replaces it. */
    reply: (id: Id, input: ReviewReplyInput) =>
      request<ReviewAnswer>(`${base}/${id}/reply`, {
        method: "POST",
        body: input,
      }),
    removeReply: (id: Id) =>
      request<ReviewAnswer>(`${base}/${id}/reply`, { method: "DELETE" }),
    /** The customer may review the order again afterwards. */
    remove: (id: Id) => request<void>(`${base}/${id}`, { method: "DELETE" }),
  };
}

type IssueAnswer = { issue: Issue };

export function issuesApi({ request }: SessionTransport) {
  const base = "/v1/admin/issues";
  return {
    list: (query: IssueQuery = {}, signal?: AbortSignal) =>
      request<CursorResult<Issue>>(base, { query: query as Query, signal }),
    count: (query: IssueQuery = {}, signal?: AbortSignal) =>
      request<CountResult>(`${base}/count`, {
        query: query as Query,
        signal,
      }),
    get: (id: Id, signal?: AbortSignal) =>
      request<IssueAnswer>(`${base}/${id}`, { signal }),
    /** Takes the report on: `in_review`, no email. */
    review: (id: Id, input: IssueReviewInput) =>
      request<IssueAnswer>(`${base}/${id}/review`, {
        method: "POST",
        body: input,
      }),
    /** A refund corrects the order and queues the money; the customer is emailed. */
    resolve: (id: Id, input: IssueResolveInput) =>
      request<IssueAnswer>(`${base}/${id}/resolve`, {
        method: "POST",
        body: input,
      }),
    reject: (id: Id, input: IssueRejectInput) =>
      request<IssueAnswer>(`${base}/${id}/reject`, {
        method: "POST",
        body: input,
      }),
  };
}
