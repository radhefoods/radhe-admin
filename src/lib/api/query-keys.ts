import type {
  AnalyticsQuery,
  AnnouncementQuery,
  BlogPostQuery,
  CustomerQuery,
  DiscountQuery,
  FaqQuery,
  Id,
  InvoiceQuery,
  IssueQuery,
  LegalType,
  NotificationQuery,
  OrderQuery,
  PageQuery,
  ProductQuery,
  QuotationQuery,
  ReferralQuery,
  RefundQuery,
  ReturnQuery,
  ReviewQuery,
  RewardAccountQuery,
  RewardTransactionQuery,
  WholesaleProductQuery,
  WholesaleStockMovementQuery,
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
    /** How the price of each pack size comes about (31). */
    pricing: (id: Id) => ["products", "pricing", id] as const,
  },
  orders: {
    all: ["orders"] as const,
    list: (query: OrderQuery) => ["orders", "list", query] as const,
    count: (query: OrderQuery) => ["orders", "count", query] as const,
    detail: (id: Id) => ["orders", "detail", id] as const,
    payment: (id: Id) => ["orders", "payment", id] as const,
    /** What the order cost and earned (32): needs `finance.read`. */
    profit: (id: Id) => ["orders", "profit", id] as const,
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
  /** Wholesale quotations (24). */
  quotations: {
    all: ["quotations"] as const,
    list: (query: QuotationQuery) => ["quotations", "list", query] as const,
    detail: (id: Id) => ["quotations", "detail", id] as const,
  },
  /** Referrals (27): lists and counts only. */
  referrals: {
    all: ["referrals"] as const,
    list: (query: ReferralQuery = {}) => ["referrals", "list", query] as const,
    count: (query: ReferralQuery = {}) =>
      ["referrals", "count", query] as const,
  },
  /** Order reviews (28). */
  reviews: {
    all: ["reviews"] as const,
    list: (query: ReviewQuery = {}) => ["reviews", "list", query] as const,
    count: (query: ReviewQuery = {}) => ["reviews", "count", query] as const,
    detail: (id: Id) => ["reviews", "detail", id] as const,
  },
  /**
   * Costs and profit (32). The breakdown of an order is a key of the
   * orders (`orders.profit`), so that whatever loads an order again loads
   * its profit again.
   */
  finance: {
    settings: ["finance", "settings"] as const,
  },
  /**
   * The price rule and what goes with it (31). The pricing of a product is
   * a key of the products (`products.pricing`), so that whatever loads a
   * product again loads its pricing again.
   */
  supply: {
    settings: ["supply", "settings"] as const,
  },
  /** Points and rewards (30): the rules, the overview, the accounts, the ledger. */
  rewards: {
    all: ["rewards"] as const,
    settings: ["rewards", "settings"] as const,
    summary: ["rewards", "summary"] as const,
    accounts: (query: RewardAccountQuery = {}) =>
      ["rewards", "accounts", query] as const,
    account: (customerId: Id) => ["rewards", "account", customerId] as const,
    transactions: (query: RewardTransactionQuery = {}) =>
      ["rewards", "transactions", query] as const,
    transactionCount: (query: RewardTransactionQuery = {}) =>
      ["rewards", "transaction-count", query] as const,
  },
  /** Problem reports (29). */
  issues: {
    all: ["issues"] as const,
    list: (query: IssueQuery = {}) => ["issues", "list", query] as const,
    count: (query: IssueQuery = {}) => ["issues", "count", query] as const,
    detail: (id: Id) => ["issues", "detail", id] as const,
  },
  /** Discount codes of the retail shop (26). */
  discounts: {
    all: ["discounts"] as const,
    list: (query: DiscountQuery = {}) => ["discounts", "list", query] as const,
    detail: (id: Id) => ["discounts", "detail", id] as const,
    /** The orders made with a code, by page. */
    uses: (id: Id, query: PageQuery = {}) =>
      ["discounts", "uses", id, query] as const,
  },
  /** The wholesale catalogue (25). */
  wholesale: {
    all: ["wholesale"] as const,
    categories: () => ["wholesale", "categories"] as const,
    /** The products of a wholesale category, in display order. */
    categoryProducts: (id: Id) =>
      ["wholesale", "category-products", id] as const,
    products: (query: WholesaleProductQuery) =>
      ["wholesale", "products", query] as const,
    product: (id: Id) => ["wholesale", "product", id] as const,
    /** The stock ledger of a wholesale product, by page. */
    stockMovements: (id: Id, query: WholesaleStockMovementQuery) =>
      ["wholesale", "stock-movements", id, query] as const,
  },
} as const;

