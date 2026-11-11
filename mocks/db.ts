// What the mock keeps in memory. Records have the shape of the API's
// objects wherever possible, plus what the API never shows (passwords,
// authenticator secrets, sessions). Everything is lost on restart.

import type {
  AdminImage,
  AdminStatus,
  Announcement,
  Banner,
  Category,
  Customer,
  InvoiceDetail,
  LegalDocument,
  LegalType,
  NotificationDetail,
  OrderDetail,
  OrderReturn,
  PackUnit,
  PaymentType,
  PriceChange,
  PricingOverride,
  ProductDetail,
  Refund,
  OrderCostSettings,
  RewardsSettings,
  SupplySettings,
  Role,
  Settings,
  StockMovement,
} from "../src/lib/api/types/index.ts";
import type {
  IssueRecord,
  ReferralRecord,
  ReviewRecord,
} from "./modules/accounts.ts";
import type { BlogCategoryRecord, BlogPostRecord } from "./modules/blog.ts";
import type {
  DiscountCodeRecord,
  DiscountUseRecord,
} from "./modules/discounts.ts";
import type { FaqGroupRecord, FaqRecord } from "./modules/faq.ts";
import type { QuotationRecord } from "./modules/quotations.ts";
import type {
  RewardAccountRecord,
  RewardTransactionRecord,
} from "./modules/rewards.ts";
import type {
  WholesaleCategoryRecord,
  WholesaleProductRecord,
  WholesaleStockMovementRecord,
} from "./modules/wholesale.ts";

