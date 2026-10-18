// Section 20: homepage banners (hero carousel). doc/BANNERS.md has the
// full description.

import type { AdminImage } from "./catalog";
import type { Id, IsoDateTime, TranslatedOptional } from "./common";

/**
 * Computed by the API: `live` is shown in the shop; `scheduled` starts in
 * the future, `expired` ended in the past, `inactive` is switched off.
 */
export type BannerStatus = "live" | "inactive" | "scheduled" | "expired";

export interface Banner {
  id: Id;
  /** A label for the admin's list only. */
  name: string | null;
  /** One finished picture, with every text on it already; WebP in three widths. */
  image: AdminImage;
  /** A path of the shop (`/products/…`) or an `https://` address. */
  linkUrl: string | null;
  isActive: boolean;
  status: BannerStatus;
  /** The place in the carousel, 0 first. */
  sortOrder: number;
  startsAt: IsoDateTime | null;
  endsAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** `PATCH /banners/{id}`: any of these; the others stay. */
export interface BannerPatch {
  /** At most 80 characters; `""` removes it. */
  name?: string;
  /** `null` removes it. */
  linkUrl?: string | null;
  isActive?: boolean;
  /** ISO 8601 instants; `null` removes one; the end must come after the start. */
  startsAt?: IsoDateTime | null;
  endsAt?: IsoDateTime | null;
  /** Each at most 300 characters. */
  alt?: TranslatedOptional;
}

/** `PUT /banners/order`: every banner exactly once, in the new order. */
export interface BannerOrderInput {
  orderedIds: Id[];
}

/** The rules of the banner picture and the limits of the API (20). */
export const BANNER_RULES = {
  /** At most this many banners can be kept. */
  maxBanners: 20,
  /** The picture must be wider than tall and at least this large. */
  minWidthPx: 1200,
  minHeightPx: 300,
  recommended: { width: 2400, height: 1000 },
  nameMaxLength: 80,
  linkMaxLength: 2000,
  altMaxLength: 300,
} as const;
