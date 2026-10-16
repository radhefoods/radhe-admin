// Sections 4 (customers), 5 (settings) and 6 (legal texts).

import type { Query } from "../http";
import type { SessionTransport } from "../session";
import type {
  CompanyInput,
  CompanySettings,
  CreateLegalDocumentInput,
  CountResult,
  CursorResult,
  Customer,
  CustomerCancellation,
  CustomerQuery,
  CustomerStatusInput,
  DeliveryFeeTier,
  DeliverySettings,
  Id,
  LegalDocument,
  LegalDocumentList,
  LegalType,
  PaymentSettings,
  PaymentsInput,
  Settings,
  UpdateLegalDocumentInput,
} from "../types";

export function customersApi({ request }: SessionTransport) {
  const base = "/v1/admin/customers";
  return {
    list: (query: CustomerQuery = {}, signal?: AbortSignal) =>
      request<CursorResult<Customer>>(base, { query: query as Query, signal }),
    count: (query: CustomerQuery = {}, signal?: AbortSignal) =>
      request<CountResult>(`${base}/count`, {
        query: query as Query,
        signal,
      }),
    get: (id: Id, signal?: AbortSignal) =>
      request<{ customer: Customer }>(`${base}/${id}`, { signal }),
    /** Blocks or unblocks the account. */
    setStatus: (id: Id, input: CustomerStatusInput) =>
      request<{ customer: Customer }>(`${base}/${id}/status`, {
        method: "PATCH",
        body: input,
      }),
  };
}

export function settingsApi({ request }: SessionTransport) {
  const base = "/v1/admin/settings";
  return {
    get: (signal?: AbortSignal) => request<Settings>(base, { signal }),
    putDeliveryFee: (tiers: DeliveryFeeTier[]) =>
      request<Pick<Settings, "deliveryFee">>(`${base}/delivery-fee`, {
        method: "PUT",
        body: { tiers },
      }),
    putOrderPolicy: (customerCancellation: CustomerCancellation) =>
      request<Pick<Settings, "orderPolicy">>(`${base}/order-policy`, {
        method: "PUT",
        body: { customerCancellation },
      }),
    /** The default method of new orders and the delivery estimate in both languages. */
    putDelivery: (input: DeliverySettings) =>
      request<Pick<Settings, "delivery">>(`${base}/delivery`, {
        method: "PUT",
        body: input,
      }),
    putReturnPolicy: (windowDays: number) =>
      request<Pick<Settings, "returnPolicy">>(`${base}/return-policy`, {
        method: "PUT",
        body: { windowDays },
      }),
    putCompany: (input: CompanyInput) =>
      request<{ company: CompanySettings }>(`${base}/company`, {
        method: "PUT",
        body: input,
      }),
    /** How long a Stripe payment page stays open. */
    putPayments: (input: PaymentsInput) =>
      request<{ payments: PaymentSettings }>(`${base}/payments`, {
        method: "PUT",
        body: input,
      }),
  };
}

export function legalApi({ request }: SessionTransport) {
  const base = "/v1/admin/legal-documents";
  return {
    list: (type?: LegalType, signal?: AbortSignal) =>
      request<LegalDocumentList>(base, { query: { type }, signal }),
    get: (id: Id, signal?: AbortSignal) =>
      request<{ document: LegalDocument }>(`${base}/${id}`, { signal }),
    create: (input: CreateLegalDocumentInput) =>
      request<{ document: LegalDocument }>(base, {
        method: "POST",
        body: input,
      }),
    update: (id: Id, input: UpdateLegalDocumentInput) =>
      request<{ document: LegalDocument }>(`${base}/${id}`, {
        method: "PATCH",
        body: input,
      }),
    publish: (id: Id) =>
      request<{ document: LegalDocument }>(`${base}/${id}/publish`, {
        method: "POST",
      }),
    remove: (id: Id) => request<void>(`${base}/${id}`, { method: "DELETE" }),
  };
}
