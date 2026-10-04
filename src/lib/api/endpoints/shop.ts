// Sections 4 (customers), 5 (settings) and 6 (legal texts).

import type { Query } from "../http";
import type { SessionTransport } from "../session";
import type {
  CompanyInput,
  CompanySettings,
  CreateLegalDocumentInput,
  CursorResult,
  Customer,
  CustomerCancellation,
  CustomerOrdering,
  CustomerQuery,
  CustomerStatus,
  DeliveryFeeTier,
  DeliveryMethod,
  Id,
  LegalDocument,
  LegalDocumentList,
  LegalType,
  OrderingDecisionInput,
  PaymentSettings,
  Settings,
  UpdateLegalDocumentInput,
} from "../types";

export function customersApi({ request }: SessionTransport) {
  const base = "/v1/admin/customers";
  return {
    list: (query: CustomerQuery = {}, signal?: AbortSignal) =>
      request<CursorResult<Customer>>(base, { query: query as Query, signal }),
    get: (id: Id, signal?: AbortSignal) =>
      request<{ customer: Customer }>(`${base}/${id}`, { signal }),
    setStatus: (id: Id, input: { status: CustomerStatus; reason?: string }) =>
      request<{ customer: Customer }>(`${base}/${id}/status`, {
        method: "PATCH",
        body: input,
      }),
    ordering: (id: Id, signal?: AbortSignal) =>
      request<CustomerOrdering>(`${base}/${id}/ordering`, { signal }),
    decideOrdering: (id: Id, input: OrderingDecisionInput) =>
      request<CustomerOrdering>(`${base}/${id}/ordering`, {
        method: "POST",
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
    putDelivery: (defaultMethod: DeliveryMethod) =>
      request<Pick<Settings, "delivery">>(`${base}/delivery`, {
        method: "PUT",
        body: { defaultMethod },
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
    putPayments: (input: PaymentSettings) =>
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
