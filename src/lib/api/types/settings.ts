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
  /** What still blocks invoicing. */
  missingForInvoices: CompanyMissingField[];
}

export type CompanyInput = Omit<CompanySettings, "missingForInvoices">;

export interface PaymentSettings {
  /** 0 to 23, German time. */
  reminderHour: number;
  /** 1 to 60. */
  defaultDeadlineDays: number;
  /** 30 to 1440. */
  checkoutMinutes: number;
}

export interface Settings {
  deliveryFee: { tiers: DeliveryFeeTier[] };
  orderPolicy: { customerCancellation: CustomerCancellation };
  delivery: { defaultMethod: DeliveryMethod };
  returnPolicy: { windowDays: number };
  company: CompanySettings;
  payments: PaymentSettings;
}
