import { z } from "zod";
import { hasErrorCode } from "@/lib/api/errors";
import { BANNER_RULES, type Banner, type BannerPatch } from "@/lib/api/types";
import { berlinToIso, toLocalInput } from "@/lib/format/dates";
import { translatedDefaults } from "@/lib/validation";

// The rules of the API for a banner (doc/BANNERS.md, 3): a label, a link
// that is a path of the shop or an https address, the switch, a period
// whose end comes after its start, and the description of the picture.

/** A path with one leading slash, or an https address; no spaces. */
const LINK = /^(\/(?!\/)\S*|https:\/\/\S+)$/;

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max.toLocaleString("en")} characters.`);

/** A German date and time as typed, or nothing. */
const moment = z
  .string()
  .refine(
    (value) => value === "" || berlinToIso(value) !== null,
    "Enter a date and a time, or leave it empty.",
  );

export const bannerSchema = z
  .object({
    name: text(BANNER_RULES.nameMaxLength),
    linkUrl: text(BANNER_RULES.linkMaxLength).refine(
      (value) => value === "" || LINK.test(value),
      "A path of the shop starting with one slash (for example /products/basmati-rice-1kg), or an https:// address. No spaces.",
    ),
    isActive: z.boolean(),
    startsAt: moment,
    endsAt: moment,
    alt: z.object({
      en: text(BANNER_RULES.altMaxLength),
      de: text(BANNER_RULES.altMaxLength),
    }),
  })
  .superRefine((values, context) => {
    const start = values.startsAt && berlinToIso(values.startsAt);
    const end = values.endsAt && berlinToIso(values.endsAt);
    if (start && end && Date.parse(end) <= Date.parse(start)) {
      context.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: "The end must come after the start.",
      });
    }
  });

export type BannerFormValues = z.input<typeof bannerSchema>;

export function bannerDefaults(banner: Banner): BannerFormValues {
  return {
    name: banner.name ?? "",
    linkUrl: banner.linkUrl ?? "",
    isActive: banner.isActive,
    startsAt: toLocalInput(banner.startsAt),
    endsAt: toLocalInput(banner.endsAt),
    alt: translatedDefaults(banner.image.alt),
  };
}

/** A typed moment as the API wants it; nothing typed clears it. */
function instantOf(value: string): string | null {
  return value ? berlinToIso(value) : null;
}

/**
 * What `PATCH /banners/{id}` gets: only what changed. An emptied name is
 * sent as `""`, an emptied link or date as `null`; both languages of the
 * description go along, an empty one as `null`.
 */
export function toBannerPatch(
  values: BannerFormValues,
  banner: Banner,
): BannerPatch {
  const before = bannerDefaults(banner);
  const patch: BannerPatch = {};
  const name = values.name.trim();
  if (name !== before.name) patch.name = name;
  const linkUrl = values.linkUrl.trim();
  if (linkUrl !== before.linkUrl) patch.linkUrl = linkUrl || null;
  if (values.isActive !== before.isActive) patch.isActive = values.isActive;
  if (values.startsAt !== before.startsAt) {
    patch.startsAt = instantOf(values.startsAt);
  }
  if (values.endsAt !== before.endsAt) patch.endsAt = instantOf(values.endsAt);
  const alt = { en: values.alt.en.trim(), de: values.alt.de.trim() };
  if (alt.en !== before.alt.en || alt.de !== before.alt.de) {
    patch.alt = { en: alt.en || null, de: alt.de || null };
  }
  return patch;
}

/** The field a documented refusal of the API belongs to. */
export function bannerErrorField(error: unknown): "endsAt" | null {
  return hasErrorCode(error, "BANNER_SCHEDULE_INVALID") ? "endsAt" : null;
}

/** "Until 5 Nov 2026, 00:00", "From 18 Nov 2026, 00:00 until …", "Always". */
export function periodText(
  banner: Pick<Banner, "startsAt" | "endsAt">,
  format: (value: string) => string,
): string {
  const { startsAt, endsAt } = banner;
  if (startsAt && endsAt) {
    return `From ${format(startsAt)} until ${format(endsAt)}`;
  }
  if (startsAt) return `From ${format(startsAt)}`;
  if (endsAt) return `Until ${format(endsAt)}`;
  return "Always";
}
