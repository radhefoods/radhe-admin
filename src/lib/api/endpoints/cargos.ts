// Section 9: cargos, their products, bulk order actions, cargo payments.

import type { Query } from "../http";
import type { SessionTransport } from "../session";
import type {
  BulkDeliveryMethodInput,
  BulkOrderStatus,
  BulkOrderStatusInput,
  Cargo,
  CargoCheckResult,
  CargoDetail,
  CargoInput,
  CargoOverview,
  CargoPatch,
  CargoPaymentActivation,
  CargoPaymentActivationInput,
  CargoPaymentSummary,
  CargoProductCounts,
  CargoProductItemInput,
  CargoProductQuery,
  CargoProductRow,
  CargoProductSetting,
  CargoQuery,
  CargoRollover,
  CargoStatusInput,
  CargoTransition,
  DeliveryMethod,
  Id,
  PageResult,
} from "../types";

export function cargosApi({ request }: SessionTransport) {
  const base = "/v1/admin/cargos";
  return {
    list: (query: CargoQuery = {}, signal?: AbortSignal) =>
      request<PageResult<Cargo>>(base, { query: query as Query, signal }),
    overview: (signal?: AbortSignal) =>
      request<CargoOverview>(`${base}/overview`, { signal }),
    get: (id: Id, signal?: AbortSignal) =>
      request<{ cargo: CargoDetail }>(`${base}/${id}`, { signal }),
    create: (input: CargoInput) =>
      request<{ cargo: CargoDetail }>(base, { method: "POST", body: input }),
    update: (id: Id, input: CargoPatch) =>
      request<{ cargo: CargoDetail }>(`${base}/${id}`, {
        method: "PATCH",
        body: input,
      }),
    remove: (id: Id) => request<void>(`${base}/${id}`, { method: "DELETE" }),

    open: (id: Id, note?: string) =>
      request<CargoTransition>(`${base}/${id}/open`, {
        method: "POST",
        body: { note },
      }),
    close: (id: Id, note?: string) =>
      request<CargoTransition>(`${base}/${id}/close`, {
        method: "POST",
        body: { note },
      }),
    /** Any allowed transition, with order exceptions or an order move. */
    setStatus: (id: Id, input: CargoStatusInput) =>
      request<CargoTransition>(`${base}/${id}/status`, {
        method: "PUT",
        body: input,
      }),
    rollover: (input: { nextCargoId: Id; note?: string }) =>
      request<CargoRollover>(`${base}/rollover`, {
        method: "POST",
        body: input,
      }),
    /** Runs the automatic check now. */
    check: () => request<CargoCheckResult>(`${base}/check`, { method: "POST" }),

    // 9.3 Products of a cargo
    products: (
      cargoId: Id,
      query: CargoProductQuery = {},
      signal?: AbortSignal,
    ) =>
      request<PageResult<CargoProductRow>>(`${base}/${cargoId}/products`, {
        query: query as Query,
        signal,
      }),
    putProducts: (cargoId: Id, items: CargoProductItemInput[]) =>
      request<{ products: CargoProductCounts }>(`${base}/${cargoId}/products`, {
        method: "PUT",
        body: { items },
      }),
    copyProducts: (cargoId: Id, fromCargoId: Id) =>
      request<{ added: number; products: CargoProductCounts }>(
        `${base}/${cargoId}/products/copy`,
        { method: "POST", body: { fromCargoId } },
      ),
    patchProduct: (
      cargoId: Id,
      productId: Id,
      input: { isEnabled?: boolean; maxQuantity?: number | null },
    ) =>
      request<{ productId: Id; cargo: CargoProductSetting }>(
        `${base}/${cargoId}/products/${productId}`,
        { method: "PATCH", body: input },
      ),
    removeProduct: (cargoId: Id, productId: Id) =>
      request<void>(`${base}/${cargoId}/products/${productId}`, {
        method: "DELETE",
      }),

    // 9.4 All orders of a cargo at once
    setOrdersStatus: (cargoId: Id, input: BulkOrderStatusInput) =>
      request<{ cargo: string; status: BulkOrderStatus; changed: number }>(
        `${base}/${cargoId}/orders/status`,
        { method: "POST", body: input },
      ),
    setOrdersDeliveryMethod: (cargoId: Id, input: BulkDeliveryMethodInput) =>
      request<{ cargo: string; method: DeliveryMethod; changed: number }>(
        `${base}/${cargoId}/orders/delivery-method`,
        { method: "POST", body: input },
      ),
    moveOrders: (cargoId: Id, input: { toCargoId: Id; note?: string }) =>
      request<{ from: string; to: string; moved: number }>(
        `${base}/${cargoId}/orders/move`,
        { method: "POST", body: input },
      ),

    // 9.5 Payments of a cargo
    /** Up to 100 orders per request: repeat while `remaining > 0`. */
    activatePayments: (cargoId: Id, input: CargoPaymentActivationInput) =>
      request<CargoPaymentActivation>(`${base}/${cargoId}/payments/activate`, {
        method: "POST",
        body: input,
      }),
    paymentSummary: (cargoId: Id, signal?: AbortSignal) =>
      request<CargoPaymentSummary>(`${base}/${cargoId}/payments/summary`, {
        signal,
      }),
  };
}
