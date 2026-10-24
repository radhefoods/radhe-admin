// Section 23: the blog. doc/BLOG.md has the model, the rules and the panel
// workflow.

import type { AdminImage } from "./catalog";
import type {
  Id,
  IsoDateTime,
  PageQuery,
  Translated,
  TranslatedOptional,
} from "./common";

export type BlogPostStatus = "draft" | "published";
/** Computed: `scheduled` is a published post whose date is in the future. */
export type BlogVisibility = "draft" | "scheduled" | "published";
export const BLOG_VISIBILITIES: readonly BlogVisibility[] = [
  "draft",
  "scheduled",
  "published",
];

export const BLOG_POST_SORTS = [
  "updated",
  "newest",
  "published",
  "title",
] as const;
export type BlogPostSort = (typeof BLOG_POST_SORTS)[number];

export interface BlogSeo {
  title: TranslatedOptional | null;
  description: TranslatedOptional | null;
}

/** The list entry: everything up to `updatedAt`, without the text. */
export interface BlogPostSummary {
  id: Id;
  title: Translated;
  /** Part of the URL in each language; generated from the title when not given. */
  slug: Translated;
  summary: TranslatedOptional | null;
  status: BlogPostStatus;
  visibility: BlogVisibility;
  /** The date of the article; a published post is shown from this moment on. */
  publishedAt: IsoDateTime | null;
  authorName: string;
  authorId: Id | null;
  categoryId: Id | null;
  category: { id: Id; name: Translated } | null;
  /** Lower-case words, the same in both languages, at most 20. */
  tags: string[];
  /** WebP in widths 480, 1024 and 1920; at least 800 × 400 px. */
  featuredImage: AdminImage | null;
  imageCount: number;
  /** About 200 words a minute. */
  readingMinutes: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** The detail: the text in Markdown, the SEO fields and the pictures for the text. */
export interface BlogPost extends BlogPostSummary {
  content: TranslatedOptional;
  seo: BlogSeo | null;
  /** Up to 20, WebP in widths 320, 800 and 1600; their addresses go into the Markdown. */
  images: AdminImage[];
}

export interface BlogPostQuery extends PageQuery {
  status?: BlogPostStatus;
  categoryId?: Id;
  tag?: string;
  /** Words of the title, the summary or the tags. */
  q?: string;
  /** Default `updated`. */
  sort?: BlogPostSort;
}

/** Everything but `title` is optional. `tags` are trimmed, lower-cased and de-duplicated. */
export interface BlogPostInput {
  title: Translated;
  slug?: TranslatedOptional;
  summary?: TranslatedOptional;
  content?: TranslatedOptional;
  authorName?: string;
  /** `null`: no category. */
  categoryId?: Id | null;
  tags?: string[];
  /** `published` at creation needs `content.en`. */
  status?: BlogPostStatus;
  publishedAt?: IsoDateTime | null;
  seo?: { title?: TranslatedOptional; description?: TranslatedOptional };
}

/** Any field of the creation. */
export type BlogPostPatch = Partial<BlogPostInput>;

/** `POST …/publish`: the date sent, else the one the post has, else now. A future date schedules. */
export interface BlogPublishInput {
  publishedAt?: IsoDateTime;
}

export interface BlogImageAltInput {
  alt: TranslatedOptional;
}

export interface BlogTag {
  tag: string;
  count: number;
}

export interface BlogCategory {
  id: Id;
  name: Translated;
  slug: Translated;
  description: TranslatedOptional | null;
  seo: BlogSeo | null;
  sortOrder: number;
  /** With the list only. */
  postCount?: number;
  publishedCount?: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface BlogCategoryList {
  items: BlogCategory[];
  /** The posts without a category. */
  uncategorized: { total: number; published: number };
}

export interface BlogCategoryInput {
  name: Translated;
  slug?: TranslatedOptional;
  description?: TranslatedOptional;
  seo?: { title?: TranslatedOptional; description?: TranslatedOptional };
}

/** Any field; the slug changes only when sent. */
export type BlogCategoryPatch = Partial<BlogCategoryInput>;

export interface BlogCategoryOrderInput {
  orderedIds: Id[];
}

export const BLOG_RULES = {
  titleMaxLength: 200,
  slugMaxLength: 200,
  summaryMaxLength: 500,
  contentMaxLength: 300_000,
  authorMaxLength: 120,
  seoTitleMaxLength: 200,
  seoDescriptionMaxLength: 500,
  descriptionMaxLength: 2000,
  tagMaxLength: 40,
  maxTags: 20,
  /** The featured picture: at least this wide and this high. */
  featured: { minWidthPx: 800, minHeightPx: 400 },
  /** Pictures for the text: per request, and per post. */
  maxImagesPerRequest: 10,
  maxImagesPerPost: 20,
  pageLimit: 25,
} as const;
