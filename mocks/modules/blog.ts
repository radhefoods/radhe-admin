// Section 23: the blog, posts and categories. doc/BLOG.md.

import { z } from "zod";
import type {
  AdminImage,
  BlogCategory,
  BlogPost,
  BlogPostSummary,
  BlogVisibility,
} from "../../src/lib/api/types/index.ts";
import type { AdminRecord, Db } from "../db.ts";
import {
  enumParam,
  fail,
  idParam,
  json,
  newId,
  noContent,
  page,
  searchParam,
  wordsMatch,
  zId,
  zTranslated,
  zTranslatedOptional,
} from "../http.ts";
import {
  BLOG_FEATURED_IMAGE,
  BLOG_FEATURED_WIDTHS,
  readImage,
  storeImage,
  uploadedFiles,
} from "../media.ts";
import type { Router } from "../router.ts";
import { DAY, HOUR, iso } from "../time.ts";

/** A category as stored: the counts are worked out on reading. */
export type BlogCategoryRecord = Omit<
  BlogCategory,
  "postCount" | "publishedCount"
>;
/** A post as stored: visibility, category, counts and reading time are worked out on reading. */
export type BlogPostRecord = Omit<
  BlogPost,
  "visibility" | "category" | "imageCount" | "readingMinutes"
>;

const MAX_IMAGES = 20;
const MAX_TAGS = 20;
const PAGE_LIMIT = 25;

// --- Helpers ----------------------------------------------------------------

export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200);
}

function visibilityOf(post: BlogPostRecord, now: number): BlogVisibility {
  if (post.status === "draft") return "draft";
  if (post.publishedAt && Date.parse(post.publishedAt) > now)
    return "scheduled";
  return "published";
}

function readingMinutes(post: BlogPostRecord): number {
  const text = post.content.en ?? post.content.de ?? "";
  const words = text.split(/\s+/).filter(Boolean).length;
  return words === 0 ? 0 : Math.max(1, Math.ceil(words / 200));
}

function categoryView(
  db: Db,
  category: BlogCategoryRecord,
  withCounts: boolean,
): BlogCategory {
  if (!withCounts) return category;
  const posts = db.blogPosts.filter((post) => post.categoryId === category.id);
  return {
    ...category,
    postCount: posts.length,
    publishedCount: posts.filter((post) => post.status === "published").length,
  };
}

export function orderedCategories(db: Db): BlogCategoryRecord[] {
  return [...db.blogCategories].sort((a, b) => a.sortOrder - b.sortOrder);
}

function postSummary(
  db: Db,
  post: BlogPostRecord,
  now: number,
): BlogPostSummary {
  const category = post.categoryId
    ? db.blogCategories.find((entry) => entry.id === post.categoryId)
    : undefined;
  const { content: _content, seo: _seo, images, ...rest } = post;
  return {
    ...rest,
    visibility: visibilityOf(post, now),
    category: category ? { id: category.id, name: category.name } : null,
    imageCount: images.length,
    readingMinutes: readingMinutes(post),
  };
}

function postDetail(db: Db, post: BlogPostRecord, now: number): BlogPost {
  return {
    ...postSummary(db, post, now),
    content: post.content,
    seo: post.seo,
    images: post.images,
  };
}

function postById(db: Db, id: string): BlogPostRecord {
  const found = db.blogPosts.find((entry) => entry.id === id);
  if (!found) throw fail(404, "BLOG_POST_NOT_FOUND", "Blog post not found.");
  return found;
}

function categoryById(db: Db, id: string): BlogCategoryRecord {
  const found = db.blogCategories.find((entry) => entry.id === id);
  if (!found) {
    throw fail(404, "BLOG_CATEGORY_NOT_FOUND", "Blog category not found.");
  }
  return found;
}

type Slugged = { id: string; slug: { en: string; de?: string | null } };

/** A slug nobody else has in that language: the wanted one, or with a number. */
function uniqueSlug(
  rows: Slugged[],
  wanted: string,
  locale: "en" | "de",
  except: string | null,
): string {
  const taken = (candidate: string) =>
    rows.some((row) => row.id !== except && row.slug[locale] === candidate);
  if (!taken(wanted)) return wanted;
  for (let n = 2; ; n += 1) {
    const candidate = `${wanted}-${n}`;
    if (!taken(candidate)) return candidate;
  }
}

