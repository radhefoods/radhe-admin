"use client";

import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { invalidation, queryKeys } from "@/lib/api/query-keys";
import type {
  Cargo,
  CargoInput,
  CargoPatch,
  CargoProductQuery,
  CargoQuery,
  CargoStatus,
  CargoTransition,
  Id,
  OrderSummary,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";

export function useCargos(query: CargoQuery) {
  return useQuery({
    queryKey: queryKeys.cargos.list(query),
    queryFn: ({ signal }) => api.cargos.list(query, signal),
    placeholderData: keepPreviousData,
  });
}

export function useCargo(id: Id) {
  return useQuery({
    queryKey: queryKeys.cargos.detail(id),
    queryFn: async ({ signal }) => (await api.cargos.get(id, signal)).cargo,
  });
}

/** The numbers of a cargo: orders, customers, units, booked value. */
export function useOrderSummary(cargoId: Id | undefined) {
  const can = useCan();
  return useQuery({
    queryKey: queryKeys.orders.summary(cargoId ?? ""),
    queryFn: async ({ signal }) =>
      (await api.orders.summary(cargoId as Id, signal)).summary,
    enabled: Boolean(cargoId) && can("orders.read"),
  });
}

export function useCargoPaymentSummary(cargoId: Id | undefined) {
  const can = useCan();
  return useQuery({
    queryKey: queryKeys.cargos.paymentSummary(cargoId ?? ""),
    queryFn: async ({ signal }) =>
      (await api.cargos.paymentSummary(cargoId as Id, signal)).summary,
    enabled: Boolean(cargoId) && can("payments.read"),
  });
}

/** The shop's default for the payment deadline, when the settings may be read. */
export function useDefaultDeadlineDays(): number {
  const can = useCan();
  const { data } = useQuery({
    queryKey: queryKeys.settings,
    queryFn: ({ signal }) => api.settings.get(signal),
    enabled: can("settings.read"),
    staleTime: 5 * 60_000,
  });
  return data?.payments.defaultDeadlineDays ?? 5;
}

const MAX_CARGO_ORDERS = 2000;

/**
 * Every order of a cargo, fetched page by page. The API's bulk actions
 * work on "all orders of the cargo except the ones left out", so the panel
 * needs the whole list to let the admin leave some out.
 */
export function useCargoOrders(cargoId: Id, enabled = true) {
  const can = useCan();
  return useQuery({
    queryKey: queryKeys.orders.ofCargo(cargoId),
    enabled: enabled && can("orders.read"),
    queryFn: async ({ signal }) => {
      const orders: OrderSummary[] = [];
      let cursor: Id | undefined;
      do {
        const page = await api.orders.list(
          { cargoId, limit: 100, cursor },
          signal,
        );
        orders.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor && orders.length < MAX_CARGO_ORDERS);
      return { orders, complete: !cursor };
    },
  });
}

export interface TransitionInput {
  cargo: Cargo;
  to: CargoStatus;
  note?: string;
  excludeOrderIds?: Id[];
  moveOrdersToCargoId?: Id;
  /**
   * Opening a cargo while another one takes orders: close that one and
   * open this one in one step (`POST /cargos/rollover`).
   */
  rollover?: boolean;
  /** Closing a cargo: also open this scheduled cargo now. */
  openNextCargoId?: Id;
}

/**
 * Every change of a cargo's status. The API has a dedicated endpoint for
 * opening and closing and one for everything else; the rollover closes one
 * cargo and opens the next with the rules of the automatic check.
 */
export function useCargoTransition() {
  return useMutation({
    mutationFn: async (input: TransitionInput): Promise<CargoTransition> => {
      const { cargo, to, note } = input;
      if (input.rollover && to === "taking_orders") {
        const result = await api.cargos.rollover({
          nextCargoId: cargo.id,
          note,
        });
        return result.opened;
      }
      if (input.openNextCargoId && to === "orders_closed") {
        const result = await api.cargos.rollover({
          nextCargoId: input.openNextCargoId,
          note,
        });
        return result.closed ?? result.opened;
      }
      if (to === "taking_orders") return api.cargos.open(cargo.id, note);
      if (to === "orders_closed" && cargo.status === "taking_orders") {
        return api.cargos.close(cargo.id, note);
      }
      return api.cargos.setStatus(cargo.id, {
        status: to,
        note,
        excludeOrderIds: input.excludeOrderIds?.length
          ? input.excludeOrderIds
          : undefined,
        moveOrdersToCargoId: input.moveOrdersToCargoId,
      });
    },
    meta: { invalidates: invalidation.cargo, silent: true },
  });
}

export function useCreateCargo() {
  return useMutation({
    mutationFn: async (input: CargoInput) =>
      (await api.cargos.create(input)).cargo,
    meta: { invalidates: [queryKeys.cargos.all], silent: true },
  });
}

export function useUpdateCargo(id: Id) {
  return useMutation({
    mutationFn: async (input: CargoPatch) =>
      (await api.cargos.update(id, input)).cargo,
    meta: { invalidates: invalidation.cargo, silent: true },
  });
}

export function useDeleteCargo() {
  return useMutation({
    mutationFn: (id: Id) => api.cargos.remove(id),
    meta: { invalidates: [queryKeys.cargos.all], silent: true },
  });
}

/** Runs the automatic check now: closes what is past its deadline, opens what is due. */
export function useCargoCheck() {
  return useMutation({
    mutationFn: () => api.cargos.check(),
    meta: { invalidates: invalidation.cargo },
  });
}

export function useCargoProducts(cargoId: Id, query: CargoProductQuery) {
  return useQuery({
    queryKey: queryKeys.cargos.products(cargoId, query),
    queryFn: ({ signal }) => api.cargos.products(cargoId, query, signal),
    placeholderData: keepPreviousData,
  });
}

/** Cargos that can be given orders, for "move to another cargo". */
export const CAN_TAKE_ORDERS: readonly CargoStatus[] = [
  "draft",
  "scheduled",
  "taking_orders",
  "orders_closed",
  "in_transit",
  "arrived",
];

/** The newest cargos, for choosing one (a move target, a source to copy from). */
export function useCargoChoices(enabled = true) {
  return useQuery({
    queryKey: queryKeys.cargos.list({ limit: 100 }),
    queryFn: ({ signal }) => api.cargos.list({ limit: 100 }, signal),
    enabled,
    staleTime: 60_000,
  });
}
