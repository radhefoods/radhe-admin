// The formats of the admin API (documentation, sections 0.7 and 0.8).

/** 24-hex ObjectId. */
export type Id = string;
/** ISO 8601, UTC. */
export type IsoDateTime = string;
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

/** Products (0.8). */
export interface PageResult<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * `nextCursor` is `null` on the last page; no total (0.8). The cursor is an
 * opaque string: it goes back unchanged, with the same filters and sort.
 */
export interface CursorResult<T> {
  items: T[];
  nextCursor: string | null;
}

/** `GET …/count` with the filters of a cursor list (0.8). */
export interface CountResult {
  total: number;
}

export type SortDirection = "asc" | "desc";
/** `createdAt:desc` (0.8). */
export type SortParam<F extends string> = `${F}:${SortDirection}`;

/** An admin next to the id that names them (0.9). */
export interface AdminRef {
  id: Id;
  name: string;
}

/** A customer next to the id that names them (0.9). */
export interface CustomerRef {
  id: Id;
  name: string | null;
  email: string;
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
  cursor?: string;
}
