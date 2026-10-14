import type {
  AnnouncementQuery,
  CargoProductQuery,
  CargoQuery,
  CustomerQuery,
  Id,
  InvoiceQuery,
  LegalType,
  NotificationQuery,
  OrderQuery,
  ProductQuery,
  RefundQuery,
  ReturnQuery,
} from "./types";

/**
 * Every key of the query cache, in one place. A key starts with its
 * resource, so `invalidate(queryKeys.orders.all)` reaches every list and
 * every detail of orders.
 *
 * What a change touches is named with the mutation (`meta.invalidates`):
 * an order that changes status also changes its cargo's numbers, the
 * attention overview and the list of messages.
 */
export const queryKeys = {
  me: ["me"] as const,

  attention: ["attention"] as const,

  adminUsers: {
    all: ["admin-users"] as const,
    list: () => ["admin-users", "list"] as const,
    detail: (id: Id) => ["admin-users", "detail", id] as const,
  },
  roles: {
    all: ["roles"] as const,
    list: () => ["roles", "list"] as const,
    permissions: () => ["roles", "permissions"] as const,
  },
  customers: {
    all: ["customers"] as const,
    list: (query: CustomerQuery) => ["customers", "list", query] as const,
    count: (query: CustomerQuery) => ["customers", "count", query] as const,
    detail: (id: Id) => ["customers", "detail", id] as const,
    ordering: (id: Id) => ["customers", "ordering", id] as const,
  },
  settings: ["settings"] as const,
  legal: {
    all: ["legal"] as const,
    list: (type?: LegalType) => ["legal", "list", type ?? "all"] as const,
    detail: (id: Id) => ["legal", "detail", id] as const,
  },
  categories: {
    all: ["categories"] as const,
    list: () => ["categories", "list"] as const,
    detail: (id: Id) => ["categories", "detail", id] as const,
  },
  products: {
    all: ["products"] as const,
    list: (query: ProductQuery) => ["products", "list", query] as const,
    detail: (id: Id) => ["products", "detail", id] as const,
    priceHistory: (id: Id) => ["products", "price-history", id] as const,
  },
  cargos: {
    all: ["cargos"] as const,
    list: (query: CargoQuery) => ["cargos", "list", query] as const,
    overview: () => ["cargos", "overview"] as const,
    detail: (id: Id) => ["cargos", "detail", id] as const,
    products: (id: Id, query: CargoProductQuery) =>
      ["cargos", "products", id, query] as const,
    productsOf: (id: Id) => ["cargos", "products", id] as const,
    paymentSummary: (id: Id) => ["cargos", "payment-summary", id] as const,
  },
  orders: {
    all: ["orders"] as const,
    list: (query: OrderQuery) => ["orders", "list", query] as const,
    count: (query: OrderQuery) => ["orders", "count", query] as const,
    /** Every order of a cargo, loaded page by page for bulk actions. */
    ofCargo: (cargoId: Id) => ["orders", "of-cargo", cargoId] as const,
    summary: (cargoId: Id) => ["orders", "summary", cargoId] as const,
    detail: (id: Id) => ["orders", "detail", id] as const,
    payment: (id: Id) => ["orders", "payment", id] as const,
  },
  returns: {
    all: ["returns"] as const,
    list: (query: ReturnQuery) => ["returns", "list", query] as const,
    count: (query: ReturnQuery) => ["returns", "count", query] as const,
    detail: (id: Id) => ["returns", "detail", id] as const,
  },
  refunds: {
    all: ["refunds"] as const,
    list: (query: RefundQuery) => ["refunds", "list", query] as const,
    count: (query: RefundQuery) => ["refunds", "count", query] as const,
    detail: (id: Id) => ["refunds", "detail", id] as const,
  },
  invoices: {
    all: ["invoices"] as const,
    list: (query: InvoiceQuery) => ["invoices", "list", query] as const,
    detail: (id: Id) => ["invoices", "detail", id] as const,
  },
  notifications: {
    all: ["notifications"] as const,
    list: (query: NotificationQuery) =>
      ["notifications", "list", query] as const,
    count: (query: NotificationQuery) =>
      ["notifications", "count", query] as const,
    summary: () => ["notifications", "summary"] as const,
    detail: (id: Id) => ["notifications", "detail", id] as const,
  },
  announcements: {
    all: ["announcements"] as const,
    list: (query: AnnouncementQuery) =>
      ["announcements", "list", query] as const,
    detail: (id: Id) => ["announcements", "detail", id] as const,
  },
  search: (text: string) => ["search", text] as const,
} as const;

type Key = readonly unknown[];

/**
 * What a change to one kind of record makes stale, beyond the record
 * itself. Orders, payments, returns and refunds hang together: a change to
 * one of them moves numbers in the others.
 */
export const invalidation = {
  order: [
    queryKeys.orders.all,
    queryKeys.cargos.all,
    queryKeys.attention,
    queryKeys.notifications.all,
  ],
  payment: [
    queryKeys.orders.all,
    queryKeys.cargos.all,
    queryKeys.invoices.all,
    queryKeys.refunds.all,
    queryKeys.attention,
    queryKeys.notifications.all,
    queryKeys.customers.all,
  ],
  return: [
    queryKeys.returns.all,
    queryKeys.orders.all,
    queryKeys.invoices.all,
    queryKeys.cargos.all,
    queryKeys.attention,
    queryKeys.notifications.all,
  ],
  cargo: [
    queryKeys.cargos.all,
    queryKeys.orders.all,
    queryKeys.attention,
    queryKeys.notifications.all,
  ],
  catalog: [
    queryKeys.products.all,
    queryKeys.categories.all,
    queryKeys.cargos.all,
  ],
  notification: [
    queryKeys.notifications.all,
    queryKeys.announcements.all,
    queryKeys.attention,
  ],
} as const satisfies Record<string, readonly Key[]>;
