import { z } from "zod";
import { hasErrorCode } from "@/lib/api/errors";
import type {
  Category,
  CategoryInput,
  Translated,
  TranslatedOptional,
} from "@/lib/api/types";
import { translatedDefaults } from "@/lib/validation";

// The rules of the API for a category (documentation, 7).

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max.toLocaleString("en")} characters.`);
const translated = (max: number) => z.object({ en: text(max), de: text(max) });
const slug = text(120).refine(
  (value) => value === "" || SLUG.test(value),
  "Lower-case letters, digits and single hyphens. Example: basmati-rice",
);

export const categorySchema = z.object({
  name: z.object({
    en: text(160).min(1, "The English name is required."),
    de: text(160),
  }),
  slug: z.object({ en: slug, de: slug }),
  tagline: translated(300),
  description: translated(20000),
  /** Empty: a main category. */
  parentId: z.string().regex(/^([0-9a-f]{24})?$/, "Choose a category."),
  isVisible: z.boolean(),
  seo: z.object({ title: translated(300), description: translated(300) }),
});

export type CategoryFormValues = z.input<typeof categorySchema>;

export function categoryDefaults(
  category?: Category,
  parentId: string | null = null,
): CategoryFormValues {
  return {
    name: translatedDefaults(category?.name),
    slug: translatedDefaults(category?.slug),
    tagline: translatedDefaults(category?.tagline),
    description: translatedDefaults(category?.description),
    parentId: category ? (category.parentId ?? "") : (parentId ?? ""),
    isVisible: category?.isVisible ?? true,
    seo: {
      title: translatedDefaults(category?.seo?.title),
      description: translatedDefaults(category?.seo?.description),
    },
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

interface Complete {
  name: Translated;
  slug: TranslatedOptional;
  tagline: TranslatedOptional;
  description: TranslatedOptional;
  parentId: string | null;
  isVisible: boolean;
  seo: { title: TranslatedOptional; description: TranslatedOptional };
}

function complete(values: CategoryFormValues): Complete {
  return {
    name: { en: values.name.en.trim(), de: values.name.de.trim() || null },
    slug: filled(values.slug),
    tagline: optional(values.tagline),
    description: optional(values.description),
    parentId: values.parentId || null,
    isVisible: values.isVisible,
    seo: {
      title: optional(values.seo.title),
      description: optional(values.seo.description),
    },
  };
}

/** What `POST /categories` gets: what is empty is left out. */
export function toCategoryInput(values: CategoryFormValues): CategoryInput {
  const all = complete(values);
  const input: CategoryInput = { name: all.name, isVisible: all.isVisible };
  if (Object.keys(all.slug).length > 0) input.slug = all.slug;
  if (!isEmpty(all.tagline)) input.tagline = all.tagline;
  if (!isEmpty(all.description)) input.description = all.description;
  if (all.parentId) input.parentId = all.parentId;
  const seo: NonNullable<CategoryInput["seo"]> = {};
  if (!isEmpty(all.seo.title)) seo.title = all.seo.title;
  if (!isEmpty(all.seo.description)) seo.description = all.seo.description;
  if (Object.keys(seo).length > 0) input.seo = seo;
  return input;
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * What `PATCH /categories/{id}` gets: only what changed. Translated objects
 * are replaced as a whole, so both languages go along; `parentId` moves the
 * category with everything below it.
 */
export function toCategoryPatch(
  values: CategoryFormValues,
  category: Category,
): Partial<CategoryInput> {
  const next = complete(values);
  const before = complete(categoryDefaults(category));
  const patch: Partial<CategoryInput> = {};
  if (!same(next.name, before.name)) patch.name = next.name;
  if (!same(next.slug, before.slug) && Object.keys(next.slug).length > 0) {
    patch.slug = next.slug;
  }
  if (!same(next.tagline, before.tagline)) patch.tagline = next.tagline;
  if (!same(next.description, before.description))
    patch.description = next.description;
  if (next.parentId !== before.parentId) patch.parentId = next.parentId;
  if (next.isVisible !== before.isVisible) patch.isVisible = next.isVisible;
  if (!same(next.seo, before.seo)) patch.seo = next.seo;
  return patch;
}

/** The field a documented refusal of the API belongs to. */
export function categoryErrorField(
  error: unknown,
): "parentId" | "slug.en" | null {
  if (hasErrorCode(error, "CATEGORY_PARENT_INVALID", "CATEGORY_TOO_DEEP")) {
    return "parentId";
  }
  if (hasErrorCode(error, "CATEGORY_SLUG_TAKEN")) return "slug.en";
  return null;
}