type Key = readonly unknown[];

/**
 * What a change to one kind of record makes stale, beyond the record
 * itself. Orders, payments, returns, refunds and stock hang together: a
 * change to one of them moves numbers in the others.
 */
/**
 * What an order moves in the programmes around it (27, 30): a delivery earns
 * coins and makes a referral count; a credit or a cancellation gives
 * redeemed coins back, takes earned ones away and may void a referral.
 */
const loyalty = [queryKeys.rewards.all, queryKeys.referrals.all] as const;

export const invalidation = {
  /** A status change, a cancellation (stock goes back), a delivery change. */
  order: [
    queryKeys.orders.all,
    queryKeys.products.all,
    queryKeys.attention,
    queryKeys.notifications.all,
    ...loyalty,
  ],
  /** A correction, a refund: documents and money move. */
  payment: [
    queryKeys.orders.all,
    queryKeys.products.all,
    queryKeys.invoices.all,
    queryKeys.refunds.all,
    queryKeys.attention,
    queryKeys.notifications.all,
    ...loyalty,
  ],
  /** A decided or completed return: the order, its documents, maybe the stock. */
  return: [
    queryKeys.returns.all,
    queryKeys.orders.all,
    queryKeys.products.all,
    queryKeys.invoices.all,
    queryKeys.attention,
    queryKeys.notifications.all,
    ...loyalty,
  ],
  /** A product or category written, archived, deleted or imported: the lists, and the start page, which names the pack sizes running low. */
  catalog: [
    queryKeys.products.all,
    queryKeys.categories.all,
    queryKeys.attention,
  ],
  /** A stock change: the product, its ledger, and the low-stock group of the start page. */
  stock: [queryKeys.products.all, queryKeys.attention],
  notification: [
    queryKeys.notifications.all,
    queryKeys.announcements.all,
    queryKeys.attention,
    // The emails of a quotation are shown on its page.
    queryKeys.quotations.all,
  ],
  /** A priced, sent or closed quotation: its list, the start page, its emails; accepting takes wholesale stock. */
  quotation: [
    queryKeys.quotations.all,
    queryKeys.attention,
    queryKeys.notifications.all,
    queryKeys.wholesale.all,
  ],
  /** A wholesale category or product: the lists, the details, the ledgers; the quotation lines show the stock. */
  wholesale: [queryKeys.wholesale.all, queryKeys.quotations.all],
  /** A discount code: its list and its page. Orders keep what they were made with. */
  discount: [queryKeys.discounts.all],
  /** A decided or answered review: its lists and the start page; a published one earns coins, a rejected or deleted one loses them (30). */
  review: [queryKeys.reviews.all, queryKeys.attention, queryKeys.rewards.all],
  /** Coins adjusted by hand: the account, the lists, the overview. */
  rewards: [queryKeys.rewards.all],
  /** A decided problem report: a refund corrects the order and queues the money, as a return does. */
  issue: [
    queryKeys.issues.all,
    queryKeys.orders.all,
    queryKeys.products.all,
    queryKeys.invoices.all,
    queryKeys.refunds.all,
    queryKeys.attention,
    queryKeys.notifications.all,
    ...loyalty,
  ],
} as const satisfies Record<string, readonly Key[]>;
