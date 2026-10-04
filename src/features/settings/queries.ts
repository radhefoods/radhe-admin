"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import type {
  CompanyInput,
  CustomerCancellation,
  DeliveryFeeTier,
  DeliveryMethod,
  PaymentSettings,
  Settings,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";

/** Every group of the shop settings (documentation, 5). */
export function useSettings() {
  const can = useCan();
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: ({ signal }) => api.settings.get(signal),
    enabled: can("settings.read"),
  });
}

/**
 * Each `PUT` replaces one group and answers with that group: the answer
 * goes straight into what the panel knows of the settings.
 */
function useSaveGroup<Input, Group extends Partial<Settings>>(
  put: (input: Input) => Promise<Group>,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: put,
    onSuccess: (group) => {
      client.setQueryData<Settings>(queryKeys.settings, (current) =>
        current ? { ...current, ...group } : current,
      );
    },
    meta: { invalidates: [queryKeys.settings], silent: true },
  });
}

export function useSaveCompany() {
  return useSaveGroup((input: CompanyInput) => api.settings.putCompany(input));
}

export function useSaveDeliveryFee() {
  return useSaveGroup((tiers: DeliveryFeeTier[]) =>
    api.settings.putDeliveryFee(tiers),
  );
}

export function useSaveOrderPolicy() {
  return useSaveGroup((rule: CustomerCancellation) =>
    api.settings.putOrderPolicy(rule),
  );
}

export function useSaveDeliveryMethod() {
  return useSaveGroup((method: DeliveryMethod) =>
    api.settings.putDelivery(method),
  );
}

export function useSaveReturnPolicy() {
  return useSaveGroup((windowDays: number) =>
    api.settings.putReturnPolicy(windowDays),
  );
}

export function useSavePayments() {
  return useSaveGroup((input: PaymentSettings) =>
    api.settings.putPayments(input),
  );
}

/**
 * Keeps a form on the saved values: when they change on the server (another
 * admin saved) and nothing was typed here, the form follows. What was typed
 * is never overwritten.
 */
export function useFollowSaved<T extends FieldValues>(
  form: UseFormReturn<T, unknown, FieldValues>,
  saved: T,
): void {
  const signature = JSON.stringify(saved);
  useEffect(() => {
    if (!form.formState.isDirty) form.reset(JSON.parse(signature) as T);
  }, [form, signature]);
}
