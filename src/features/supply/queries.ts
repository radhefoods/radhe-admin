"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import type {
  Category,
  Id,
  PriceRule,
  PricingOverride,
  SupplySettingsInput,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { categoryOverrides, resolveRule, type ResolvedRule } from "./pricing";

// The price rule and the pricing of a product (documentation, 31). Buying
// prices and markups are not shown to a role without `catalog.read`: the
// API is not asked without it.

/** The price rule of the shop, the safety buffer, the brand list, the check before activation. */
export function useSupplySettings() {
  const can = useCan();
  return useQuery({
    queryKey: queryKeys.supply.settings,
    queryFn: async ({ signal }) =>
      (await api.supply.getSettings(signal)).settings,
    enabled: can("catalog.read"),
  });
}

/**
 * Saves the settings. Every calculated price is calculated again in the
 * same request, so the products are loaded again; the answer says how many
 * prices changed.
 */
export function useSaveSupplySettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: SupplySettingsInput) => api.supply.putSettings(input),
    onSuccess: ({ settings }) => {
      client.setQueryData(queryKeys.supply.settings, settings);
    },
    meta: { invalidates: [queryKeys.products.all], silent: true },
  });
}

/**
 * How the price of each pack size of a product comes about. The key
 * belongs to the products, so whatever loads a product again (a save, a
 * new buying price, a changed rule) loads its pricing again.
 */
export function useProductPricing(productId: Id, enabled = true) {
  const can = useCan();
  return useQuery({
    queryKey: queryKeys.products.pricing(productId),
    queryFn: ({ signal }) => api.supply.productPricing(productId, signal),
    enabled: enabled && can("catalog.read"),
  });
}

/**
 * The rule that counts under a category: the shop's values and those of
 * the category and of the ones above it; with `own`, what a product sets
 * itself on top, and with `variant`, what one of its pack sizes sets.
 * `null` while the settings or the categories are not loaded.
 */
export function inheritedRule(
  shop: PriceRule | undefined,
  categories: readonly Category[] | undefined,
  categoryId: Id | null | undefined,
  own?: PricingOverride | null,
  variant?: PricingOverride | null,
): ResolvedRule | null {
  if (!shop || !categories) return null;
  return resolveRule(
    shop,
    categoryOverrides(categories, categoryId),
    own,
    variant,
  );
}