function checkSlugFree(
  rows: Slugged[],
  slug: string,
  locale: "en" | "de",
  except: string | null,
  code: string,
): void {
  if (rows.some((row) => row.id !== except && row.slug[locale] === slug)) {
    throw fail(409, code, `The ${locale} slug is already used.`, {
      locale,
      slug,
    });
  }
}

function cleanTags(tags: string[]): string[] {
  return [
    ...new Set(
      tags.map((tag) => tag.trim().toLowerCase()).filter((tag) => tag !== ""),
    ),
  ];
}

const zSeo = z
  .strictObject({
    title: zTranslatedOptional(200).optional(),
    description: zTranslatedOptional(500).optional(),
  })
  .optional();

const zPostFields = {
  title: zTranslated(200),
  slug: zTranslatedOptional(200).optional(),
  summary: zTranslatedOptional(500).optional(),
  content: zTranslatedOptional(300_000).optional(),
  authorName: z.string().min(1).max(120).optional(),
  categoryId: zId.nullable().optional(),
  tags: z.array(z.string().max(40)).max(MAX_TAGS).optional(),
  status: z.enum(["draft", "published"]).optional(),
  publishedAt: z.iso.datetime({ offset: true }).nullable().optional(),
  seo: zSeo,
};
const zPostInput = z.strictObject(zPostFields);
const zPostPatch = z.strictObject({
  ...zPostFields,
  title: zPostFields.title.optional(),
});

const zCategoryFields = {
  name: zTranslated(120),
  slug: zTranslatedOptional(200).optional(),
  description: zTranslatedOptional(2000).optional(),
  seo: zSeo,
};
const zCategoryInput = z.strictObject(zCategoryFields);
const zCategoryPatch = z.strictObject({
  ...zCategoryFields,
  name: zCategoryFields.name.optional(),
});

const optionalText = (
  value: { en?: string | null; de?: string | null } | undefined,
) =>
  value === undefined
    ? undefined
    : { en: value.en ?? null, de: value.de ?? null };

function seoOf(
  input: z.output<typeof zSeo>,
  current: BlogPostRecord["seo"],
): BlogPostRecord["seo"] {
  if (input === undefined) return current;
  return {
    title: optionalText(input.title) ?? current?.title ?? null,
    description:
      optionalText(input.description) ?? current?.description ?? null,
  };
}

function incomplete(post: BlogPostRecord): never | void {
  if (!post.content.en?.trim()) {
    throw fail(
      400,
      "BLOG_POST_INCOMPLETE",
      "The post needs its English text before it is published.",
      { missing: ["content.en"] },
    );
  }
}

// --- Routes -----------------------------------------------------------------

