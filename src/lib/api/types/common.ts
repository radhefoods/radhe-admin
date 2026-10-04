// The formats of the admin API (documentation, sections 0.7 and 0.8).

/** 24-hex ObjectId. */
export type Id = string;
/** ISO 8601, UTC. */
export type IsoDateTime = string;
/** `YYYY-MM-DD` in the business time zone, Europe/Berlin. */
export type CalendarDay = string;
/** Integer cents, EUR, VAT included. Never a float. */
export type Cents = number;
/** Hundredths of a percent: 700 = 7 %. */
export type VatRate = number;

export type Locale = "en" | "de";
export const LOCALES: readonly Locale[] = ["en", "de"];

/** A translated field whose English text always exists. */
export interface Translated {
  en: string;
  de?: string | null;
}

/** A translated field of which either language may be missing. */
export interface TranslatedOptional {
  en?: string | null;
  de?: string | null;
}

export interface TranslatedList {
  en?: string[];
  de?: string[];
}

/** Products, cargos, cargo products (0.8). */
export interface PageResult<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** Newest first; `nextCursor` is `null` on the last page; no total (0.8). */
export interface CursorResult<T> {
  items: T[];
  nextCursor: Id | null;
}

export interface ListResult<T> {
  items: T[];
}

export interface PageQuery {
  page?: number;
  limit?: number;
}

export interface CursorQuery {
  limit?: number;
  cursor?: Id;
}
