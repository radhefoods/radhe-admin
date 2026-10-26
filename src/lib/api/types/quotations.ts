// Section 24: wholesale quotations (B2B). doc/QUOTATIONS.md has the
// workflow, the objects, the emails and the rules.

import type { PackSize } from "./catalog";
import type {
  AdminRef,
  Cents,
  Id,
  IsoDateTime,
  Locale,
  PageQuery,
  VatRate,
} from "./common";
import type { Notification } from "./notifications";
import type { Carton } from "./wholesale";

export const QUOTATION_STATUSES = [
  "new",
  "draft",
  "sent",
  "accepted",
  "declined",
  "cancelled",
] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];

/** The statuses nothing can change any more. */
export const QUOTATION_CLOSED: readonly QuotationStatus[] = [
  "accepted",
  "declined",
  "cancelled",
];

export const QUOTATION_SORTS = ["newest", "updated", "company"] as const;
export type QuotationSort = (typeof QUOTATION_SORTS)[number];

export const QUOTATION_RULES = {
  /** `limit` default of the list. */
  pageLimit: 24,
  /** Net price per carton in cents. */
  priceMin: 1,
  priceMax: 10_000_000,
  cartonsMin: 1,
  cartonsMax: 10_000,
} as const;

export interface QuotationContact {
  name: string;
  company: string;
  email: string;
  phone: string | null;
  city: string | null;
}

/** The sums once every line is priced; cents, net and gross. */
export interface QuotationTotals {
  cartons: number;
  net: Cents;
  vat: { vatRate: VatRate; net: Cents; vat: Cents; gross: Cents }[];
  vatTotal: Cents;
  gross: Cents;
}

export interface QuotationSummary {
  id: Id;
  /** `Q-2026-0001`, per year. */
  number: string;
  status: QuotationStatus;
  contact: QuotationContact;
  itemCount: number;
  /** The cartons over all lines. */
  cartons: number;
  /** Lines with a price. */
  pricedLines: number;
  /** `null` until every line has a price. */
  totals: QuotationTotals | null;
  /** 0 until the first send; each send after a price change counts up. */
  revision: number;
  sentAt: IsoDateTime | null;
  firstSentAt: IsoDateTime | null;
  sentCount: number;
  pricedAt: IsoDateTime | null;
  closedAt: IsoDateTime | null;
  updatedBy: AdminRef | null;
  sentBy: AdminRef | null;
  closedBy: AdminRef | null;
  /** `null` until accepted; then what accepting took from the wholesale stock. */
  stock: QuotationStockSummary | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** The wholesale stock of the SKU of a line right now (25). */
export interface QuotationItemStock {
  /** Cartons on hand. */
  quantity: number;
  /** Before acceptance: the cartons asked for exceed the count. */
  short: boolean;
}

/** A line: the wholesale product as it was at the request, the cartons, the net price per carton. */
export interface QuotationItem {
  id: Id;
  /** The wholesale product and SKU (25); the line keeps its own copy of them. */
  productId: Id;
  skuId: Id;
  sku: string;
  name: string;
  brand: string | null;
  packSize: PackSize;
  carton: Carton;
  cartons: number;
  vatRate: VatRate;
  /** Net cents per carton; `null` until priced. */
  unitPrice: Cents | null;
  /** `cartons × unitPrice`; `null` until priced. */
  lineTotal: Cents | null;
  /** The stock of the SKU now, or `null` when the SKU no longer exists. */
  stock: QuotationItemStock | null;
}

/** What accepting did to the wholesale stock, as the list summary carries it. */
export interface QuotationStockSummary {
  deductedAt: IsoDateTime;
  /** A line went below zero. */
  short: boolean;
  /** A SKU no longer existed: nothing was taken for it. */
  missing: boolean;
}

/** One line of the deduction: the count before and after. */
export interface QuotationStockLine {
  skuId: Id;
  sku: string;
  cartons: number;
  /** `false`: the SKU was gone, nothing was taken. */
  applied: boolean;
  quantityBefore: number | null;
  quantityAfter: number | null;
}

export interface QuotationStock extends QuotationStockSummary {
  lines: QuotationStockLine[];
}

export interface QuotationDetail extends Omit<QuotationSummary, "stock"> {
  message: string | null;
  consent: { acceptedAt: IsoDateTime; ip: string; userAgent: string };
  locale: Locale;
  items: QuotationItem[];
  stock: QuotationStock | null;
}

/** `GET …/{id}` and every action answer the quotation with its emails, newest first. */
export interface QuotationWithEmails {
  quotation: QuotationDetail;
  notifications: Notification[];
}

export interface QuotationQuery extends PageQuery {
  status?: QuotationStatus;
  /** Searches the number, the company, the contact name and the email. */
  q?: string;
  /** Default `newest`. */
  sort?: QuotationSort;
}

/** `PATCH …/{id}`: the lines the admin edited; others keep what they have. */
export interface QuotationPatch {
  items: { id: Id; unitPrice?: Cents; cartons?: number }[];
}
