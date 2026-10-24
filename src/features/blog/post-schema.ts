import { z } from "zod";
import {
  BLOG_RULES,
  type BlogCategory,
  type BlogCategoryInput,
  type BlogCategoryPatch,
  type BlogPost,
  type BlogPostInput,
  type BlogPostPatch,
  type TranslatedOptional,
} from "@/lib/api/types";
import {
  translatedDefaults,
  zTranslated,
  zTranslatedOptional,
} from "@/lib/validation";

// The rules of the API for posts and categories (23). The form holds every
// field as text in both languages; the schema makes of them what the API
// wants, and a patch carries only what changed.

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A part of the URL: lower-case letters, digits and hyphens, or nothing (generated). */
const zSlugs = z
  .object({
    en: z.string().trim().max(BLOG_RULES.slugMaxLength),
    de: z.string().trim().max(BLOG_RULES.slugMaxLength),
  })
  .superRefine((value, context) => {
    for (const locale of ["en", "de"] as const) {
      if (value[locale] !== "" && !SLUG.test(value[locale])) {
        context.addIssue({
          code: "custom",
          path: [locale],
          message:
            "Lower-case letters, digits and hyphens only: the-perfect-dal",
        });
      }
    }
  });

const zTags = z
  .array(z.string().trim().toLowerCase().min(1).max(BLOG_RULES.tagMaxLength))
  .max(BLOG_RULES.maxTags, `At most ${BLOG_RULES.maxTags} tags.`);

export const postSchema = z.object({
  title: zTranslated(
    BLOG_RULES.titleMaxLength,
    "The English title is required.",
  ),
  slug: zSlugs,
  summary: zTranslatedOptional(BLOG_RULES.summaryMaxLength),
  content: z.object({
    en: z.string().max(BLOG_RULES.contentMaxLength),
    de: z.string().max(BLOG_RULES.contentMaxLength),
  }),
  authorName: z.string().trim().max(BLOG_RULES.authorMaxLength),
  /** The id of the category, or `""` for none. */
  categoryId: z.string(),
  tags: zTags,
  seoTitle: zTranslatedOptional(BLOG_RULES.seoTitleMaxLength),
  seoDescription: zTranslatedOptional(BLOG_RULES.seoDescriptionMaxLength),
});
export type PostFormValues = z.input<typeof postSchema>;
export type PostFormOutput = z.output<typeof postSchema>;

export function postDefaults(post?: BlogPost, authorName = ""): PostFormValues {
  return {
    title: translatedDefaults(post?.title),
    slug: translatedDefaults(post?.slug),
    summary: translatedDefaults(post?.summary),
    content: translatedDefaults(post?.content),
    authorName: post?.authorName ?? authorName,
    categoryId: post?.categoryId ?? "",
    tags: post?.tags ?? [],
    seoTitle: translatedDefaults(post?.seo?.title),
    seoDescription: translatedDefaults(post?.seo?.description),
  };
}

const hasText = (value: TranslatedOptional) =>
  Boolean(value.en?.trim() || value.de?.trim());

/** What the form holds as Markdown, as the API takes it: an empty text is `null`. */
function contentOf(value: { en: string; de: string }): TranslatedOptional {
  return {
    en: value.en.trim() === "" ? null : value.en,
    de: value.de.trim() === "" ? null : value.de,
  };
}

/** A slug typed for a language; nothing when it was left to the API. */
function slugsOf(value: {
  en: string;
  de: string;
}): TranslatedOptional | undefined {
  const slug: TranslatedOptional = {};
  if (value.en) slug.en = value.en;
  if (value.de) slug.de = value.de;
  return Object.keys(slug).length > 0 ? slug : undefined;
}

/** The creation body: the title, and everything else only when it was filled. */
export function toPostInput(values: PostFormOutput): BlogPostInput {
  const input: BlogPostInput = { title: values.title };
  const slug = slugsOf(values.slug);
  if (slug) input.slug = slug;
  if (hasText(values.summary)) input.summary = values.summary;
  const content = contentOf(values.content);
  if (hasText(content)) input.content = content;
  if (values.authorName) input.authorName = values.authorName;
  if (values.categoryId) input.categoryId = values.categoryId;
  if (values.tags.length > 0) input.tags = values.tags;
  const seo: NonNullable<BlogPostInput["seo"]> = {};
  if (hasText(values.seoTitle)) seo.title = values.seoTitle;
  if (hasText(values.seoDescription)) seo.description = values.seoDescription;
  if (Object.keys(seo).length > 0) input.seo = seo;
  return input;
}