export function registerBlog(router: Router): void {
  const posts = "/v1/admin/blog-posts";
  const categories = "/v1/admin/blog-categories";
  const read = { permission: "content.read" };
  const manage = { permission: "content.manage" };

  router.get(posts, read, (ctx) => {
    const status = enumParam(ctx.query, "status", [
      "draft",
      "published",
    ] as const);
    const categoryId = idParam(ctx.query, "categoryId");
    const tag = ctx.query.get("tag")?.trim().toLowerCase() || undefined;
    const q = searchParam(ctx.query);
    const sort =
      enumParam(ctx.query, "sort", [
        "updated",
        "newest",
        "published",
        "title",
      ] as const) ?? "updated";
    let rows = ctx.db.blogPosts.filter(
      (post) =>
        (!status || post.status === status) &&
        (!categoryId || post.categoryId === categoryId) &&
        (!tag || post.tags.includes(tag)) &&
        wordsMatch(q, [
          post.title.en,
          post.title.de,
          post.summary?.en,
          post.summary?.de,
          ...post.tags,
        ]),
    );
    const desc =
      (key: (post: BlogPostRecord) => string | null) =>
      (a: BlogPostRecord, b: BlogPostRecord) => {
        const [ka, kb] = [key(a) ?? "", key(b) ?? ""];
        return ka === kb ? (a.id < b.id ? 1 : -1) : ka < kb ? 1 : -1;
      };
    rows = [...rows].sort(
      sort === "newest"
        ? desc((post) => post.createdAt)
        : sort === "published"
          ? desc((post) => post.publishedAt)
          : sort === "title"
            ? (a, b) => a.title.en.localeCompare(b.title.en, "en")
            : desc((post) => post.updatedAt),
    );
    const result = page(rows, ctx.query, PAGE_LIMIT);
    return json({
      ...result,
      items: result.items.map((post) => postSummary(ctx.db, post, ctx.now)),
    });
  });

  // Before `:id`: "tags" is not an id.
  router.get(`${posts}/tags`, read, (ctx) => {
    const counts = new Map<string, number>();
    for (const post of ctx.db.blogPosts) {
      for (const tag of post.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return json({
      items: [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([tag, count]) => ({ tag, count })),
    });
  });

  router.post(posts, manage, async (ctx) => {
    const input = await ctx.body(zPostInput);
    if (input.categoryId) categoryById(ctx.db, input.categoryId);
    const title = { en: input.title.en, de: input.title.de ?? null };
    const wantedEn = input.slug?.en?.trim() || slugify(title.en);
    const wantedDe = input.slug?.de?.trim() || slugify(title.de ?? title.en);
    if (input.slug?.en) {
      checkSlugFree(
        ctx.db.blogPosts,
        wantedEn,
        "en",
        null,
        "BLOG_POST_SLUG_TAKEN",
      );
    }
    if (input.slug?.de) {
      checkSlugFree(
        ctx.db.blogPosts,
        wantedDe,
        "de",
        null,
        "BLOG_POST_SLUG_TAKEN",
      );
    }
    const record: BlogPostRecord = {
      id: newId(ctx.now),
      title,
      slug: {
        en: uniqueSlug(ctx.db.blogPosts, wantedEn, "en", null),
        de: uniqueSlug(ctx.db.blogPosts, wantedDe, "de", null),
      },
      summary: optionalText(input.summary) ?? null,
      content: optionalText(input.content) ?? { en: null, de: null },
      status: input.status ?? "draft",
      publishedAt:
        input.publishedAt === undefined || input.publishedAt === null
          ? input.status === "published"
            ? iso(ctx.now)
            : null
          : new Date(input.publishedAt).toISOString(),
      authorName: input.authorName ?? ctx.admin.name,
      authorId: ctx.admin.id,
      categoryId: input.categoryId ?? null,
      tags: cleanTags(input.tags ?? []),
      featuredImage: null,
      images: [],
      seo: seoOf(input.seo, null),
      createdAt: iso(ctx.now),
      updatedAt: iso(ctx.now),
    };
    if (record.status === "published") incomplete(record);
    ctx.db.blogPosts.push(record);
    return json({ post: postDetail(ctx.db, record, ctx.now) }, 201);
  });

  router.get(`${posts}/:id`, read, (ctx) =>
    json({
      post: postDetail(ctx.db, postById(ctx.db, ctx.params.id ?? ""), ctx.now),
    }),
  );

  router.patch(`${posts}/:id`, manage, async (ctx) => {
    const input = await ctx.body(zPostPatch);
    const record = postById(ctx.db, ctx.params.id ?? "");
    if (input.categoryId) categoryById(ctx.db, input.categoryId);
    if (input.title)
      record.title = { en: input.title.en, de: input.title.de ?? null };
    if (input.slug) {
      for (const locale of ["en", "de"] as const) {
        const wanted = input.slug[locale]?.trim();
        if (!wanted) continue;
        checkSlugFree(
          ctx.db.blogPosts,
          wanted,
          locale,
          record.id,
          "BLOG_POST_SLUG_TAKEN",
        );
        record.slug = { ...record.slug, [locale]: wanted };
      }
    }
    if (input.summary !== undefined)
      record.summary = optionalText(input.summary) ?? null;
    if (input.content !== undefined) {
      record.content = optionalText(input.content) ?? { en: null, de: null };
    }
    if (input.authorName !== undefined) record.authorName = input.authorName;
    if (input.categoryId !== undefined) record.categoryId = input.categoryId;
    if (input.tags !== undefined) record.tags = cleanTags(input.tags);
    if (input.publishedAt !== undefined) {
      record.publishedAt =
        input.publishedAt === null
          ? null
          : new Date(input.publishedAt).toISOString();
    }
    if (input.status !== undefined) {
      if (input.status === "published") {
        incomplete(record);
        record.publishedAt ??= iso(ctx.now);
      }
      record.status = input.status;
    }
    record.seo = seoOf(input.seo, record.seo);
    record.updatedAt = iso(ctx.now);
    return json({ post: postDetail(ctx.db, record, ctx.now) });
  });

  router.post(`${posts}/:id/publish`, manage, async (ctx) => {
    const input = await ctx.body(
      z.strictObject({
        publishedAt: z.iso.datetime({ offset: true }).optional(),
      }),
    );
    const record = postById(ctx.db, ctx.params.id ?? "");
    incomplete(record);
    record.status = "published";
    record.publishedAt = input.publishedAt
      ? new Date(input.publishedAt).toISOString()
      : (record.publishedAt ?? iso(ctx.now));
    record.updatedAt = iso(ctx.now);
    return json({ post: postDetail(ctx.db, record, ctx.now) });
  });

  router.post(`${posts}/:id/unpublish`, manage, (ctx) => {
    const record = postById(ctx.db, ctx.params.id ?? "");
    record.status = "draft";
    record.updatedAt = iso(ctx.now);
    return json({ post: postDetail(ctx.db, record, ctx.now) });
  });

  router.delete(`${posts}/:id`, manage, (ctx) => {
    const record = postById(ctx.db, ctx.params.id ?? "");
    ctx.db.blogPosts = ctx.db.blogPosts.filter((entry) => entry !== record);
    return noContent();
  });

  router.put(`${posts}/:id/featured-image`, manage, async (ctx) => {
    const record = postById(ctx.db, ctx.params.id ?? "");
    const [file] = await uploadedFiles(ctx.request, "file", 1);
    const image = storeImage(
      ctx.db,
      await readImage(file as File, BLOG_FEATURED_IMAGE),
      ctx.now,
      BLOG_FEATURED_WIDTHS,
    );
    record.featuredImage = {
      ...image,
      alt: record.featuredImage?.alt ?? image.alt,
    };
    record.updatedAt = iso(ctx.now);
    return json({ post: postDetail(ctx.db, record, ctx.now) });
  });

  router.patch(`${posts}/:id/featured-image`, manage, async (ctx) => {
    const input = await ctx.body(
      z.strictObject({ alt: zTranslatedOptional(300) }),
    );
    const record = postById(ctx.db, ctx.params.id ?? "");
    if (!record.featuredImage) {
      throw fail(404, "IMAGE_NOT_FOUND", "The post has no featured image.");
    }
    record.featuredImage.alt = { ...record.featuredImage.alt, ...input.alt };
    record.updatedAt = iso(ctx.now);
    return json({ post: postDetail(ctx.db, record, ctx.now) });
  });

  router.delete(`${posts}/:id/featured-image`, manage, (ctx) => {
    const record = postById(ctx.db, ctx.params.id ?? "");
    if (!record.featuredImage) {
      throw fail(404, "IMAGE_NOT_FOUND", "The post has no featured image.");
    }
    record.featuredImage = null;
    record.updatedAt = iso(ctx.now);
    return json({ post: postDetail(ctx.db, record, ctx.now) });
  });

  router.post(`${posts}/:id/images`, manage, async (ctx) => {
    const record = postById(ctx.db, ctx.params.id ?? "");
    const files = await uploadedFiles(ctx.request, "files", 10);
    const remaining = MAX_IMAGES - record.images.length;
    if (files.length > remaining) {
      throw fail(
        400,
        "IMAGE_LIMIT_REACHED",
        `A post can have ${MAX_IMAGES} images at most.`,
        { maximum: MAX_IMAGES, remaining },
      );
    }
    // All or nothing: every file is checked before one is stored.
    const images = [];
    for (const file of files) images.push(await readImage(file as File));
    for (const image of images) {
      record.images.push(storeImage(ctx.db, image, ctx.now));
    }
    record.updatedAt = iso(ctx.now);
    return json({ post: postDetail(ctx.db, record, ctx.now) });
  });

  router.delete(`${posts}/:id/images/:imageId`, manage, (ctx) => {
    const record = postById(ctx.db, ctx.params.id ?? "");
    const image = record.images.find(
      (entry) => entry.id === ctx.params.imageId,
    );
    if (!image) throw fail(404, "IMAGE_NOT_FOUND", "Image not found.");
    record.images = record.images.filter((entry) => entry !== image);
    record.updatedAt = iso(ctx.now);
    return json({ post: postDetail(ctx.db, record, ctx.now) });
  });

  // --- Categories -----------------------------------------------------------

  router.get(categories, read, (ctx) => {
    const loose = ctx.db.blogPosts.filter((post) => post.categoryId === null);
    return json({
      items: orderedCategories(ctx.db).map((category) =>
        categoryView(ctx.db, category, true),
      ),
      uncategorized: {
        total: loose.length,
        published: loose.filter((post) => post.status === "published").length,
      },
    });
  });

  router.post(categories, manage, async (ctx) => {
    const input = await ctx.body(zCategoryInput);
    const name = { en: input.name.en, de: input.name.de ?? null };
    const wantedEn = input.slug?.en?.trim() || slugify(name.en);
    const wantedDe = input.slug?.de?.trim() || slugify(name.de ?? name.en);
    if (input.slug?.en) {
      checkSlugFree(
        ctx.db.blogCategories,
        wantedEn,
        "en",
        null,
        "BLOG_CATEGORY_SLUG_TAKEN",
      );
    }
    if (input.slug?.de) {
      checkSlugFree(
        ctx.db.blogCategories,
        wantedDe,
        "de",
        null,
        "BLOG_CATEGORY_SLUG_TAKEN",
      );
    }
    const record: BlogCategoryRecord = {
      id: newId(ctx.now),
      name,
      slug: {
        en: uniqueSlug(ctx.db.blogCategories, wantedEn, "en", null),
        de: uniqueSlug(ctx.db.blogCategories, wantedDe, "de", null),
      },
      description: optionalText(input.description) ?? null,
      seo: input.seo
        ? {
            title: optionalText(input.seo.title) ?? null,
            description: optionalText(input.seo.description) ?? null,
          }
        : null,
      sortOrder: ctx.db.blogCategories.length,
      createdAt: iso(ctx.now),
      updatedAt: iso(ctx.now),
    };
    ctx.db.blogCategories.push(record);
    return json({ category: categoryView(ctx.db, record, false) }, 201);
  });

  router.put(`${categories}/order`, manage, async (ctx) => {
    const input = await ctx.body(
      z.strictObject({ orderedIds: z.array(zId).min(1).max(500) }),
    );
    const expected = orderedCategories(ctx.db).map((category) => category.id);
    const same =
      expected.length === input.orderedIds.length &&
      new Set(input.orderedIds).size === input.orderedIds.length &&
      input.orderedIds.every((id) => expected.includes(id));
    if (!same) {
      throw fail(
        400,
        "BLOG_CATEGORY_ORDER_INVALID",
        "orderedIds must name every category exactly once.",
        { expected },
      );
    }
    input.orderedIds.forEach((id, index) => {
      categoryById(ctx.db, id).sortOrder = index;
    });
    return json({
      items: orderedCategories(ctx.db).map((category) =>
        categoryView(ctx.db, category, true),
      ),
    });
  });

  router.get(`${categories}/:id`, read, (ctx) =>
    json({
      category: categoryView(
        ctx.db,
        categoryById(ctx.db, ctx.params.id ?? ""),
        false,
      ),
    }),
  );

  router.patch(`${categories}/:id`, manage, async (ctx) => {
    const input = await ctx.body(zCategoryPatch);
    const record = categoryById(ctx.db, ctx.params.id ?? "");
    if (input.name)
      record.name = { en: input.name.en, de: input.name.de ?? null };
    if (input.slug) {
      for (const locale of ["en", "de"] as const) {
        const wanted = input.slug[locale]?.trim();
        if (!wanted) continue;
        checkSlugFree(
          ctx.db.blogCategories,
          wanted,
          locale,
          record.id,
          "BLOG_CATEGORY_SLUG_TAKEN",
        );
        record.slug = { ...record.slug, [locale]: wanted };
      }
    }
    if (input.description !== undefined) {
      record.description = optionalText(input.description) ?? null;
    }
    if (input.seo !== undefined) {
      record.seo = {
        title: optionalText(input.seo.title) ?? record.seo?.title ?? null,
        description:
          optionalText(input.seo.description) ??
          record.seo?.description ??
          null,
      };
    }
    record.updatedAt = iso(ctx.now);
    return json({ category: categoryView(ctx.db, record, false) });
  });

  router.delete(`${categories}/:id`, manage, (ctx) => {
    const record = categoryById(ctx.db, ctx.params.id ?? "");
    const inUse = ctx.db.blogPosts.filter(
      (post) => post.categoryId === record.id,
    ).length;
    if (inUse > 0) {
      throw fail(
        409,
        "BLOG_CATEGORY_HAS_POSTS",
        "The category still has posts. Move them first.",
        { posts: inUse },
      );
    }
    ctx.db.blogCategories = ctx.db.blogCategories.filter(
      (entry) => entry !== record,
    );
    orderedCategories(ctx.db).forEach((category, index) => {
      category.sortOrder = index;
    });
    return noContent();
  });
}

// --- Demo data ----------------------------------------------------------------

const RECIPE = `# The perfect dal

Five lentils, one pot, forty minutes. This is the dal we cook at home on a weekday.

## What you need

- 200 g **toor dal** (split pigeon peas)
- 1 onion, 2 tomatoes, 3 cloves of garlic
- 1 tsp turmeric, 1 tsp cumin seeds, 1 tsp garam masala
- Ghee or oil, salt, a handful of coriander

## Method

1. Wash the dal until the water runs clear and soak it for twenty minutes.
2. Cook it with the turmeric and twice its volume of water until it falls apart.
3. Fry the cumin in ghee, add the onion, then the garlic and the tomatoes.
4. Stir the tempering into the dal, season, and finish with the garam masala and the coriander.

Serve with rice or roti.`;

/** Three categories and six posts: published, scheduled and drafts, one with pictures in the text. */
export function seedBlog(db: Db, now: number, author: AdminRecord): void {
  const publicUrl = db.config.publicUrl;
  const at = now - 40 * DAY;
  const category = (
    name: [string, string],
    description: [string, string | null],
  ): BlogCategoryRecord => {
    const record: BlogCategoryRecord = {
      id: newId(at + db.blogCategories.length * HOUR),
      name: { en: name[0], de: name[1] },
      slug: { en: slugify(name[0]), de: slugify(name[1]) },
      description: { en: description[0], de: description[1] },
      seo: null,
      sortOrder: db.blogCategories.length,
      createdAt: iso(at),
      updatedAt: iso(at),
    };
    db.blogCategories.push(record);
    return record;
  };
  const featured = (
    created: number,
    label: string,
    hue: number,
    alt: [string, string | null],
  ): AdminImage => {
    const url = (width: number, height: number) =>
      `${publicUrl}/media/banner/${hue}/${width}x${height}/${encodeURIComponent(label)}.svg`;
    return {
      id: newId(created + 1),
      alt: { en: alt[0], de: alt[1] },
      isPrimary: false,
      url: url(1920, 800),
      sizes: {
        small: { url: url(480, 200), width: 480, height: 200 },
        medium: { url: url(1024, 427), width: 1024, height: 427 },
        large: { url: url(1920, 800), width: 1920, height: 800 },
      },
      bytes: 240_000 + hue * 100,
      uploadedAt: iso(created),
    };
  };
  const textImage = (
    created: number,
    label: string,
    hue: number,
  ): AdminImage => {
    const url = (size: number) =>
      `${publicUrl}/media/placeholder/${hue}/${size}/${encodeURIComponent(label)}.svg`;
    return {
      id: newId(created + 2),
      alt: { en: label, de: null },
      isPrimary: false,
      url: url(1600),
      sizes: {
        small: { url: url(320), width: 320, height: 320 },
        medium: { url: url(800), width: 800, height: 800 },
        large: { url: url(1600), width: 1600, height: 1600 },
      },
      bytes: 90_000 + hue * 50,
      uploadedAt: iso(created),
    };
  };
  const post = (
    daysAgo: number,
    input: Omit<
      BlogPostRecord,
      | "id"
      | "slug"
      | "createdAt"
      | "updatedAt"
      | "authorId"
      | "authorName"
      | "featuredImage"
      | "images"
    > & {
      featuredImage?: AdminImage | null;
      images?: AdminImage[];
    },
  ): void => {
    const created = now - daysAgo * DAY - 3 * HOUR;
    db.blogPosts.push({
      id: newId(created),
      slug: {
        en: slugify(input.title.en),
        de: slugify(input.title.de ?? input.title.en),
      },
      authorName: author.name,
      authorId: author.id,
      featuredImage: input.featuredImage ?? null,
      images: input.images ?? [],
      createdAt: iso(created),
      updatedAt: iso(created + 2 * HOUR),
      ...input,
    });
  };

  const recipes = category(
    ["Recipes", "Rezepte"],
    [
      "What we cook with what we sell.",
      "Was wir aus dem kochen, was wir verkaufen.",
    ],
  );
  const ingredients = category(
    ["Ingredients", "Zutaten"],
    ["A closer look at one ingredient at a time.", null],
  );
  const shop = category(
    ["Behind the shop", "Hinter dem Laden"],
    ["News from Radhe Foods.", "Neues von Radhe Foods."],
  );

  const dalAt = now - 20 * DAY;
  post(20, {
    title: { en: "The perfect dal", de: "Das perfekte Dal" },
    summary: {
      en: "Five lentils, one pot, forty minutes: the weekday dal we cook at home.",
      de: "Fünf Linsen, ein Topf, vierzig Minuten: das Dal, das wir unter der Woche kochen.",
    },
    content: {
      en: RECIPE,
      de: RECIPE.replace("# The perfect dal", "# Das perfekte Dal"),
    },
    status: "published",
    publishedAt: iso(dalAt),
    categoryId: recipes.id,
    tags: ["recipes", "lentils", "weeknight"],
    seo: {
      title: { en: "The perfect dal – Radhe Foods", de: null },
      description: null,
    },
    featuredImage: featured(dalAt, "The perfect dal", 36, [
      "A bowl of dal with rice",
      "Eine Schüssel Dal mit Reis",
    ]),
    images: [
      textImage(dalAt, "Toor dal", 40),
      textImage(dalAt, "The tempering", 20),
    ],
  });
  post(12, {
    title: {
      en: "Basmati, and why the age matters",
      de: "Basmati, und warum das Alter zählt",
    },
    summary: {
      en: "Aged basmati cooks longer, lighter and more fragrant. Here is what to look for.",
      de: null,
    },
    content: {
      en: "# Basmati\n\nBasmati is aged for a year or two before it is sold. The ageing dries the grain, so it absorbs more water, grows longer and stays separate.\n\n## How to cook it\n\nRinse, soak for thirty minutes, and cook in plenty of salted water for eight to ten minutes.",
      de: null,
    },
    status: "published",
    publishedAt: iso(now - 12 * DAY),
    categoryId: ingredients.id,
    tags: ["rice", "basmati"],
    seo: null,
    featuredImage: featured(now - 12 * DAY, "Basmati rice", 48, [
      "Grains of aged basmati rice",
      null,
    ]),
  });
  post(6, {
    title: {
      en: "New: chilled delivery every Monday",
      de: "Neu: gekühlte Lieferung jeden Montag",
    },
    summary: {
      en: "Paneer, yoghurt and fresh produce now travel in insulated boxes.",
      de: "Paneer, Joghurt und frische Ware reisen jetzt in Isolierboxen.",
    },
    content: {
      en: "# Chilled delivery\n\nFrom this week, chilled products are dispatched on Mondays in insulated boxes with cooling packs. Order by Sunday evening.",
      de: "# Gekühlte Lieferung\n\nAb dieser Woche verschicken wir gekühlte Produkte montags in Isolierboxen mit Kühlakkus. Bestellen Sie bis Sonntagabend.",
    },
    status: "published",
    publishedAt: iso(now - 6 * DAY),
    categoryId: shop.id,
    tags: ["delivery", "news"],
    seo: null,
    featuredImage: featured(now - 6 * DAY, "Chilled delivery", 190, [
      "An insulated delivery box",
      "Eine Isolierbox",
    ]),
  });
  post(2, {
    title: {
      en: "Diwali sweets: a short guide",
      de: "Diwali-Süßigkeiten: ein kurzer Leitfaden",
    },
    summary: {
      en: "Ladoo, barfi, jalebi: what they are and how we make them.",
      de: null,
    },
    content: {
      en: "# Diwali sweets\n\nA guide to the sweets of the festival, from ladoo to jalebi.",
      de: null,
    },
    status: "published",
    publishedAt: iso(now + 5 * DAY),
    categoryId: recipes.id,
    tags: ["diwali", "sweets"],
    seo: null,
    featuredImage: featured(now - 2 * DAY, "Diwali sweets", 28, [
      "A plate of Diwali sweets",
      null,
    ]),
  });
  post(1, {
    title: { en: "How we choose our spices", de: null },
    summary: null,
    content: {
      en: "# Spices\n\nDraft: notes on the importers we work with.",
      de: null,
    },
    status: "draft",
    publishedAt: null,
    categoryId: ingredients.id,
    tags: ["spices"],
    seo: null,
  });
  post(0.5, {
    title: { en: "Roti for beginners", de: "Roti für Anfänger" },
    summary: null,
    content: { en: null, de: "# Roti\n\nEin Entwurf, erst auf Deutsch." },
    status: "draft",
    publishedAt: null,
    categoryId: null,
    tags: [],
    seo: null,
  });
}
