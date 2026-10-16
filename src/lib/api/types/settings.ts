// Section 5: settings.

import type { Cents } from "./common";
import type { DeliveryMethod } from "./orders";

export interface DeliveryFeeTier {
  minOrderValue: Cents;
  fee: Cents;
}

export type CustomerCancellation =
  "while_confirmed" | "until_dispatched" | "never";

export type CompanyMissingField =
  "name" | "addressLines" | "email" | "vatId or taxNumber";

/** Optional keys are absent when unset. */
export interface CompanySettings {
  name: string;
  addressLines: string[];
  email: string;
  phone?: string;
  website?: string;
  vatId?: string;
  taxNumber?: string;
  registration?: string;
  logoUrl?: string;
  invoiceFooter?: string;
  /** What still blocks invoicing, and with it every sale. */
  missingForInvoices: CompanyMissingField[];
}

export type CompanyInput = Omit<CompanySettings, "missingForInvoices">;

/** The method every new order gets, and the estimate shown at checkout and in the emails. */
export interface DeliverySettings {
  defaultMethod: DeliveryMethod;
  /** Both languages required, 1 to 120 characters. */
  estimate: { en: string; de: string };
}

export interface PaymentSettings {
  /** How long a Stripe payment page stays open: 30 to 1440 minutes. */
  checkoutMinutes: number;
  /** Whether the server has Stripe keys (repeated from `integrations`). */
  stripeConnected?: boolean;
}

export interface PaymentsInput {
  checkoutMinutes: number;
}

export interface Settings {
  deliveryFee: { tiers: DeliveryFeeTier[] };
  orderPolicy: { customerCancellation: CustomerCancellation };
  delivery: DeliverySettings;
  returnPolicy: { windowDays: number };
  company: CompanySettings;
  payments: PaymentSettings;
  /** Whether the server has Stripe keys and WhatsApp credentials (5). */
  integrations?: { stripeConnected: boolean; whatsappConfigured: boolean };
}
