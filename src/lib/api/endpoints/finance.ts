// Section 32: costs and profit of an order (doc/ORDER_PROFIT.md).

import type { SessionTransport } from "../session";
import type { Id, OrderCostSettings, OrderProfit } from "../types";

export function financeApi({ request }: SessionTransport) {
  const base = "/v1/admin/finance";
  return {
    /** What one order costs besides its goods. Needs `finance.read`. */
    getSettings: (signal?: AbortSignal) =>
      request<{ settings: OrderCostSettings }>(`${base}/settings`, { signal }),
    /** The whole document, every time. Needs `finance.manage`. */
    putSettings: (settings: OrderCostSettings) =>
      request<{ settings: OrderCostSettings }>(`${base}/settings`, {
        method: "PUT",
        body: settings,
      }),
    /** What an order cost and what it earned. Needs `finance.read`. */
    orderProfit: (orderId: Id, signal?: AbortSignal) =>
      request<OrderProfit>(`${base}/orders/${orderId}/profit`, { signal }),
  };
}
