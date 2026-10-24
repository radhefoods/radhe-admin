# Blog

For the Admin Panel agent and the Customer Web agent. The articles the admin writes, as the Radhe Foods API keeps them as of 2026-10-24: in English and German, with a featured picture and pictures in the text, a category, tags, a date, SEO fields; drafts, scheduled and published. Section 23 of `doc/ADMIN_API_DOCUMENTATION.md` and section 19 of `doc/CUSTOMER_WEB_API_DOCUMENTATION.md` are the short forms.

**Strict rule for both frontends:** do not change the visual design. Build the blog pages of the panel inside its existing layouts, forms and tables, and the blog of the shop with the shop's existing typography, cards and page templates.

## 1. The model

### Posts (`blogPosts`)

| Field | Meaning |
| --- | --- |
| `title { en, de? }` | English required |
| `slug { en, de }` | Part of the URL in each language. Generated from the title when not given; unique per language; changed only on request (renaming keeps the URL) |
| `summary { en?, de? }` | A few lines (≤500 chars) for the list, the search engines and the social preview |
| `content { en?, de? }` | The article as **Markdown** (≤300 000 chars). English is required before the post can be published |
| `featuredImage` | One picture, heads the article and its card. Stored as WebP in widths 480, 1024 and 1920; at least 800 × 400 px |
| `images[]` | Up to 20 pictures for the text (WebP in widths 320, 800 and 1600). Their addresses are pasted into the Markdown |
| `authorName` | Printed under the title. Defaults to the name of the admin who created the post |
| `categoryId` | One category of the blog, or `null` |
| `tags[]` | Lower-case words, the same in both languages, at most 20 |
| `status` | `draft` or `published` |
| `publishedAt` | The date of the article. A published post is shown from this moment on: a date in the future **schedules** it |
| `seo { title, description }` | Per language; the shop falls back to the title and the summary |
| `visibility` | Computed: `draft`, `scheduled` (published, date in the future), `published` |
| `readingMinutes` | Computed from the word count of the text, about 200 words a minute |

### Categories (`blogCategories`)

Flat: `name { en, de? }`, `slug { en, de }` (generated, unique per language), `description { en?, de? }`, `seo`, `sortOrder`. A category with posts cannot be deleted.

### Tags

Not a collection: the words on the posts. `GET …/tags` lists them with counts.

### What the shop shows

A post whose `status` is `published` and whose `publishedAt` has come. Everything else is for the admin only. Unpublishing makes a post a draft again and keeps its date and text.

## 2. Admin API

**Permissions:** `content.read` to see, `content.manage` to change (shared with the FAQ).

### The post object (admin)

```json
{
  "id": "66f1…",
  "title": { "en": "The perfect dal", "de": "Das perfekte Dal" },
  "slug": { "en": "the-perfect-dal", "de": "das-perfekte-dal" },
  "summary": { "en": "Five lentils, one pot.", "de": null },
  "status": "published",
  "visibility": "published",
  "publishedAt": "2026-10-20T08:00:00.000Z",
  "authorName": "Vrushabh",
  "authorId": "66a0…",
  "categoryId": "66e1…",
  "category": { "id": "66e1…", "name": { "en": "Recipes", "de": "Rezepte" } },
  "tags": ["recipes", "lentils"],
  "featuredImage": { "id": "…", "alt": { "en": "A bowl of dal", "de": null }, "isPrimary": false, "url": "…/large.webp", "sizes": { "small": { "url": "…", "width": 480, "height": 270 }, "medium": { "…": "" }, "large": { "…": "" } }, "bytes": 310000, "uploadedAt": "…" },
  "imageCount": 2,
  "readingMinutes": 4,
  "createdAt": "…",
  "updatedAt": "…",
  "content": { "en": "# Dal\n\nWash the lentils…", "de": "# Dal\n\n…" },
  "seo": { "title": { "en": "The perfect dal – Radhe Foods", "de": null }, "description": null },
  "images": [ { "id": "…", "url": "…/large.webp", "sizes": { "…": "" }, "alt": { "…": "" }, "bytes": 120000, "uploadedAt": "…" } ]
}
```

The list answers the fields up to `updatedAt` (no `content`, `seo` or `images`).

### Posts

