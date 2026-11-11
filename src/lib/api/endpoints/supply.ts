// Section 31: the price rule and the pricing of a product
// (doc/SUPPLIER_IMPORT.md). Reading needs `catalog.read`, writing
// `catalog.manage`.

import type { SessionTransport } from "../session";
import type {
  Id,
  ProductPricing,
  SupplySettings,
  SupplySettingsInput,
  SupplySettingsResult,
} from "../types";

export function supplyApi({ request }: SessionTransport) {
  const base = "/v1/admin/supply";
  return {
    /** The price rule of the shop, the safety buffer, the brand list, the check before activation. */
    getSettings: (signal?: AbortSignal) =>
      request<{ settings: SupplySettings }>(`${base}/settings`, { signal }),
    /**
     * `safetyUnits` and `pricing` every time; `brands` and `publishCheck`
     * left out stay as they are. Every calculated price is calculated
     * again at once: `repriced` says how many changed.
     */
    putSettings: (input: SupplySettingsInput) =>
      request<SupplySettingsResult>(`${base}/settings`, {
        method: "PUT",
        body: input,
      }),
    /** How the price of each pack size of a product comes about. */
    productPricing: (productId: Id, signal?: AbortSignal) =>
      request<ProductPricing>(`${base}/products/${productId}/pricing`, {
        signal,
      }),
  };
}
