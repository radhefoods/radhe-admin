// Section 30: points and rewards (loyalty coins).

import type { Query } from "../http";
import type { SessionTransport } from "../session";
import type {
  CountResult,
  CursorResult,
  Id,
  RewardAccount,
  RewardAccountDetail,
  RewardAccountQuery,
  RewardAdjustInput,
  RewardAdjustResult,
  RewardTransaction,
  RewardTransactionQuery,
  RewardsSettings,
  RewardsSummary,
} from "../types";

export function rewardsApi({ request }: SessionTransport) {
  const base = "/v1/admin/rewards";
  return {
    getSettings: (signal?: AbortSignal) =>
      request<{ settings: RewardsSettings }>(`${base}/settings`, { signal }),
    /** The whole document, every time. */
    putSettings: (settings: RewardsSettings) =>
      request<{ settings: RewardsSettings }>(`${base}/settings`, {
        method: "PUT",
        body: settings,
      }),
    summary: (signal?: AbortSignal) =>
      request<RewardsSummary>(`${base}/summary`, { signal }),
    accounts: (query: RewardAccountQuery = {}, signal?: AbortSignal) =>
      request<CursorResult<RewardAccount>>(`${base}/accounts`, {
        query: query as Query,
        signal,
      }),
    /** The account of one customer with its latest 50 rows; `404 CUSTOMER_NOT_FOUND`. */
    account: (customerId: Id, signal?: AbortSignal) =>
      request<RewardAccountDetail>(`${base}/accounts/${customerId}`, {
        signal,
      }),
    /** Adds or takes coins by hand; `400 REWARDS_AMOUNT_INVALID` for 0. */
    adjust: (customerId: Id, input: RewardAdjustInput) =>
      request<RewardAdjustResult>(`${base}/accounts/${customerId}/adjust`, {
        method: "POST",
        body: input,
      }),
    transactions: (query: RewardTransactionQuery = {}, signal?: AbortSignal) =>
      request<CursorResult<RewardTransaction>>(`${base}/transactions`, {
        query: query as Query,
        signal,
      }),
    transactionCount: (
      query: RewardTransactionQuery = {},
      signal?: AbortSignal,
    ) =>
      request<CountResult>(`${base}/transactions/count`, {
        query: query as Query,
        signal,
      }),
  };
}