| Endpoint | Body / query | Answer |
| --- | --- | --- |
| `GET /v1/admin/blog-posts` | `page`, `limit` (≤100), `status`, `categoryId`, `tag`, `q` (words of the title, summary or tags), `sort` = `updated` (default) \| `newest` \| `published` \| `title` | page `{ items, page, limit, total, totalPages }` |
| `GET /v1/admin/blog-posts/tags` | | `{ items: [{ tag, count }] }` over every post |
| `POST /v1/admin/blog-posts` | see below | `201 { post }` |
| `GET /v1/admin/blog-posts/{id}` | | `{ post }` with text and pictures |
| `PATCH /v1/admin/blog-posts/{id}` | any field of the creation | `{ post }` |
| `POST /v1/admin/blog-posts/{id}/publish` | `{ publishedAt? }` | `{ post }`: `status` `published`; the date sent, else the one the post has, else now |
| `POST /v1/admin/blog-posts/{id}/unpublish` | | `{ post }`: `status` `draft`, date kept |
| `DELETE /v1/admin/blog-posts/{id}` | | `204`, pictures deleted |
| `PUT /v1/admin/blog-posts/{id}/featured-image` | multipart, field `file` | `{ post }`; the old picture is deleted, its description kept |
| `PATCH /v1/admin/blog-posts/{id}/featured-image` | `{ alt: { en?, de? } }` | `{ post }` |
| `DELETE /v1/admin/blog-posts/{id}/featured-image` | | `{ post }` |
| `POST /v1/admin/blog-posts/{id}/images` | multipart, field `files` (up to 10) | `200 { post }` with every picture; paste `images[].url` or a size into the Markdown |
| `DELETE /v1/admin/blog-posts/{id}/images/{imageId}` | | `{ post }` |

**Creation body:**

```json
{
  "title": { "en": "The perfect dal", "de": "Das perfekte Dal" },
  "slug": { "en": "perfect-dal" },
  "summary": { "en": "Five lentils, one pot." },
  "content": { "en": "# Dal\n\nWash the lentils…" },
  "authorName": "Vrushabh",
  "categoryId": "66e1…",
  "tags": ["Recipes", "lentils"],
  "status": "draft",
  "publishedAt": "2026-10-25T08:00:00.000Z",
  "seo": { "title": { "en": "…" }, "description": { "en": "…" } }
}
```

Everything but `title` is optional. `tags` are trimmed, lower-cased and de-duplicated. `status: "published"` at creation needs `content.en`. `categoryId: null` means no category.

**Errors:** `404 BLOG_POST_NOT_FOUND`, `404 BLOG_CATEGORY_NOT_FOUND` (unknown `categoryId`), `409 BLOG_POST_SLUG_TAKEN`, `400 BLOG_POST_INCOMPLETE` (`details.missing: ["content.en"]`, publishing without the English text), `400 VALIDATION_FAILED`; pictures: `400 IMAGE_REQUIRED`, `IMAGE_FORMAT_NOT_ALLOWED`, `IMAGE_DIMENSIONS_INVALID` (featured: `details.minimum 800`, `minimumHeight 400`), `IMAGE_INVALID`, `IMAGE_LIMIT_REACHED` (`details.maximum 20`), `404 IMAGE_NOT_FOUND`, `413 FILE_TOO_LARGE`, `503 STORAGE_UNAVAILABLE`.

### Categories

| Endpoint | Body | Answer |
| --- | --- | --- |
| `GET /v1/admin/blog-categories` | | `{ items: [category…], uncategorized: { total, published } }` in display order, each with `postCount` and `publishedCount` |
| `POST /v1/admin/blog-categories` | `{ name: { en, de? }, slug?: { en?, de? }, description?: { en?, de? }, seo? }` | `201 { category }`, last in the order |
| `GET /v1/admin/blog-categories/{id}` | | `{ category }` |
| `PATCH /v1/admin/blog-categories/{id}` | any field; the slug changes only when sent | `{ category }` |
| `PUT /v1/admin/blog-categories/order` | `{ orderedIds: [every category exactly once] }` | `{ items }` |
| `DELETE /v1/admin/blog-categories/{id}` | | `204`; `409 BLOG_CATEGORY_HAS_POSTS` (`details.posts`) while it has posts |

Errors: `404 BLOG_CATEGORY_NOT_FOUND`, `409 BLOG_CATEGORY_SLUG_TAKEN`, `400 BLOG_CATEGORY_ORDER_INVALID`.

## 3. Public API

**Authentication:** none. `?locale=en|de` on every call (else `Accept-Language`). `Cache-Control: public, max-age=300`.

### `GET /v1/store/blog/posts`

Query: `page`, `limit` (default 24, ≤100), `category` (slug in either language), `tag`, `q` (words of the title, summary or tags, by their beginning). Published posts whose date has come, newest first, without their texts. An unknown `category` answers an empty page.