export interface AdminRecord {
  id: string;
  email: string;
  name: string;
  status: AdminStatus;
  roleId: string;
  password: string;
  /** Base32. `null`: no authenticator yet. */
  totpSecret: string | null;
  /** Handed out by `mfa/setup`, active after the first right code. */
  pendingTotpSecret: string | null;
  lastTotpStep: number | null;
  mustChangePassword: boolean;
  failedLogins: number;
  lockedUntil: number | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionRecord {
  id: string;
  adminId: string;
  accessToken: string;
  accessExpiresAt: number;
  refreshToken: string;
  /** Ends without use (12 hours) ... */
  refreshExpiresAt: number;
  /** ... and in any case (72 hours). */
  absoluteExpiresAt: number;
  revoked: boolean;
}

export interface MfaTicket {
  token: string;
  adminId: string;
  expiresAt: number;
}

/** The stock as stored: `isLow` is worked out on reading. */
export interface StockRecord {
  quantity: number;
  lowStockThreshold: number | null;
}

/**
 * A pack size as stored (architecture, "Product document"): its URL, its
 * display name, its prices and whether it is the default are worked out
 * on reading. Its pictures are its own (doc/VARIANT_IMAGES.md): two pack
 * sizes that show the same file have entries with different ids and the
 * same `url`.
 */
export interface VariantRecord {
  id: string;
  sku: string;
  gtin: string | null;
  packSize: { value: number; unit: PackUnit; label: string };
  regularPrice: number;
  salePrice: number | null;
  /** The buying price in cents, up to four decimals (31); `null`: not known. */
  cost: number | null;
  /** `auto`: the regular price follows the buying price and the price rule. */
  priceMode: "auto" | "manual";
  /** The values of the price rule the pack size sets itself (31); `null`: it follows its product. */
  priceRule: PricingOverride | null;
  isEnabled: boolean;
  stock: StockRecord;
  /** In the admin's order, at most 8. */
  images: AdminImage[];
  createdAt: string;
}

/** A product as stored, with its pack sizes; everything derived is worked out on reading. */
export type ProductRecord = Omit<
  ProductDetail,
  | "imageCount"
  | "image"
  | "category"
  | "priceFrom"
  | "defaultVariant"
  | "variants"
  | "variantCount"
  | "stock"
  | "deletable"
  | "notDeletableReason"
> & {
  vatRate: number;
  variants: VariantRecord[];
};

/** One line of the stock ledger, with the product it belongs to. */
export type StockMovementRecord = StockMovement & { productId: string };

export type CategoryRecord = Omit<
  Category,
  "productCount" | "ancestorIds" | "level"
>;

/** A homepage banner as stored (20): its status is worked out on reading. */
export type BannerRecord = Omit<Banner, "status">;

/**
 * The payment of an order as stored (architecture, "Order document"): the
 * status lives on the order, the flags are worked out on reading.
 */
export interface PaymentRecord {
  amount: number;
  paidAmount: number;
  creditedAmount: number;
  refundedAmount: number;
  attempts: number;
  checkoutSessionId: string | null;
  checkoutUrl: string | null;
  checkoutExpiresAt: string | null;
  paymentIntentId: string | null;
  chargeId: string | null;
  paymentType: PaymentType | null;
  receiptUrl: string | null;
  authorizedAt: string | null;
  paidAt: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  lastFailure: string | null;
}

export type OrderRecord = Omit<
  OrderDetail,
  | "payment"
  | "canCancel"
  | "allowedStatuses"
  | "total"
  | "finalTotal"
  | "paidAmount"
  | "lineCount"
  | "itemCount"
  | "city"
  | "postalCode"
  | "discountCode"
> & {
  payment: PaymentRecord;
  /** While pending: when the cleanup gives the order up. */
  pendingUntil: string | null;
  /** While the units are off the shelf for this order. */
  stockTakenAt: string | null;
};

export interface StoredFile {
  bytes: Uint8Array;
  type: string;
}

export interface MockConfig {
  /** Section 18: Stripe is built, the account is not connected. */
  stripe: boolean;
  /** Section 18: WhatsApp is off until credentials exist. */
  whatsapp: boolean;
  /** The address the mock is reached at, for the URLs of pictures. */
  publicUrl: string;
}

/** The address and the search-engine texts an admin set for a legal page (6). */
export interface LegalPageRecord {
  slug?: { en?: string; de?: string };
  seo?: {
    title?: { en?: string; de?: string };
    description?: { en?: string; de?: string };
  };
  updatedAt: string;
}

export interface Db {
  config: MockConfig;
  admins: AdminRecord[];
  roles: Role[];
  sessions: SessionRecord[];
  mfaTickets: MfaTicket[];
  customers: Customer[];
  settings: Settings;
  legal: LegalDocument[];
  /** What the admin set for the page of a legal text (6): one record per type, at most. */
  legalPages: Partial<Record<LegalType, LegalPageRecord>>;
  categories: CategoryRecord[];
  products: ProductRecord[];
  /** The price history of each pack size, by its id, newest first. */
  priceChanges: Map<string, PriceChange[]>;
  stockMovements: StockMovementRecord[];
  orders: OrderRecord[];
  returns: OrderReturn[];
  refunds: Refund[];
  invoices: InvoiceDetail[];
  notifications: NotificationDetail[];
  announcements: Announcement[];
  /** The homepage banners (20). */
  banners: BannerRecord[];
  /** The FAQ (22): the groups and the questions. */
  faqGroups: FaqGroupRecord[];
  faqs: FaqRecord[];
  /** The blog (23). */
  blogCategories: BlogCategoryRecord[];
  blogPosts: BlogPostRecord[];
  /** Wholesale quotations (24). */
  quotations: QuotationRecord[];
  /** The wholesale catalogue (25): categories, products with SKUs, the stock ledger. */
  wholesaleCategories: WholesaleCategoryRecord[];
  wholesaleProducts: WholesaleProductRecord[];
  wholesaleStockMovements: WholesaleStockMovementRecord[];
  /** Discount codes of the retail shop (26) and their uses by orders. */
  discountCodes: DiscountCodeRecord[];
  discountUses: DiscountUseRecord[];
  /** Referrals (27), order reviews (28) and problem reports (29). */
  referrals: ReferralRecord[];
  reviews: ReviewRecord[];
  issues: IssueRecord[];
  /** The price rule of the shop, the safety buffer, the brand list (31). */
  supplySettings: SupplySettings;
  /** Costs and profit (32): what one order costs besides its goods. */
  orderCosts: OrderCostSettings;
  /** Points and rewards (30): the rules, one account per customer, the ledger. */
  rewardsSettings: RewardsSettings;
  rewardAccounts: RewardAccountRecord[];
  rewardTransactions: RewardTransactionRecord[];
  /** Pictures uploaded while the mock runs, by the key in their address. */
  files: Map<string, StoredFile>;
  counters: {
    order: number;
    sku: number;
    invoice: number;
    creditNote: number;
    /** Quotation numbers, per year in the real API; the demo covers one year. */
    quotation: number;
    /** Generated wholesale article numbers, `RFW-00001…`. */
    wholesaleSku: number;
  };
}

/** The defaults in the code (REWARDS.md, section 2): the program is off. */
const DEFAULT_REWARDS_SETTINGS: RewardsSettings = {
  enabled: false,
  earning: {
    order: { enabled: true, coinsPerEuro: 1 },
    welcome: { enabled: false, coins: 0 },
    referral: {
      inviter: { enabled: true, coins: 100 },
      invitee: { enabled: false, coins: 50 },
    },
    review: { enabled: false, coins: 0 },
    campaign: {
      enabled: false,
      multiplier: 2,
      startsAt: null,
      endsAt: null,
      name: null,
    },
  },
  redemption: {
    enabled: true,
    percentPerCoin: 0.01,
    minCoins: null,
    minRedeemValue: null,
    minOrderValue: null,
    maxCoinsPerOrder: null,
    maxDiscount: 500,
    combinableWithDiscountCodes: true,
  },
  expiry: { enabled: false, inactivityMonths: 12 },
};

export function emptyDb(config: MockConfig): Db {
  return {
    config,
    admins: [],
    roles: [],
    sessions: [],
    mfaTickets: [],
    customers: [],
    settings: {
      deliveryFee: { tiers: [{ minOrderValue: 0, fee: 0 }] },
      orderPolicy: { customerCancellation: "until_dispatched" },
      delivery: {
        defaultMethod: "radhe_delivery",
        estimate: { en: "2 to 4 working days", de: "2 bis 4 Werktage" },
      },
      returnPolicy: { windowDays: 14, issueWindowDays: 14 },
      company: {
        name: "Radhe Foods",
        addressLines: [],
        email: "",
        missingForInvoices: [],
      },
      payments: { checkoutMinutes: 60 },
    },
    legal: [],
    legalPages: {},
    categories: [],
    products: [],
    priceChanges: new Map(),
    stockMovements: [],
    orders: [],
    returns: [],
    refunds: [],
    invoices: [],
    notifications: [],
    announcements: [],
    banners: [],
    faqGroups: [],
    faqs: [],
    blogCategories: [],
    blogPosts: [],
    quotations: [],
    wholesaleCategories: [],
    wholesaleProducts: [],
    wholesaleStockMovements: [],
    discountCodes: [],
    discountUses: [],
    referrals: [],
    reviews: [],
    issues: [],
    // The owner's values: five units held back, 10 % fulfilment and 35 %
    // markup on the buying price (31).
    supplySettings: {
      safetyUnits: 5,
      pricing: {
        fulfilmentPercent: 10,
        extraPercent: 0,
        extraAmount: 0,
        markupPercent: 35,
      },
      brands: [
        { prefix: "AB", name: "AliBaba" },
        { prefix: "Britania", name: "Britannia" },
        { prefix: "KRG", name: "KRG" },
        { prefix: "NW Pooja", name: "" },
      ],
      publishCheck: true,
    },
    // Until an admin saves something: no costs, and Stripe's price for a
    // standard European card in Germany as the estimate of the fee (32).
    orderCosts: {
      deliveryCost: 0,
      packagingCost: 0,
      otherCost: 0,
      paymentFee: { percent: 1.5, fixed: 25 },
    },
    rewardsSettings: DEFAULT_REWARDS_SETTINGS,
    rewardAccounts: [],
    rewardTransactions: [],
    files: new Map(),
    counters: {
      order: 1000,
      sku: 0,
      invoice: 0,
      creditNote: 0,
      quotation: 0,
      wholesaleSku: 0,
    },
  };
}

export type { AdminImage };