const same = (
  a: TranslatedOptional | null | undefined,
  b: TranslatedOptional | null | undefined,
) => (a?.en ?? null) === (b?.en ?? null) && (a?.de ?? null) === (b?.de ?? null);

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((entry, index) => entry === b[index]);

/** Only what changed; the slug only where it was retyped. */
export function toPostPatch(
  values: PostFormOutput,
  post: BlogPost,
): BlogPostPatch {
  const patch: BlogPostPatch = {};
  if (!same(values.title, post.title)) patch.title = values.title;
  const slug: TranslatedOptional = {};
  for (const locale of ["en", "de"] as const) {
    const typed = values.slug[locale];
    if (typed && typed !== post.slug[locale]) slug[locale] = typed;
  }
  if (Object.keys(slug).length > 0) patch.slug = slug;
  if (!same(values.summary, post.summary)) patch.summary = values.summary;
  const content = contentOf(values.content);
  if (!same(content, post.content)) patch.content = content;
  if (values.authorName && values.authorName !== post.authorName) {
    patch.authorName = values.authorName;
  }
  if ((values.categoryId || null) !== post.categoryId) {
    patch.categoryId = values.categoryId || null;
  }
  if (!sameList(values.tags, post.tags)) patch.tags = values.tags;
  const seo: NonNullable<BlogPostPatch["seo"]> = {};
  if (!same(values.seoTitle, post.seo?.title)) seo.title = values.seoTitle;
  if (!same(values.seoDescription, post.seo?.description)) {
    seo.description = values.seoDescription;
  }
  if (Object.keys(seo).length > 0) patch.seo = seo;
  return patch;
}

/** `Gluten Free` becomes `gluten free`: tags are lower-case words. */
export const normalizeTag = (text: string) =>
  text.trim().toLowerCase().replace(/\s+/g, " ");

// --- Categories -------------------------------------------------------------

export const categorySchema = z.object({
  name: zTranslated(120, "The English name is required."),
  slug: zSlugs,
  description: zTranslatedOptional(BLOG_RULES.descriptionMaxLength),
  seoTitle: zTranslatedOptional(BLOG_RULES.seoTitleMaxLength),
  seoDescription: zTranslatedOptional(BLOG_RULES.seoDescriptionMaxLength),
});
export type CategoryFormValues = z.input<typeof categorySchema>;
export type CategoryFormOutput = z.output<typeof categorySchema>;

export function categoryDefaults(category?: BlogCategory): CategoryFormValues {
  return {
    name: translatedDefaults(category?.name),
    slug: translatedDefaults(category?.slug),
    description: translatedDefaults(category?.description),
    seoTitle: translatedDefaults(category?.seo?.title),
    seoDescription: translatedDefaults(category?.seo?.description),
  };
}

export function toCategoryInput(values: CategoryFormOutput): BlogCategoryInput {
  const input: BlogCategoryInput = { name: values.name };
  const slug = slugsOf(values.slug);
  if (slug) input.slug = slug;
  if (hasText(values.description)) input.description = values.description;
  const seo: NonNullable<BlogCategoryInput["seo"]> = {};
  if (hasText(values.seoTitle)) seo.title = values.seoTitle;
  if (hasText(values.seoDescription)) seo.description = values.seoDescription;
  if (Object.keys(seo).length > 0) input.seo = seo;
  return input;
}

export function toCategoryPatch(
  values: CategoryFormOutput,
  category: BlogCategory,
): BlogCategoryPatch {
  const patch: BlogCategoryPatch = {};
  if (!same(values.name, category.name)) patch.name = values.name;
  const slug: TranslatedOptional = {};
  for (const locale of ["en", "de"] as const) {
    const typed = values.slug[locale];
    if (typed && typed !== category.slug[locale]) slug[locale] = typed;
  }
  if (Object.keys(slug).length > 0) patch.slug = slug;
  if (!same(values.description, category.description)) {
    patch.description = values.description;
  }
  const seo: NonNullable<BlogCategoryPatch["seo"]> = {};
  if (!same(values.seoTitle, category.seo?.title)) seo.title = values.seoTitle;
  if (!same(values.seoDescription, category.seo?.description)) {
    seo.description = values.seoDescription;
  }
  if (Object.keys(seo).length > 0) patch.seo = seo;
  return patch;
}
