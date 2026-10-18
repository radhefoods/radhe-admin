import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import type { Banner } from "@/lib/api/types";
import {
  bannerDefaults,
  bannerErrorField,
  bannerSchema,
  periodText,
  toBannerPatch,
} from "./banner-schema";

const banner: Banner = {
  id: "66f3000000000000000000a1",
  name: "Diwali offer",
  image: {
    id: "66f3000000000000000000a2",
    alt: { en: "Diwali offer", de: null },
    isPrimary: false,
    url: "https://cdn.example/large.webp",
    sizes: {
      small: { url: "https://cdn.example/small.webp", width: 768, height: 320 },
      medium: {
        url: "https://cdn.example/medium.webp",
        width: 1536,
        height: 640,
      },
      large: {
        url: "https://cdn.example/large.webp",
        width: 2400,
        height: 1000,
      },
    },
    bytes: 412000,
    uploadedAt: "2026-10-19T09:00:00.000Z",
  },
  linkUrl: "/products/basmati-rice-1kg",
  isActive: true,
  status: "live",
  sortOrder: 0,
  startsAt: null,
  endsAt: "2026-11-05T23:00:00.000Z",
  createdAt: "2026-10-19T09:00:00.000Z",
  updatedAt: "2026-10-19T09:05:00.000Z",
};

describe("the banner form", () => {
  it("reads the period as German time", () => {
    expect(bannerDefaults(banner)).toEqual({
      name: "Diwali offer",
      linkUrl: "/products/basmati-rice-1kg",
      isActive: true,
      startsAt: "",
      endsAt: "2026-11-06T00:00",
      alt: { en: "Diwali offer", de: "" },
    });
  });

  it("sends only what changed, with the instants in ISO and nothing as null", () => {
    const values = bannerDefaults(banner);
    expect(toBannerPatch(values, banner)).toEqual({});
    expect(
      toBannerPatch(
        {
          ...values,
          name: "  ",
          linkUrl: "",
          isActive: false,
          startsAt: "2026-10-20T00:00",
          endsAt: "",
          alt: { en: "Diwali offer", de: "Diwali-Angebot" },
        },
        banner,
      ),
    ).toEqual({
      name: "",
      linkUrl: null,
      isActive: false,
      startsAt: "2026-10-20T00:00:00+02:00",
      endsAt: null,
      alt: { en: "Diwali offer", de: "Diwali-Angebot" },
    });
  });

  it("accepts a path of the shop or an https address, nothing else", () => {
    const values = bannerDefaults(banner);
    const link = (linkUrl: string) =>
      bannerSchema.safeParse({ ...values, linkUrl }).success;
    expect(link("")).toBe(true);
    expect(link("/categories/rice")).toBe(true);
    expect(link("https://www.radhefoods.de/offer?x=1")).toBe(true);
    expect(link("//evil.example/x")).toBe(false);
    expect(link("http://example.com")).toBe(false);
    expect(link("javascript:alert(1)")).toBe(false);
    expect(link("/products/with space")).toBe(false);
  });

  it("refuses an end that is not after the start, at the end field", () => {
    const result = bannerSchema.safeParse({
      ...bannerDefaults(banner),
      startsAt: "2026-11-10T10:00",
      endsAt: "2026-11-10T10:00",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([
      ["endsAt"],
    ]);
  });

  it("knows the field of the API's period refusal", () => {
    expect(
      bannerErrorField(
        new ApiError({
          status: 400,
          code: "BANNER_SCHEDULE_INVALID",
          message: "endsAt must come after startsAt.",
        }),
      ),
    ).toBe("endsAt");
    expect(
      bannerErrorField(
        new ApiError({ status: 404, code: "BANNER_NOT_FOUND", message: "" }),
      ),
    ).toBeNull();
  });

  it("describes the period", () => {
    const format = (value: string) => value.slice(0, 10);
    expect(periodText({ startsAt: null, endsAt: null }, format)).toBe("Always");
    expect(
      periodText({ startsAt: "2026-11-01T00:00:00Z", endsAt: null }, format),
    ).toBe("From 2026-11-01");
    expect(
      periodText({ startsAt: null, endsAt: "2026-11-05T23:00:00Z" }, format),
    ).toBe("Until 2026-11-05");
    expect(
      periodText(
        { startsAt: "2026-11-01T00:00:00Z", endsAt: "2026-11-05T23:00:00Z" },
        format,
      ),
    ).toBe("From 2026-11-01 until 2026-11-05");
  });
});
