// Section 24: wholesale quotations (B2B). doc/QUOTATIONS.md has the
// workflow, the objects, the emails and the rules.

import type { Carton, PackSize } from "./catalog";
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
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** A line: the product as it was at the request, the cartons, the net price per carton. */
export interface QuotationItem {
  id: Id;
  productId: Id;
  variantId: Id;
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
}

export interface QuotationDetail extends QuotationSummary {
  message: string | null;
  consent: { acceptedAt: IsoDateTime; ip: string; userAgent: string };
  locale: Locale;
  items: QuotationItem[];
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
