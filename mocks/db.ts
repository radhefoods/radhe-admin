// What the mock keeps in memory. Records have the shape of the API's
// objects wherever possible, plus what the API never shows (passwords,
// authenticator secrets, sessions). Everything is lost on restart.

import type {
  AdminImage,
  AdminStatus,
  Announcement,
  Category,
  Customer,
  InvoiceDetail,
  LegalDocument,
  NotificationDetail,
  OrderDetail,
  OrderReturn,
  PaymentType,
  PriceChange,
  ProductDetail,
  Refund,
  Role,
  Settings,
  StockMovement,
} from "../src/lib/api/types/index.ts";

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

/** A product as stored: the pack sizes of its group are worked out on reading. */
export type ProductRecord = Omit<
  ProductDetail,
  | "packSizes"
  | "packSizeCount"
  | "imageCount"
  | "image"
  | "pricing"
  | "category"
  | "isDefaultVariant"
  | "stock"
> & {
  regularPrice: number;
  salePrice: number | null;
  vatRate: number;
  isDefaultVariant: boolean;
  stock: StockRecord;
};

/** One line of the stock ledger, with the product it belongs to. */
export type StockMovementRecord = StockMovement & { productId: string };

export type CategoryRecord = Omit<
  Category,
  "productCount" | "ancestorIds" | "level"
>;

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

export interface Db {
  config: MockConfig;
  admins: AdminRecord[];
  roles: Role[];
  sessions: SessionRecord[];
  mfaTickets: MfaTicket[];
  customers: Customer[];
  settings: Settings;
  legal: LegalDocument[];
  categories: CategoryRecord[];
  products: ProductRecord[];
  priceChanges: Map<string, PriceChange[]>;
  stockMovements: StockMovementRecord[];
  orders: OrderRecord[];
  returns: OrderReturn[];
  refunds: Refund[];
  invoices: InvoiceDetail[];
  notifications: NotificationDetail[];
  announcements: Announcement[];
  /** Pictures uploaded while the mock runs, by the key in their address. */
  files: Map<string, StoredFile>;
  counters: {
    order: number;
    sku: number;
    invoice: number;
    creditNote: number;
  };
}

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
      returnPolicy: { windowDays: 14 },
      company: {
        name: "Radhe Foods",
        addressLines: [],
        email: "",
        missingForInvoices: [],
      },
      payments: { checkoutMinutes: 60 },
    },
    legal: [],
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
    files: new Map(),
    counters: { order: 1000, sku: 0, invoice: 0, creditNote: 0 },
  };
}

export type { AdminImage };