```json
{
  "items": [
    {
      "id": "66f1…",
      "slug": "the-perfect-dal",
      "title": "The perfect dal",
      "summary": "Five lentils, one pot.",
      "featuredImage": { "id": "…", "alt": "A bowl of dal", "isPrimary": false, "url": "…/large.webp", "sizes": { "small": { "url": "…", "width": 480, "height": 270 }, "medium": { "…": "" }, "large": { "…": "" } } },
      "author": "Vrushabh",
      "publishedAt": "2026-10-20T08:00:00.000Z",
      "readingMinutes": 4,
      "category": { "id": "66e1…", "slug": "recipes", "name": "Recipes" },
      "tags": ["recipes", "lentils"]
    }
  ],
  "page": 1,
  "limit": 24,
  "total": 1,
  "totalPages": 1
}
```

`featuredImage` is `null` without a picture; its `alt` falls back to the title. `summary` is `null` when none was written.

### `GET /v1/store/blog/posts/{slug}`

The slug of either language finds the post. `404 BLOG_POST_NOT_FOUND` for a draft, a scheduled post or an unknown slug.

```json
{
  "post": {
    "…the list entry…": "",
    "content": "# Dal\n\nWash the lentils…",
    "contentLocale": "en",
    "seo": { "title": "The perfect dal – Radhe Foods", "description": "Five lentils, one pot." },
    "alternates": { "en": "the-perfect-dal", "de": "das-perfekte-dal" },
    "updatedAt": "2026-10-21T10:00:00.000Z",
    "related": [ { "…list entries, up to three…": "" } ]
  }
}
```

- `content` is Markdown in the requested language, or the other language when the requested one is missing; `contentLocale` says which (`null` when there is no text at all).
- `seo.title` and `seo.description` are ready to use: the SEO fields when set, else the title and the summary.
- `alternates` are the slugs of both languages, for the language switch and `hreflang`.
- `related`: the newest other published posts of the same category, filled up with the newest of the blog, at most three.

### `GET /v1/store/blog/categories`

`{ items: [{ id, slug, name, description, postCount, seo: { title, description }, alternates: { en, de } }] }` in display order; `postCount` counts the published posts. Categories with `postCount` 0 may be hidden by the shop.

### `GET /v1/store/blog/tags`

`{ items: [{ tag, count }] }` over the published posts, most used first.

## 4. Panel workflow

- A **Blog** area with two pages: posts and categories; permission `content.read`, writes `content.manage`.
- Posts list: the existing data table with status badge (`visibility`: draft / scheduled / published), title, category, author, date, updated; filters status, category, tag, search; sort. Pagination by `page`/`limit`.
- Post form, in two language tabs (English required): title, slug (generated, shown, editable), summary, content as **Markdown** in the editor the panel has for the legal texts (a textarea with a preview is enough; a Markdown toolbar if one exists). Side panel: status and date (publish now, schedule for a date, unpublish), category select, tags input, author name, SEO title and description, featured picture (upload, replace, description, remove), pictures for the text (upload several, copy the address of a size, remove). Inserting a picture into the text pastes `![description](url)` at the cursor.
- Publish button: `POST …/publish`; a date picker in the future schedules. Handle `BLOG_POST_INCOMPLETE` with a message that the English text is missing.
- Categories: list in order with post counts, add, edit (name, slug, description, SEO), drag and drop order, delete disabled while `postCount` > 0.
- Deleting a post asks for confirmation: its pictures go with it.

## 5. Shop workflow

- Routes: `/blog` (list, paginated, with the categories as filters and the tags), `/blog/[slug]` (article), `/blog/category/[slug]`, `/blog/tag/[tag]`; the shop's language routing as for the catalogue.
- The article: featured picture (`sizes` into `srcset`, ratio kept), title, author and date (formatted in the shop's locale), reading time, the Markdown rendered with the shop's existing renderer (no raw HTML), the tags, the related posts as cards.
- Language switch on an article: go to `alternates[otherLocale]`; emit `hreflang` links for both slugs.
- SEO: `<title>` and `meta description` from `seo`; Open Graph and Twitter cards with `featuredImage.sizes.medium`; `Article` structured data (`headline`, `datePublished`, `dateModified` from `updatedAt`, `author`, `image`); the list pages with `noindex` for `page > 1` if the shop does that elsewhere; sitemap entries from `GET /v1/store/blog/posts?limit=100` page by page.
- Search: the blog's own search field on `/blog` calls the list with `q`; the shop's product search stays as it is.
- Cache as the catalogue (five minutes). A `404` on an article shows the shop's not-found page.

## 6. Checklist

1. Admin: posts table with filters and sort; the form in two language tabs with Markdown and pictures; publish, schedule, unpublish; categories with order; permissions.
2. Shop: list, article, category and tag pages; language switch by `alternates`; SEO tags and structured data; Markdown rendering; nothing shown for drafts or scheduled posts.
3. Both: no change to theme, colours, fonts or typography.
