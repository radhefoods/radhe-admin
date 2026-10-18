// Section 20: homepage banners (hero carousel). doc/BANNERS.md.

import { z } from "zod";
import type { Banner, BannerStatus } from "../../src/lib/api/types/index.ts";
import type { BannerRecord, Db } from "../db.ts";
import {
  fail,
  json,
  newId,
  noContent,
  zId,
  zTranslatedOptional,
} from "../http.ts";
import {
  BANNER_IMAGE,
  BANNER_WIDTHS,
  readImage,
  storeImage,
  uploadedFiles,
} from "../media.ts";
import type { Router } from "../router.ts";
import { iso } from "../time.ts";

export const MAX_BANNERS = 20;

/** Computed on reading: whether the shop shows the banner right now. */
export function bannerStatus(record: BannerRecord, now: number): BannerStatus {
  if (!record.isActive) return "inactive";
  if (record.startsAt && Date.parse(record.startsAt) > now) return "scheduled";
  if (record.endsAt && Date.parse(record.endsAt) <= now) return "expired";
  return "live";
}

export function bannerView(record: BannerRecord, now: number): Banner {
  return { ...record, status: bannerStatus(record, now) };
}

/** In display order. */
export function orderedBanners(db: Db): BannerRecord[] {
  return [...db.banners].sort((a, b) => a.sortOrder - b.sortOrder);
}

function bannerById(db: Db, id: string): BannerRecord {
  const found = db.banners.find((entry) => entry.id === id);
  if (!found) throw fail(404, "BANNER_NOT_FOUND", "Banner not found.");
  return found;
}

// A path of the shop with one leading slash, or an https address; no
// spaces. `http://`, `javascript:` and `//host` are refused.
const LINK = /^(\/(?!\/)[^\s]*|https:\/\/[^\s]+)$/;
const zLink = z.string().max(2000).regex(LINK, "must be a path or https URL");
const zInstant = z.iso.datetime({ offset: true });

const zPatch = z.strictObject({
  name: z.string().max(80).optional(),
  linkUrl: zLink.nullable().optional(),
  isActive: z.boolean().optional(),
  startsAt: zInstant.nullable().optional(),
  endsAt: zInstant.nullable().optional(),
  alt: zTranslatedOptional(300).optional(),
});

export function registerBanners(router: Router): void {
  const base = "/v1/admin/banners";

  router.get(base, { permission: "catalog.read" }, (ctx) =>
    json({
      items: orderedBanners(ctx.db).map((entry) => bannerView(entry, ctx.now)),
    }),
  );

  router.post(base, { permission: "catalog.manage" }, async (ctx) => {
    if (ctx.db.banners.length >= MAX_BANNERS) {
      throw fail(
        400,
        "BANNER_LIMIT_REACHED",
        `At most ${MAX_BANNERS} banners can be kept.`,
        { maximum: MAX_BANNERS },
      );
    }
    const [file] = await uploadedFiles(ctx.request, "file", 1);
    const image = storeImage(
      ctx.db,
      await readImage(file as File, BANNER_IMAGE),
      ctx.now,
      BANNER_WIDTHS,
    );
    const record: BannerRecord = {
      id: newId(ctx.now),
      name: null,
      image,
      linkUrl: null,
      isActive: false,
      sortOrder: ctx.db.banners.length,
      startsAt: null,
      endsAt: null,
      createdAt: iso(ctx.now),
      updatedAt: iso(ctx.now),
    };
    ctx.db.banners.push(record);
    return json({ banner: bannerView(record, ctx.now) }, 201);
  });

  // Before `:id`: "order" is not an id.
  router.put(`${base}/order`, { permission: "catalog.manage" }, async (ctx) => {
    const input = await ctx.body(
      z.strictObject({ orderedIds: z.array(zId).min(1).max(MAX_BANNERS) }),
    );
    const expected = orderedBanners(ctx.db).map((entry) => entry.id);
    const same =
      expected.length === input.orderedIds.length &&
      new Set(input.orderedIds).size === input.orderedIds.length &&
      input.orderedIds.every((id) => expected.includes(id));
    if (!same) {
      throw fail(
        400,
        "BANNER_ORDER_INVALID",
        "orderedIds must name every banner exactly once.",
        { expected },
      );
    }
    input.orderedIds.forEach((id, index) => {
      const record = bannerById(ctx.db, id);
      record.sortOrder = index;
    });
    return noContent();
  });

  router.get(`${base}/:id`, { permission: "catalog.read" }, (ctx) =>
    json({
      banner: bannerView(bannerById(ctx.db, ctx.params.id ?? ""), ctx.now),
    }),
  );

  router.patch(`${base}/:id`, { permission: "catalog.manage" }, async (ctx) => {
    const input = await ctx.body(zPatch);
    const record = bannerById(ctx.db, ctx.params.id ?? "");
    // Stored as the API stores an instant: in UTC.
    const utc = (value: string | null) =>
      value === null ? null : new Date(value).toISOString();
    const startsAt =
      input.startsAt === undefined ? record.startsAt : utc(input.startsAt);
    const endsAt =
      input.endsAt === undefined ? record.endsAt : utc(input.endsAt);
    if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
      throw fail(
        400,
        "BANNER_SCHEDULE_INVALID",
        "endsAt must come after startsAt.",
      );
    }
    if (input.name !== undefined) record.name = input.name.trim() || null;
    if (input.linkUrl !== undefined) record.linkUrl = input.linkUrl;
    if (input.isActive !== undefined) record.isActive = input.isActive;
    record.startsAt = startsAt;
    record.endsAt = endsAt;
    if (input.alt !== undefined) {
      record.image.alt = { ...record.image.alt, ...input.alt };
    }
    record.updatedAt = iso(ctx.now);
    return json({ banner: bannerView(record, ctx.now) });
  });

  router.put(
    `${base}/:id/image`,
    { permission: "catalog.manage" },
    async (ctx) => {
      const record = bannerById(ctx.db, ctx.params.id ?? "");
      const [file] = await uploadedFiles(ctx.request, "file", 1);
      const image = storeImage(
        ctx.db,
        await readImage(file as File, BANNER_IMAGE),
        ctx.now,
        BANNER_WIDTHS,
      );
      // The old files are deleted; the description stays.
      record.image = { ...image, alt: record.image.alt };
      record.updatedAt = iso(ctx.now);
      return json({ banner: bannerView(record, ctx.now) });
    },
  );

  router.delete(`${base}/:id`, { permission: "catalog.manage" }, (ctx) => {
    const record = bannerById(ctx.db, ctx.params.id ?? "");
    ctx.db.banners = ctx.db.banners.filter((entry) => entry !== record);
    orderedBanners(ctx.db).forEach((entry, index) => {
      entry.sortOrder = index;
    });
    return noContent();
  });
}
