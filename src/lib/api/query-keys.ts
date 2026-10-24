import type {
  AnalyticsQuery,
  AnnouncementQuery,
  BlogPostQuery,
  CustomerQuery,
  FaqQuery,
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
 * an order that changes status also changes the attention overview and
 * the list of messages; a cancellation gives stock back to products.
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
    /** The products directly in a category, in display order. */
    products: (id: Id) => ["categories", "products", id] as const,
  },
  banners: {
    all: ["banners"] as const,
    list: () => ["banners", "list"] as const,
  },
  products: {
    all: ["products"] as const,
    list: (query: ProductQuery) => ["products", "list", query] as const,
    detail: (id: Id) => ["products", "detail", id] as const,
    /** The prices one pack size had, newest first. */
    priceHistory: (id: Id, variantId: Id) =>
      ["products", "price-history", id, variantId] as const,
    /** The stock history of one pack size, newest first. */
    stockMovements: (id: Id, variantId: Id) =>
      ["products", "stock-movements", id, variantId] as const,
  },
  orders: {
    all: ["orders"] as const,
    list: (query: OrderQuery) => ["orders", "list", query] as const,
    count: (query: OrderQuery) => ["orders", "count", query] as const,
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
  /** The figures of a period (21); each endpoint under its own name. */
  analytics: {
    all: ["analytics"] as const,
    part: (part: string, query: AnalyticsQuery & Record<string, unknown>) =>
      ["analytics", part, query] as const,
  },
  faq: {
    all: ["faq"] as const,
    groups: () => ["faq", "groups"] as const,
    list: (query: FaqQuery = {}) => ["faq", "list", query] as const,
    detail: (id: Id) => ["faq", "detail", id] as const,
  },
  blog: {
    all: ["blog"] as const,
    posts: (query: BlogPostQuery) => ["blog", "posts", query] as const,
    post: (id: Id) => ["blog", "post", id] as const,
    tags: () => ["blog", "tags"] as const,
    categories: () => ["blog", "categories"] as const,
  },
} as const;

type Key = readonly unknown[];

/**
 * What a change to one kind of record makes stale, beyond the record
 * itself. Orders, payments, returns, refunds and stock hang together: a
 * change to one of them moves numbers in the others.
 */
export const invalidation = {
  /** A status change, a cancellation (stock goes back), a delivery change. */
  order: [
    queryKeys.orders.all,
    queryKeys.products.all,
    queryKeys.attention,
    queryKeys.notifications.all,
  ],
  /** A correction, a refund: documents and money move. */
  payment: [
    queryKeys.orders.all,
    queryKeys.products.all,
    queryKeys.invoices.all,
    queryKeys.refunds.all,
    queryKeys.attention,
    queryKeys.notifications.all,
  ],
  /** A decided or completed return: the order, its documents, maybe the stock. */
  return: [
    queryKeys.returns.all,
    queryKeys.orders.all,
    queryKeys.products.all,
    queryKeys.invoices.all,
    queryKeys.attention,
    queryKeys.notifications.all,
  ],
  catalog: [queryKeys.products.all, queryKeys.categories.all],
  /** A stock change: the product, its ledger, and the low-stock group of the start page. */
  stock: [queryKeys.products.all, queryKeys.attention],
  notification: [
    queryKeys.notifications.all,
    queryKeys.announcements.all,
    queryKeys.attention,
  ],
} as const satisfies Record<string, readonly Key[]>;
