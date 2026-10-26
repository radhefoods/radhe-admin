import { z } from "zod";
import { hasErrorCode } from "@/lib/api/errors";
import type {
  Translated,
  TranslatedOptional,
  WholesaleCategory,
  WholesaleCategoryInput,
  WholesaleCategoryPatch,
} from "@/lib/api/types";
import { translatedDefaults } from "@/lib/validation";

// The rules of the API for a wholesale category (25, section 3): a flat
// list, a name in two languages, an address in two languages, a
// description, a visible switch, one picture.

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max.toLocaleString("en")} characters.`);
const translated = (max: number) => z.object({ en: text(max), de: text(max) });
const slug = text(120).refine(
  (value) => value === "" || SLUG.test(value),
  "Lower-case letters, digits and single hyphens. Example: rice",
);

export const categorySchema = z.object({
  name: z.object({
    en: text(160).min(1, "The English name is required."),
    de: text(160),
  }),
  slug: z.object({ en: slug, de: slug }),
  description: translated(20000),
  isVisible: z.boolean(),
  /** The description of the picture (alt text), saved through its own endpoint. */
  alt: translated(300),
});

export type CategoryFormValues = z.input<typeof categorySchema>;

export function categoryDefaults(
  category?: WholesaleCategory,
): CategoryFormValues {
  return {
    name: translatedDefaults(category?.name),
    slug: translatedDefaults(category?.slug),
    description: translatedDefaults(category?.description),
    isVisible: category?.isVisible ?? true,
    alt: translatedDefaults(category?.image?.alt),
  };
}

type Both = { en: string; de: string };

/** Both languages named: an empty one is `null`, which clears it. */
function optional(value: Both): TranslatedOptional {
  return { en: value.en.trim() || null, de: value.de.trim() || null };
}

function isEmpty(value: TranslatedOptional): boolean {
  return !value.en && !value.de;
}

/** Only the languages that are filled: an address cannot be cleared. */
function filled(value: Both): TranslatedOptional {
  const result: TranslatedOptional = {};
  if (value.en.trim()) result.en = value.en.trim();
  if (value.de.trim()) result.de = value.de.trim();
  return result;
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** What `PATCH …/{id}/image` gets: both languages, an empty one cleared. */
export function altOf(values: CategoryFormValues): TranslatedOptional {
  return optional(values.alt);
}

/** Whether the description of the picture differs from what the category has. */
export function altChanged(
  values: CategoryFormValues,
  category: WholesaleCategory,
): boolean {
  return !same(
    altOf(values),
    optional(translatedDefaults(category.image?.alt)),
  );
}

interface Complete {
  name: Translated;
  slug: TranslatedOptional;
  description: TranslatedOptional;
  isVisible: boolean;
}

function complete(values: CategoryFormValues): Complete {
  return {
    name: { en: values.name.en.trim(), de: values.name.de.trim() || null },
    slug: filled(values.slug),
    description: optional(values.description),
    isVisible: values.isVisible,
  };
}

/** What `POST …/categories` gets: what is empty is left out. */
export function toCategoryInput(
  values: CategoryFormValues,
): WholesaleCategoryInput {
  const all = complete(values);
  const input: WholesaleCategoryInput = {
    name: all.name,
    isVisible: all.isVisible,
  };
  if (Object.keys(all.slug).length > 0) input.slug = all.slug;
  if (!isEmpty(all.description)) input.description = all.description;
  return input;
}

/** What `PATCH …/categories/{id}` gets: only what changed, translated fields whole. */
export function toCategoryPatch(
  values: CategoryFormValues,
  category: WholesaleCategory,
): WholesaleCategoryPatch {
  const next = complete(values);
  const before = complete(categoryDefaults(category));
  const patch: WholesaleCategoryPatch = {};
  if (!same(next.name, before.name)) patch.name = next.name;
  if (!same(next.slug, before.slug) && Object.keys(next.slug).length > 0) {
    patch.slug = next.slug;
  }
  if (!same(next.description, before.description))
    patch.description = next.description;
  if (next.isVisible !== before.isVisible) patch.isVisible = next.isVisible;
  return patch;
}

/** The field a documented refusal of the API belongs to. */
export function categoryErrorField(error: unknown): "slug.en" | null {
  return hasErrorCode(error, "WHOLESALE_CATEGORY_SLUG_TAKEN")
    ? "slug.en"
    : null;
}
