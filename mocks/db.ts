// What the mock keeps in memory. Records have the shape of the API's
// objects wherever possible, plus what the API never shows (passwords,
// authenticator secrets, sessions). Everything is lost on restart.

import type {
  AdminImage,
  AdminStatus,
  Announcement,
  CargoDetail,
  Category,
  Customer,
  InvoiceDetail,
  LegalDocument,
  NotificationDetail,
  OrderDetail,
  OrderReturn,
  PaymentBlockActive,
  PriceChange,
  ProductDetail,
  Refund,
  Role,
  Settings,
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
> & {
  regularPrice: number;
  salePrice: number | null;
  vatRate: number;
  isDefaultVariant: boolean;
};

export type CategoryRecord = Omit<
  Category,
  "productCount" | "ancestorIds" | "level"
>;

export type CargoRecord = Omit<
  CargoDetail,
  "isAcceptingOrders" | "attention" | "allowedStatuses" | "products"
>;

export interface CargoProductRecord {
  cargoId: string;
  productId: string;
  isEnabled: boolean;
  maxQuantity: number | null;
  orderedQuantity: number;
}

/** The payment of an order as stored: the flags are worked out on reading. */
export type PaymentRecord = Omit<
  PaymentBlockActive,
  | "canActivate"
  | "isOverdue"
  | "canPayOnline"
  | "canRecordCash"
  | "canWaive"
  | "status"
> & { failedAt: string | null };

export type OrderRecord = Omit<
  OrderDetail,
  | "payment"
  | "canCancel"
  | "allowedStatuses"
  | "canMove"
  | "total"
  | "finalTotal"
  | "lineCount"
  | "itemCount"
  | "city"
  | "postalCode"
> & { payment: PaymentRecord | null };

export interface StoredFile {
  bytes: Uint8Array;
  type: string;
}

export interface MockConfig {
  /** Section 19: Stripe is built, the account is not connected. */
  stripe: boolean;
  /** Section 19: WhatsApp is off until credentials exist. */
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
  cargos: CargoRecord[];
  cargoProducts: CargoProductRecord[];
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
    cargo: number;
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
      delivery: { defaultMethod: "radhe_delivery" },
      returnPolicy: { windowDays: 14 },
      company: {
        name: "Radhe Foods",
        addressLines: [],
        email: "",
        missingForInvoices: [],
      },
      payments: {
        reminderHour: 9,
        defaultDeadlineDays: 5,
        checkoutMinutes: 60,
      },
    },
    legal: [],
    categories: [],
    products: [],
    priceChanges: new Map(),
    cargos: [],
    cargoProducts: [],
    orders: [],
    returns: [],
    refunds: [],
    invoices: [],
    notifications: [],
    announcements: [],
    files: new Map(),
    counters: { order: 1000, cargo: 20, sku: 0, invoice: 0, creditNote: 0 },
  };
}

export type { AdminImage };
