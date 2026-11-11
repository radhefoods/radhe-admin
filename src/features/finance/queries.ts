"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import type { OrderCostSettings } from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";

// Costs and profit (documentation, 32). Everything here is internal and has
// a permission of its own: without `finance.read` the API is not asked.

/** What one order costs besides its goods, as it counts for new orders. */
export function useOrderCostSettings() {
  const can = useCan();
  return useQuery({
    queryKey: queryKeys.finance.settings,
    queryFn: async ({ signal }) =>
      (await api.finance.getSettings(signal)).settings,
    enabled: can("finance.read"),
  });
}

/** `PUT` replaces the whole document; the answer is what the API keeps. */
export function useSaveOrderCostSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (settings: OrderCostSettings) =>
      (await api.finance.putSettings(settings)).settings,
    onSuccess: (settings) => {
      client.setQueryData(queryKeys.finance.settings, settings);
    },
    // Orders that exist keep the costs they were placed with: nothing else
    // the panel shows changes with a save.
    meta: { silent: true },
  });
}
