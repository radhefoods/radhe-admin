import { describe, expect, it } from "vitest";
import type { BlogPost } from "@/lib/api/types";
import {
  postDefaults,
  postSchema,
  toPostInput,
  toPostPatch,
} from "./post-schema";

const post: BlogPost = {
  id: "66f100000000000000000001",
  title: { en: "The perfect dal", de: "Das perfekte Dal" },
  slug: { en: "the-perfect-dal", de: "das-perfekte-dal" },
  summary: { en: "Five lentils, one pot.", de: null },
  status: "published",
  visibility: "published",
  publishedAt: "2026-10-20T08:00:00.000Z",
  authorName: "Vrushabh",
  authorId: "66a000000000000000000001",
  categoryId: "66e100000000000000000001",
  category: { id: "66e100000000000000000001", name: { en: "Recipes" } },
  tags: ["recipes", "lentils"],
  featuredImage: null,
  imageCount: 0,
  readingMinutes: 2,
  createdAt: "2026-10-19T08:00:00.000Z",
  updatedAt: "2026-10-21T08:00:00.000Z",
  content: { en: "# Dal\n\nWash the lentils.", de: null },
  seo: {
    title: { en: "The perfect dal – Radhe Foods", de: null },
    description: null,
  },
  images: [],
};

const parse = (values: ReturnType<typeof postDefaults>) =>
  postSchema.parse(values);

describe("a new post", () => {
  it("sends the title and only what was filled; an empty slug is left to the API", () => {
    const values = postDefaults(undefined, "Vrushabh");
    values.title.en = "Roti for beginners";
    values.tags = ["recipes"];
    expect(toPostInput(parse(values))).toEqual({
      title: { en: "Roti for beginners", de: null },
      authorName: "Vrushabh",
      tags: ["recipes"],
    });
  });

  it("sends a typed slug, the texts, the category and the SEO fields", () => {
    const values = postDefaults(undefined, "Vrushabh");
    values.title = { en: "Roti", de: "Roti" };
    values.slug = { en: "roti-for-beginners", de: "" };
    values.summary = { en: "Flat bread.", de: "" };
    values.content = { en: "# Roti", de: "" };
    values.categoryId = post.categoryId as string;
    values.seoTitle = { en: "", de: "Roti – Radhe Foods" };
    expect(toPostInput(parse(values))).toEqual({
      title: { en: "Roti", de: "Roti" },
      slug: { en: "roti-for-beginners" },
      summary: { en: "Flat bread.", de: null },
      content: { en: "# Roti", de: null },
      authorName: "Vrushabh",
      categoryId: post.categoryId,
      seo: { title: { en: null, de: "Roti – Radhe Foods" } },
    });
  });

  it("refuses an English title that is missing and a slug with capitals or spaces", () => {
    const values = postDefaults();
    values.slug.en = "The Dal";
    const result = postSchema.safeParse(values);
    expect(result.success).toBe(false);
    const paths = result.success
      ? []
      : result.error.issues.map((issue) => issue.path.join("."));
    expect(paths).toContain("title.en");
    expect(paths).toContain("slug.en");
  });
});

describe("a changed post", () => {
  it("sends nothing when nothing changed", () => {
    expect(toPostPatch(parse(postDefaults(post)), post)).toEqual({});
  });

  it("sends only the fields that changed, and the slug only where it was retyped", () => {
    const values = postDefaults(post);
    values.title.de = "Das beste Dal";
    values.slug.de = "das-beste-dal";
    values.content.de = "# Dal\n\nLinsen waschen.";
    values.categoryId = "";
    values.tags = ["recipes", "lentils", "weeknight"];
    expect(toPostPatch(parse(values), post)).toEqual({
      title: { en: "The perfect dal", de: "Das beste Dal" },
      slug: { de: "das-beste-dal" },
      content: {
        en: "# Dal\n\nWash the lentils.",
        de: "# Dal\n\nLinsen waschen.",
      },
      categoryId: null,
      tags: ["recipes", "lentils", "weeknight"],
    });
  });

  it("clears a summary and an SEO title that were emptied", () => {
    const values = postDefaults(post);
    values.summary.en = "";
    values.seoTitle.en = "";
    expect(toPostPatch(parse(values), post)).toEqual({
      summary: { en: null, de: null },
      seo: { title: { en: null, de: null } },
    });
  });
});
